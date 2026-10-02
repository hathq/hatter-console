// Hatter 2026: actual UI submission -> shared owner -> canonical feedback -> STATE.
// Run by state-owner/tests/inference.rs. No mocked sources and no screenshots.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createDeliveryServer} from '@hathq/delivery-server'
import {createHatterSite} from '../delivery/site.mjs'
import {ManagementConnection} from '../server/lib/management-connection.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
import {DiagnosticStore} from '../server/lib/diagnostic-store.mjs'
import {publicationBounds} from '../server/runtime/product-publication.mjs'

let expected=JSON.parse(process.env.HATTER_FEEDBACK_EXPECTED)
const environment=process.env,connection=new ManagementConnection({environment})
const sources=new SourceOwnerClient({connection}),diagnosticsStore=new DiagnosticStore(),errors=[]
let site,server,browser
try{
 await sources.call({operation:'provision'})
 const manifest=JSON.parse(fs.readFileSync(new URL('../.output/server/delivery.json',import.meta.url)))
 const assets=manifest.assets.map(a=>({...a,bytesLength:a.bytes,bytes:fs.readFileSync(path.resolve(import.meta.dirname,'../.output/public','.'+a.path))}))
 site=await createHatterSite(environment,manifest.site,{diagnosticsStore})
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 const origin='http://localhost:'+port
 server=createDeliveryServer({origin,site,assets});site.watch(()=>server.notify());await server.listen()
 browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const rpc=async(method,params)=>(await connection.start()).request(method,params)
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(15000)
  await page.addInitScript(()=>{
   const fetch=window.fetch;window.feedbackReplies=[]
   window.fetch=async(...args)=>{
    const response=await fetch(...args)
    if(args[0]==='/api/site-actions')response.clone().json().then(body=>window.feedbackReplies.push({status:response.status,body}))
    return response
   }
  })
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text())})
  await page.goto(origin)
  await page.locator('[data-world-id="'+expected.roleRef.id+'"]').click()
  await page.getByRole('dialog',{name:/^Conversation with /}).getByRole('button',{name:'Open conversation',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Conversation',exact:true})
  await expect(dialog.getByRole('button',{name:'Provide an observation',exact:true})).toBeVisible()
  const location=await page.locator('#app').getAttribute('data-focus-location')
  const documentUrl=origin+'/api/document?'+new URLSearchParams({path:'/scenes',query:location.split('?')[1]})
  const before=await (await page.request.get(documentUrl)).json()
  assert.equal(before.envelope.readiness.state,'Ready',JSON.stringify(before.envelope.readiness))
  const items=before.envelope.snapshot.data.items.filter(i=>i.sourceRefs.some(s=>s.owner==='sem-lang'))
  const revision=await page.locator('#app').getAttribute('data-projection-revision')
  await dialog.getByRole('button',{name:'Provide an observation',exact:true}).click()
  const text='Unmapped fictional detail '+width
  await dialog.getByLabel('Information to understand',{exact:true}).fill(text)
  await dialog.getByLabel('Language tag',{exact:true}).fill('en')
  await dialog.getByLabel('Retention',{exact:true}).selectOption('KeepForSession')
  await dialog.getByLabel('Evaluation instant (optional; defined by the adopted knowledge)',{exact:true}).fill('1')
  let documentReads=0;page.on('request',r=>{if(r.url().includes('/api/document?'))documentReads++})
  const navigation=[];page.on('framenavigated',f=>{if(f===page.mainFrame())navigation.push(f.url())})
  await dialog.getByRole('button',{name:'Submit',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.feedbackReplies.length)).toBe(1)
  const {status,body}=await page.evaluate(()=>window.feedbackReplies[0])
  assert.deepEqual(navigation,[],'submitting the declared operation cannot navigate the document')
  assert.equal(status,200,JSON.stringify({body,declaration:before.bootstrap.actions}))
  expected=body
  assert.equal(expected.outcome.kind,'NeedsResolution')
  assert.equal(expected.modelAccess,'none')
  await expect(page.locator('#app')).not.toHaveAttribute('data-projection-revision',revision,{timeout:publicationBounds.cycleMs+2*publicationBounds.intervalMs})
  await dialog.getByRole('button',{name:'Back to conversation'}).click()
  await dialog.getByRole('button',{name:'Why this needs review',exact:true}).click()
  await expect(dialog.getByRole('region',{name:'Information needing clarification'})).toBeVisible()
  assert.equal(documentReads,0,'publication arrives through Crowsi STATE, not reload or polling')
  assert.equal(await page.locator('#app').getAttribute('data-focus-location'),location)
  const after=await (await page.request.get(documentUrl)).json()
  const snapshot=after.envelope.snapshot
  assert.deepEqual(snapshot.data.items.find(i=>i.value?.kind==='continuation').value.value,expected.continuation)
  // Projection identity ordering is distinct from sem-lang diagnostic ordering;
  // compare the complete multiset, retaining duplicates rather than a subset.
  assert.deepEqual(snapshot.data.unresolved.map(i=>i.reason).sort(),expected.continuation.remainingResiduals.map(i=>i.reason).sort())
  assert.deepEqual(snapshot.data.items.filter(i=>i.sourceRefs.some(s=>s.owner==='sem-lang')).map(i=>i.value),items.map(i=>i.value),'observation cannot adopt facts')
  const declared=before.bootstrap.actions.find(a=>a.label==='Provide an observation')
  const access=await (await page.request.post(origin+'/api/connection',{headers:{origin},data:{}})).json()
  const replay=await page.request.post(origin+'/api/site-actions',{headers:{
   origin,'content-type':'application/json','x-hatter-csrf':access.csrf,
   'x-hatter-request-nonce':crypto.randomUUID()
  },data:{id:declared.id,values:{text,locale:'en',retention:'KeepForSession',at:1}}})
  assert.equal(replay.status(),200,await replay.text())
  assert.deepEqual(await replay.json(),expected,'exact original browser operation is replayable after revision changes')
  const resumed=await rpc('inference/role/resume',{continuationRef:expected.continuationRef})
  assert.deepEqual(resumed.continuation,expected.continuation)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight))
  await page.close()
 }
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({status:'PASS',viewports:[1280,390],realOwners:true,uiSubmission:true,stateDelivery:true,exactReplay:true,noAdoption:true,screenshots:0}))
}catch(error){console.error(JSON.stringify({diagnostics:diagnosticsStore.list().filter(d=>d.severity!=='info'),errors}));throw error}
finally{await browser?.close();if(server)await server.close();else await site?.close();await sources.close();await connection.close()}
