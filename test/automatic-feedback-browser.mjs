// Hatter: actual declared browser input -> local model -> retained owner feedback.
// The owner fixture provides the existing model and explicit opt-in profile.
// No RPC mock, external access, invented candidates or screenshots.
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
const call=JSON.parse(process.env.HATTER_FEEDBACK_EXPECTED),environment=process.env
const connection=new ManagementConnection({environment}),sources=new SourceOwnerClient({connection}),diagnosticsStore=new DiagnosticStore(),errors=[]
let site,server,browser
try{
 let origin=process.env.HATTER_TEST_ORIGIN
 if(!origin){
 await sources.call({operation:'provision'})
 const manifest=JSON.parse(fs.readFileSync(new URL('../.output/server/delivery.json',import.meta.url)))
 const assets=manifest.assets.map(a=>({...a,bytesLength:a.bytes,bytes:fs.readFileSync(path.resolve(import.meta.dirname,'../.output/public','.'+a.path))}))
 site=await createHatterSite(environment,manifest.site,{diagnosticsStore})
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 origin='http://localhost:'+port
 server=createDeliveryServer({origin,site,assets});site.watch(()=>server.notify());await server.listen()
 }else assert.match(origin,/^http:\/\/localhost:[0-9]+$/)
 browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const rpc=async(method,params)=>(await connection.start()).request(method,params)
 const page=await browser.newPage({viewport:{width:1280,height:844}});page.setDefaultTimeout(15000)
 await page.addInitScript(()=>{const original=window.fetch;window.feedbackReplies=[];window.fetch=async(...args)=>{const response=await original(...args);if(args[0]==='/api/site-actions')response.clone().json().then(body=>window.feedbackReplies.push({status:response.status,body}));return response}})
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text())})
 await page.goto(origin)
 if(process.env.HATTER_TEST_ORIGIN){
  await page.locator('.world-nearby > summary').click()
  await page.locator('[data-directory-id="'+call.roleRef.id+'"]').getByRole('button',{name:/^Talk to /}).click()
 }else await page.locator('[data-world-id="'+call.roleRef.id+'"]').click()
 await page.getByRole('dialog',{name:/^Conversation with /}).getByRole('button',{name:'Open conversation',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Conversation',exact:true})
 await expect(dialog.getByRole('button',{name:'Provide an observation',exact:true})).toBeVisible({timeout:15000})
 const location=await page.locator('#app').getAttribute('data-focus-location')
 const documentUrl=origin+'/api/document?'+new URLSearchParams({path:'/scenes',query:location.split('?')[1]})
 const before=await (await page.request.get(documentUrl)).json()
 const items=before.envelope.snapshot.data.items.filter(i=>i.sourceRefs.some(s=>s.owner==='sem-lang')).map(i=>i.value)
 await dialog.getByRole('button',{name:'Provide an observation',exact:true}).click()
 const text='A fictional green lantern needs explanation.'
 await dialog.getByLabel('Information to understand',{exact:true}).fill(text)
 await dialog.getByLabel('Language tag',{exact:true}).fill('en')
 await dialog.getByLabel('Retention',{exact:true}).selectOption('KeepForSession')
 let documentReads=0;page.on('request',r=>{if(r.url().includes('/api/document?'))documentReads++})
 await dialog.getByRole('button',{name:'Submit',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.feedbackReplies.length),{timeout:15000}).toBe(1)
 const {status,body:sent}=await page.evaluate(()=>window.feedbackReplies[0])
 assert.equal(status,200,JSON.stringify(sent));assert.equal(sent.assistance.state,'Accepted',JSON.stringify(sent))
 const request=sent.assistance.requestRef
 await dialog.getByRole('button',{name:'Back to conversation'}).click()
 await dialog.getByRole('button',{name:'Review status',exact:true}).click()
 const work=dialog.locator('[data-inference-request="'+request+'"]')
 await expect(work).toBeVisible()
 await expect(work).toHaveAttribute('data-inference-state','Completed',{timeout:35000})
 await expect.poll(async()=>{
  const s=await rpc('inference/execute',{operation:'scheduler'});assert.equal(s.driver.failure,null,JSON.stringify(s.driver));return s.driver.inputBytes
 },{timeout:10000}).toBe(0)
 const roles=await rpc('inference/role/list',{maximumItems:32}),roleRef=roles.roles.find(r=>r.roleRef.id===call.roleRef.id).roleRef
 const memory=await rpc('inference/role/memory',{roleRef})
 const scheduler=await rpc('inference/execute',{operation:'scheduler'}),resultRef=scheduler.scheduler.works[request].state.Completed.result_ref
 assert.equal(typeof resultRef,'string')
 const result=memory.shortTerm.find(o=>o.input_ref===resultRef)
 assert(result?.surface?.length,JSON.stringify(memory));assert(memory.shortTerm.some(o=>o.surface===text))
 assert.equal(scheduler.scheduler.works[request].spec.sourceReceiptRef,sent.receipt.commit.commit_ref)
 await dialog.getByRole('button',{name:'Back to conversation'}).click()
 await dialog.getByRole('button',{name:'Memory and senses',exact:true}).click()
 const retained=dialog.locator('[data-observation-ref="'+result.reference+'"]')
 await expect(retained).toBeVisible();await retained.locator('summary').click()
 await expect(retained).toContainText(result.surface)
 await expect(retained).toContainText('not an adopted fact')
 assert.equal(documentReads,0,'owner changes must arrive by STATE without reloading or polling documents')
 const after=await (await page.request.get(documentUrl)).json()
 assert.deepEqual(after.bootstrap.speaker.roleRef,roleRef)
 assert.deepEqual(after.envelope.snapshot.data.items.filter(i=>i.sourceRefs.some(s=>s.owner==='sem-lang')).map(i=>i.value),items)
 assert.deepEqual(after.bootstrap.speaker.observations,memory.shortTerm.slice(-16).reverse())
 assert.equal(after.bootstrap.speaker.memoryTimeline.semanticRevision,memory.semanticRevision)
 assert(after.bootstrap.speaker.memoryTimeline.entries.some(entry=>entry.memory==='short-term'&&entry.id==='short:'+result.reference))
 await page.setViewportSize({width:390,height:844})
 await expect(retained).toBeVisible()
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight))
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({status:'PASS',browserAutomatic:true,realModel:true,exactRequest:request,exactResult:resultRef,retainedNotAdopted:true,stateDelivery:true,mobile:true,screenshots:0}))
}catch(error){console.error(JSON.stringify({errors,diagnostics:diagnosticsStore.list().filter(d=>d.severity!=='info')}));throw error}
finally{await browser?.close();if(server)await server.close();else await site?.close();await sources.close();await connection.close()}
