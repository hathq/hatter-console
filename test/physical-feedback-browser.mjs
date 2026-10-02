// Real shared Product owners and a real local-model result. Invoked only by the
// physical acceptance harness; no mocked RPC, source, projection or browser data.
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

const expected=JSON.parse(process.env.HATTER_FEEDBACK_EXPECTED),environment=process.env
assert.equal(expected.outcome.kind,'NeedsResolution')
assert(expected.continuation.remainingResiduals.length)
const connection=new ManagementConnection({environment}),errors=[]
const sources=new SourceOwnerClient({connection})
const diagnosticsStore=new DiagnosticStore()
let site,server,browser,lastPage,origin
try{
 await sources.call({operation:'provision'})
 const manifest=JSON.parse(fs.readFileSync(new URL('../.output/server/delivery.json',import.meta.url)))
 const assets=manifest.assets.map(a=>({...a,bytesLength:a.bytes,bytes:fs.readFileSync(path.resolve(import.meta.dirname,'../.output/public','.'+a.path))}))
 site=await createHatterSite(environment,manifest.site,{diagnosticsStore})
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 origin='http://localhost:'+port
 server=createDeliveryServer({origin,site,assets})
 site.watch(()=>server.notify());await server.listen()
 browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}});lastPage=page;page.setDefaultTimeout(10000)
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text())})
  await page.goto(origin)
  await expect(page.locator('[data-world-id="'+expected.roleRef.id+'"]')).toBeVisible()
  await page.locator('[data-world-id="'+expected.roleRef.id+'"]').click()
  await page.getByRole('dialog',{name:/^Conversation with /}).getByRole('button',{name:'Open conversation',exact:true}).click()
  const conversation=page.getByRole('dialog',{name:'Conversation',exact:true})
  await expect(conversation).toBeVisible()
  await conversation.getByRole('button',{name:'Why this needs review',exact:true}).click()
  await expect(conversation.getByRole('region',{name:'Information needing clarification'})).toBeVisible()
  await expect(conversation.getByText('No questions or choices are currently published for this person.',{exact:true})).toBeHidden()
  const query=await page.locator('#app').getAttribute('data-focus-location')
  const response=await page.request.get(origin+'/api/document?'+new URLSearchParams({path:'/scenes',query:query.split('?')[1]}))
  assert.equal(response.status(),200)
  const document=await response.json(),snapshot=document.envelope.snapshot
  assert.equal(document.envelope.readiness.state,'Ready',JSON.stringify(document.envelope.readiness))
  const continuation=snapshot.data.items.find(i=>i.value?.kind==='continuation')
  assert.deepEqual(continuation.value.value,expected.continuation)
  assert.deepEqual(snapshot.data.unresolved.map(i=>i.reason),expected.continuation.remainingResiduals.map(i=>i.reason))
  await conversation.getByRole('button',{name:'Meaning not recognized',exact:true}).click()
  await expect(conversation).toBeVisible()
  await expect(conversation.getByText('Questions and choices',{exact:true})).toHaveCount(0)
  for(const reference of snapshot.data.unresolved[0].evidence)await expect(conversation).toContainText(reference)
  await expect(page.getByText(/No validated choice is available yet/)).toHaveCount(0)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight))
  await page.close()
 }
 const resumed=await (await connection.start()).request('inference/role/resume',{continuationRef:expected.continuationRef})
 assert.deepEqual(resumed.continuation,expected.continuation)
 assert.deepEqual(resumed.outcome,expected.outcome,'browser viewing must not adopt or reinterpret the observation')
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({status:'PASS',realModelResult:true,realOwners:true,viewports:[1280,390],exactContinuation:true,automaticAdoption:false,screenshots:0}))
}catch(error){
 if(lastPage&&!lastPage.isClosed()){
  const status=await lastPage.request.get(origin+'/api/status').then(r=>r.json()).catch(e=>({code:e.code}))
  const location=await lastPage.locator('#app').getAttribute('data-focus-location')
  const url=new URL(location,origin)
  const document=await lastPage.request.get(origin+'/api/document?'+new URLSearchParams({path:url.pathname,query:url.search.slice(1)})).then(r=>r.json()).catch(e=>({code:e.code}))
  console.error(JSON.stringify({stage:'physical-feedback-browser-failure',status,readiness:document.envelope?.readiness,diagnostics:diagnosticsStore.list(),location,errors}))
 }
 throw error
}finally{await browser?.close();if(server)await server.close();else await site?.close();await sources.close();await connection.close()}
