// Hatter D1 2026: built framework-neutral delivery + installed Crowsi STATE.
// Browser faults only disconnect transport; all payloads remain actual PP bytes.
import assert from 'node:assert/strict'
import net from 'node:net'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {chromium} from '@playwright/test'
import {spawnParentBound,stopProcess} from '@crowsi/transport-foundation/process'
import {sceneInput} from '../server/runtime/scene-input.mjs'

export async function activityBrowser(input,environment,previous,current){
 assert.ok(previous);assert.notEqual(previous.revision,current.revision)
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve))
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve))
 const origin='http://127.0.0.1:'+port,token=randomUUID(),errors=[],frames=[]
 let child,browser,latest,stderr=''
 try{
  child=spawnParentBound(process.execPath,[new URL('../.output/server/index.mjs',import.meta.url).pathname],{
   cwd:input.home,env:{...environment,HATTER_CONSOLE_ORIGIN:origin,HATTER_CONSOLE_READINESS_TOKEN:token},stdio:['ignore','ignore','pipe']})
  child.stderr.on('data',b=>{stderr+=b;if(stderr.length>65536)child.kill()})
  const until=Date.now()+5000
  for(;;){
   try{const r=await fetch(origin+'/api/ready',{headers:{'x-hatter-readiness':token},signal:AbortSignal.timeout(250)});if(r.status===204)break}catch{}
   assert.ok(Date.now()<until&&child.exitCode===null,'delivery not ready: '+stderr)
   await new Promise(resolve=>setTimeout(resolve,25))
  }
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext({viewport:{width:1280,height:850}})
  await context.routeWebSocket('**/api/projection-live',route=>{
   const server=route.connectToServer();latest={route,server}
   route.onMessage(message=>{frames.push({direction:'client',value:JSON.parse(String(message))});server.send(message)})
   server.onMessage(message=>{frames.push({direction:'server',value:JSON.parse(String(message))});route.send(message)})
  })
  const page=await context.newPage();page.setDefaultTimeout(5000)
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text())})
  const before=sceneInput(previous),expected=sceneInput(current)
  const response=await page.goto(origin+'/scenes?'+new URLSearchParams({key:previous.key,revision:previous.revision}),{waitUntil:'domcontentloaded',timeout:7000})
  assert.equal(response.status(),200)
  const exact=async()=>{
   await page.waitForFunction(revision=>document.querySelector('#app')?.dataset.projectionRevision===revision,expected.revision)
   await page.locator('[data-realtime-state="Live"]').waitFor()
   const rows=await page.locator('[data-item-id]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.itemId,
    values:[...n.querySelectorAll('[data-projection-scalar]')].map(v=>v.dataset.projectionScalar)})))
   assert.deepEqual(rows.map(r=>r.id).sort(),expected.data.items.map(i=>i.id).sort())
   const scalars=v=>v===null||typeof v!=='object'?[JSON.stringify(v)]:Object.values(v).flatMap(scalars)
   for(const item of expected.data.items)assert.deepEqual(rows.find(r=>r.id===item.id).values,scalars(item.value))
  }
  await exact()
  assert.equal(await page.locator('#app').getAttribute('data-initial-revision'),before.revision)
  assert.ok(frames.some(f=>f.value.kind==='MESSAGE'&&f.value.metadata.revision===expected.revision),'actual STATE supplies canonical advancement')
  const session=frames.find(f=>f.value.kind==='BIND').value.capabilities.session
  latest.route.close({code:1001});latest.server.close({code:1001})
  await page.waitForFunction(()=>document.querySelector('[data-realtime-state]')?.dataset.realtimeState==='Reconnecting')
  await exact()
  assert.equal(frames.filter(f=>f.value.kind==='BIND').at(-1).value.capabilities.session,session)
  await page.setViewportSize({width:390,height:844});await exact()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:path.join(process.env.HATTER_D1_EVIDENCE_DIR,'activity-mobile.png')})
  const startup=stderr.split('\n').filter(Boolean).map(line=>JSON.parse(line))
  assert.ok(startup.length<=24)
  for(const row of startup){
   assert.deepEqual(Object.keys(row).sort(),['code','elapsedMs','stage'])
   assert.equal(row.code,'hatter-console-startup-observed')
   assert.ok(typeof row.stage==='string'&&row.stage.length<64&&Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0)
  }
  assert.deepEqual(errors,[])
  return {status:'PASS',initialRevision:before.revision,revision:expected.revision,items:expected.data.items.length,
   sameLogicalSession:true,desktop:true,mobile:true,source:'actual Graph/PP, built delivery, Crowsi STATE',startup,errors:[]}
 }finally{await browser?.close();if(child)await stopProcess(child,{timeoutMs:3000})}
}
