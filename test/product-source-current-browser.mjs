// Hatter D1 2026: installed source owner -> native browser input -> exact
// canonical Structural Apply -> PP -> Crowsi. No Nuxt readiness or UI selectors.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
import {spawnParentBound,stopProcess} from '@crowsi/transport-foundation/process'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
import {sceneInput} from '../server/runtime/scene-input.mjs'
import {publicationBounds} from '../server/runtime/product-publication.mjs'
import {graphRpcJourney} from './graph-rpc-journey.mjs'
import {workerBarrier} from './graph-worker-barrier.mjs'
import {preparedJourney} from './graph-prepared-journey.mjs'
import {observeTree,assertTreeStopped} from './owned-process-observation.mjs'

const input=JSON.parse(fs.readFileSync(0,'utf8'))
assert.equal(input.mode,'write')
const fault=process.env.HATTER_D1_DELIVERY_FAULT??null
assert.ok(fault===null||['response-loss','state-loss','pp-failure'].includes(fault))
const graphBarrier=process.env.HATTER_GRAPH_BROWSER_BARRIER??null
assert.ok(graphBarrier===null||['committed-before-publication','recovery-active'].includes(graphBarrier)&&fault==='pp-failure')
// The ordinary acceptance starts the real public command, not its child server.
// Physical fault experiments retain their explicit direct-server boundary.
const commandLaunch=fault===null&&!process.env.HATTER_GRAPH_RPC_MODE
// Selection now acknowledges durable intent, not completed publication. Observe
// the existing bounded fair producer cycle, rather than imposing an unrelated
// seven-second completion deadline on that asynchronous owner.
const publicationWaitMs=Math.ceil(publicationBounds.keys/publicationBounds.batch)*(publicationBounds.cycleMs+publicationBounds.intervalMs)
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r))
const port=listener.address().port;await new Promise(r=>listener.close(r))
const origin=commandLaunch?'http://localhost:4213':'http://127.0.0.1:'+port,token=randomUUID(),errors=[],requests=[],frames=[],network=[]
const environment={...process.env,HATTER_HOME:input.home,HATTER_CONSOLE_HANDOFF_VERSION:'1',HATTER_CONSOLE_HANDOFF_ACTIVE:'1',
 HATTER_CONSOLE_NODE_EXECUTABLE:process.execPath,HATTER_CLI_EXECUTABLE:input.binary,HATTER_LAUNCH_CWD:input.home,
 HATTER_CLI_EXECUTABLE_SHA256:'sha256:'+createHash('sha256').update(fs.readFileSync(input.binary)).digest('hex'),
 HATTER_CONSOLE_ORIGIN:origin,HATTER_CONSOLE_READINESS_TOKEN:token}
const owner=new SourceOwnerClient(environment)
let child,browser,page,stderr='',before,after,accepted,phase='initial'
let runtimeStatus=null
let operationObservations=[],observationSnapshots=[]
async function captureObservations(){
 const response=await page.context().request.get(origin+'/api/document?path=/system',{timeout:3000})
 operationObservations=(await response.json()).bootstrap?.data?.diagnostics??[]
 observationSnapshots.push({phase,rows:operationObservations})
 assert.ok(observationSnapshots.length<=4)
}
let stateCuts=0
let blockedProjection=null,projectionMode=null,publicationFailure=null
const shutdowns=[]
let graphBarrierEvidence=null
let failedProducer=null
let inspectorUrl=null,debuggerSession=null
const debuggerMessages=[]
const starts=[]
const startupAttempts=[]
const startupObservations=[]
async function startDelivery(){
 const inspecting=graphBarrier==='recovery-active'&&shutdowns.length===0
 child=commandLaunch?spawnParentBound(input.binary,[],{
  cwd:input.home,env:{...environment,HATTER_CONSOLE_EXECUTABLE:new URL('../bin/hatter-console',import.meta.url).pathname,
   HATTER_CONSOLE_HANDOFF_ACTIVE:undefined},stdio:['ignore','pipe','pipe']}):
  spawnParentBound(process.execPath,[...(inspecting?['--inspect=127.0.0.1:0']:[]),new URL('../.output/server/index.mjs',import.meta.url).pathname],{
   cwd:input.home,env:environment,stdio:['ignore','ignore','pipe']})
 const startingChild=child
 let announced=''
 child.stdout?.on('data',bytes=>{announced+=bytes;if(announced.length>1024)startingChild.kill()})
 let lines=''
 child.stderr.on('data',b=>{
  lines+=b
  while(lines.includes('\n')){
   const index=lines.indexOf('\n'),line=lines.slice(0,index);lines=lines.slice(index+1)
   if(inspecting&&(/^(Debugger listening on ws:\/\/127\.0\.0\.1:|For help, see: https:\/\/nodejs.org\/|Debugger attached\.|Debugger ending on ws:|Waiting for the debugger to disconnect)/).test(line)){
    debuggerMessages.push(line);inspectorUrl??=line.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+/)?.[0]??null
   }else{
    let observed;try{observed=JSON.parse(line)}catch{}
    if(observed?.code==='hatter-console-startup-observed'){
     assert.ok(Object.keys(observed).every(k=>['code','stage','elapsedMs'].includes(k)))
     assert.ok(typeof observed.stage==='string'&&observed.stage.length<64&&Number.isFinite(observed.elapsedMs)&&observed.elapsedMs>=0)
     assert.ok(startupObservations.length<72)
     startupObservations.push({pid:startingChild.pid,...observed})
    }else stderr+=line+'\n'
   }
  }
  if(stderr.length+lines.length>65536)startingChild.kill()
 })
 // Match the installed launcher's readiness observer, not the unrelated 5s
 // per-owner RPC budget. This changes no product or physical execution limit.
 assert.match(fs.readFileSync(new URL('../bin/hatter-console.mjs',import.meta.url),'utf8'),/const deadline = Date\.now\(\) \+ 10_000/)
 const started=Date.now(),until=started+10000
 const measuredStart=performance.now()
 const attempt={pid:child.pid,phase,httpStatus:null,httpReached:false,networkCode:null,elapsedMs:0,exitCode:null,signal:null,ready:false}
 assert.ok(startupAttempts.length<3);startupAttempts.push(attempt)
 for(;;){
  try{
   // The command owns its private readiness nonce. Its exact stdout URL is
   // emitted only after the launcher has validated its own child response.
   const ready=commandLaunch?announced===origin+'/\n':
    (await fetch(origin+'/api/ready',{headers:{'x-hatter-readiness':token},signal:AbortSignal.timeout(250)})).status===204
   if(ready){attempt.httpReached=true;attempt.httpStatus=204;attempt.networkCode=null;attempt.ready=true;attempt.elapsedMs=performance.now()-measuredStart;starts.push({pid:child.pid,elapsedMs:Date.now()-started,entry:commandLaunch?'hatter':'delivery-server'});break}
  }catch(error){
   const code=error.cause?.code??error.name
   attempt.networkCode=['ECONNREFUSED','ECONNRESET','ETIMEDOUT','TimeoutError','AbortError','TypeError'].includes(code)?code:'UnclassifiedTransportFailure'
  }
  attempt.elapsedMs=performance.now()-measuredStart;attempt.exitCode=child.exitCode;attempt.signal=child.signalCode
  assert.ok(Date.now()<until&&child.exitCode===null,'delivery readiness failed: '+stderr)
  await new Promise(r=>setTimeout(r,25))
 }
}
async function closeDelivery(){
 const process=child
 const observed=observeTree(process.pid)
 await stopProcess(process,{timeoutMs:3000});child=null
 await assertTreeStopped(observed)
 const result={pid:process.pid,exitCode:process.exitCode,signal:process.signalCode,observed,observedSurvivors:0}
 shutdowns.push(result)
 assert.deepEqual({exitCode:result.exitCode,signal:result.signal},{exitCode:0,signal:null},JSON.stringify(result))
}
async function rendered(snapshot){
 const expected=sceneInput(snapshot)
 await page.waitForFunction(revision=>document.querySelector('#app')?.dataset.projectionRevision===revision,expected.revision,{timeout:publicationWaitMs})
 const rows=await page.locator('[data-item-id]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.itemId,
  values:[...n.querySelectorAll('[data-projection-scalar]')].map(v=>v.dataset.projectionScalar)})))
 assert.deepEqual(rows.map(r=>r.id).sort(),expected.data.items.map(i=>i.id).sort())
 const scalars=v=>v===null||typeof v!=='object'?[JSON.stringify(v)]:Object.values(v).flatMap(scalars)
 for(const item of expected.data.items)assert.deepEqual(rows.find(r=>r.id===item.id).values,scalars(item.value??{reason:item.reason}))
 return {revision:expected.revision,rows}
}
if(process.env.HATTER_GRAPH_RPC_MODE){
 const mode=process.env.HATTER_GRAPH_RPC_MODE
 const result=await (mode.startsWith('prepared-')?preparedJourney:graphRpcJourney)(input,environment,mode)
 process.stdout.write(JSON.stringify(result)+'\n')
}else try{
 const initialCanonical=await owner.call({operation:'targets',maximumItems:32});await owner.close()
 await startDelivery()
 browser=await chromium.launch({headless:true})
 const context=await browser.newContext({viewport:{width:390,height:844}})
 let socket
 await context.routeWebSocket('**/api/projection-live',route=>{
  const server=route.connectToServer();socket={route,server}
  route.onMessage(message=>{frames.push({direction:'client',value:JSON.parse(String(message))});server.send(message)})
  server.onMessage(message=>{
   const value=JSON.parse(String(message));frames.push({direction:'server',value})
   if(fault==='state-loss'&&stateCuts===0&&requests.length&&before&&value.class==='STATE'
     &&value.metadata?.revision!==sceneInput(before).revision){
    stateCuts++;route.close({code:1001});server.close({code:1001});return
   }
   route.send(message)
  })
 })
 page=await context.newPage();page.setDefaultTimeout(7000)
 page.on('pageerror',e=>errors.push(e.message))
 page.on('response',r=>{if(r.request().method()==='POST')network.push({kind:'response',path:new URL(r.url()).pathname,status:r.status(),nonce:r.request().headers()['x-hatter-request-nonce']??null})})
 page.on('requestfailed',r=>network.push({kind:'failed',path:new URL(r.url()).pathname,error:r.failure()?.errorText}))
 page.on('framenavigated',frame=>{if(frame===page.mainFrame())network.push({kind:'navigation',path:new URL(frame.url()).pathname})})
 page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text())})
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/interactions')requests.push(r.postDataJSON())})
 assert.equal((await page.goto(origin+'/',{waitUntil:'domcontentloaded'})).status(),200)
 await page.getByRole('button',{name:new RegExp(input.roleRef.id)}).click()
 await expect(page).toHaveURL(/\/scenes\?key=product%3A[a-f0-9]{64}&current=true$/)
 const selection={key:new URL(page.url()).searchParams.get('key')}
 const current=()=>context.request.get(origin+'/api/projections?'+new URLSearchParams({key:selection.key,current:'true'})).then(r=>r.json())
 await page.locator('[data-render-revision]').waitFor({timeout:publicationWaitMs})
 before=(await current()).snapshot;assert.ok(before)
 const initialData=await rendered(before)
 phase='selection-observed';await captureObservations()
 assert.ok(operationObservations.some(r=>r.observation?.sources?.some(s=>s.operation==='targets')),'Subject selection must join its actual source RPC')
 await expect(page.locator('[aria-label="Owner readiness"]')).not.toContainText('SceneUnavailable')
 await page.getByRole('navigation',{name:'Window tools'}).getByRole('button',{name:'Scene tools',exact:true}).click()
 await page.locator('[data-kind="action"][data-target="edit-source"]').click()
 const field=page.getByRole('textbox',{name:'Source value',exact:true})
 await expect(field).toBeVisible()
 await page.getByRole('button',{name:'Submit',exact:true}).press('Enter')
 await expect(page.getByText('Check the declared input constraints.',{exact:true})).toBeVisible()
 assert.equal(requests.length,0,'invalid local input never invokes the owner')
 await field.fill(input.value)
 assert.equal((await current()).snapshot.revision,before.revision,'draft is not canonical')
 if(fault==='pp-failure'){
  const home=fs.realpathSync(input.home)
  assert.equal(path.dirname(home),fs.realpathSync(os.tmpdir()),'fault only changes the Rust fixture temporary home')
  blockedProjection=path.join(home,'derived','projections')
  const stat=fs.lstatSync(blockedProjection);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(stat.uid,process.getuid())
  projectionMode=stat.mode&0o777;fs.chmodSync(blockedProjection,0o500)
 }
 let response
 if(fault==='response-loss'){
  // External browser test cuts delivery only AFTER the real owner response.
  // No preload, worker patch, fabricated commit, or second request is used.
  response=new Promise((resolve,reject)=>{
   page.route('**/api/interactions',async route=>{
    try{const response=await route.fetch({maxRetries:0});const value=await response.json();await route.abort('failed');resolve(value)}catch(error){reject(error)}
   },{times:1}).catch(reject)
  })
 }
 await page.getByRole('button',{name:'Submit',exact:true}).press('Enter')
 if(response)accepted=await response
 else{
  // Chromium may evict a streamed response from CDP after the application has
  // consumed it. Assert the exact DTO the USER can see, not a second network
  // read/retry. Fail if any displayed field, scalar or structure differs.
  const result=page.locator('section[aria-live="polite"] > dl')
  await expect(result).toBeVisible()
  accepted=await result.evaluate(root=>{
   const read=node=>{
    if(node.hasAttribute('data-projection-scalar'))return JSON.parse(node.dataset.projectionScalar)
    if(node.tagName==='OL')return [...node.children].map(li=>read(li.firstElementChild))
    if(node.tagName!=='DL')throw Error('Unexpected result structure')
    const value={},children=[...node.children]
    for(let n=0;n<children.length;n+=2){if(children[n].tagName!=='DT'||children[n+1]?.tagName!=='DD')throw Error('Invalid result pair');value[children[n].textContent]=read(children[n+1].firstElementChild)}
    return value
   };return read(root)
  })
 }
 assert.equal(accepted.error,undefined,JSON.stringify(accepted))
 assert.equal(accepted.canonical.state,'Accepted',JSON.stringify(accepted))
 assert.match(accepted.canonical.receiptRef,/^[a-f0-9]{64}$/)
 if(fault==='response-loss')await expect(page.locator('[aria-label="Owner readiness"] strong')).toHaveText('DeliveryOutcomeUncertain')
 if(fault==='pp-failure'){
  await expect.poll(async()=>{
   const value=await context.request.get(origin+'/api/status').then(r=>r.json())
   publicationFailure=value.publication?.streams.find(s=>s.key===selection.key)?.status
   return publicationFailure?.state
  },{timeout:publicationWaitMs}).toBe('FailedTyped')
  assert.equal((await current()).snapshot.revision,before.revision,'failed PP retains original readable snapshot')
  phase='commit-observed';await captureObservations()
  assert.ok(operationObservations.some(r=>r.observation?.receiptRef===accepted.canonical.receiptRef),'normal delivery preserves the original canonical receipt')
  const committedObservation=operationObservations.find(r=>r.observation?.receiptRef===accepted.canonical.receiptRef).observation
  assert.deepEqual(committedObservation.interaction.sceneRef,{key:before.key,revision:before.revision})
  assert.deepEqual(committedObservation.interaction.dataProjectionRef,before.lineage.dataProjection)
  assert.notEqual(committedObservation.interaction.sceneRef.revision,committedObservation.interaction.dataProjectionRef.revision)
  const exactAction=before.data.actions.find(action=>action.id===committedObservation.interaction.actionId)
  assert.ok(exactAction)
  assert.deepEqual(committedObservation.interaction.sourceRefs,exactAction.sourceRefs)
  assert.equal(committedObservation.interaction.inputGeneration,exactAction.interaction.generation)
  assert.equal(Object.hasOwn(committedObservation.interaction,'principalRef'),false,'Subject target cannot manufacture a sender')
  failedProducer=JSON.parse(fs.readFileSync(path.join(input.home,'derived/product-publication.json'))).streams.find(s=>s.key===selection.key)
  if(graphBarrier==='committed-before-publication'){
   // Actual native Submit has acknowledged its canonical receipt, while the
   // real PP store has rejected publication. No sleep or invented owner state.
   phase='graph-E-before-shutdown'
   const metadata=()=>JSON.parse(fs.readFileSync(path.join(input.home,'derived/product-publication.json')))
   const pending=metadata().streams.find(s=>s.key===selection.key)
   assert.equal(pending.intent.canonicalReceipt,accepted.canonical.receiptRef)
   assert.equal(pending.status.state,'FailedTyped')
   await page.goto('about:blank')
   await closeDelivery()
   const graph=path.join(input.home,'digital-twin/v1.redb'),bytes=fs.readFileSync(graph)
   const probe=new SourceOwnerClient(environment)
   let canonical,source
   try{
    canonical=await probe.call({operation:'targets',maximumItems:32})
    source=await probe.call({operation:'describe',owner:'hatter/control',reference:accepted.canonical.receiptRef})
   }finally{await probe.close()}
   assert.equal(canonical.head.commit,accepted.canonical.receiptRef)
   assert.equal(canonical.head.sequence,initialCanonical.head.sequence+1)
   assert.equal(source.ref,accepted.canonical.receiptRef)
   assert.deepEqual(fs.readFileSync(graph),bytes,'post-reap reads must not repair or mutate Graph')
   assert.deepEqual(metadata().streams.find(s=>s.key===selection.key),pending)
   phase='graph-E-restart'
   await startDelivery()
   assert.deepEqual(metadata().streams.find(s=>s.key===selection.key),pending,'restart preserves original producer identity')
   assert.deepEqual(fs.readFileSync(graph),bytes,'startup must not repair canonical Graph')
   graphBarrierEvidence={case:'E',interaction:requests[0],roleRef:input.roleRef,
    before:initialCanonical.head,after:canonical.head,receiptRef:source.ref,source,
    producer:pending,projectionRevision:before.revision,postReapRead:'PASS',implicitRepair:0}
   await page.goto(origin+'/scenes?'+new URLSearchParams({key:selection.key,current:'true'}))
  }
  fs.chmodSync(blockedProjection,projectionMode);blockedProjection=null
  if(graphBarrier==='recovery-active'){
   assert.ok(inspectorUrl)
   debuggerSession=await workerBarrier(inspectorUrl)
  }
  await page.getByRole('navigation',{name:'Window tools'}).getByRole('button',{name:'Views',exact:true}).click()
  await page.getByRole('link',{name:'System',exact:true}).click()
  await page.getByRole('navigation',{name:'Window tools'}).getByRole('button',{name:'Actions',exact:true}).click()
  await page.getByRole('button',{name:'Retry publication '+selection.key,exact:true}).click()
  await expect(page.locator('section[aria-live="polite"]')).toContainText('Pending')
  if(graphBarrier==='recovery-active'){
   phase='graph-F-recovery-active'
   const worker=await debuggerSession.wait(publicationWaitMs)
   const status=await context.request.get(origin+'/api/status').then(r=>r.json())
   assert.equal(status.publication.running,true)
   assert.equal(status.projections.active,1)
   const pending=JSON.parse(fs.readFileSync(path.join(input.home,'derived/product-publication.json'))).streams.find(s=>s.key===selection.key)
   assert.equal(pending.status.state,'Pending')
   assert.equal(pending.intent.canonicalReceipt,accepted.canonical.receiptRef)
   assert.deepEqual(pending.intent,failedProducer.intent,'explicit recovery reuses the original failed producer')
   const repair=status.projections.store.repairs.find(r=>r.id===pending.intent.id)
   assert.ok(repair,'the exact producer intent must be executing, not an unrelated background scan')
   assert.equal((await current()).snapshot.revision,before.revision)
   // The installed worker is paused before its code runs. The actual runtime
   // already owns exact sources and an active durable attempt. No fake producer.
   await page.goto('about:blank')
   const exiting=child,closed=new Promise(resolve=>exiting.once('close',resolve))
   assert.equal(exiting.kill('SIGKILL'),true)
   await closed;child=null
   shutdowns.push({pid:exiting.pid,exitCode:exiting.exitCode,signal:exiting.signalCode})
   assert.equal(exiting.signalCode,'SIGKILL')
   await debuggerSession.close();debuggerSession=null
   phase='graph-F-post-reap'
   const graph=path.join(input.home,'digital-twin/v1.redb'),bytes=fs.readFileSync(graph),probe=new SourceOwnerClient(environment)
   let canonical,source
   try{
    canonical=await probe.call({operation:'targets',maximumItems:32})
    source=await probe.call({operation:'describe',owner:'hatter/control',reference:accepted.canonical.receiptRef})
   }finally{await probe.close()}
   assert.equal(canonical.head.commit,accepted.canonical.receiptRef)
   assert.equal(canonical.head.sequence,initialCanonical.head.sequence+1)
   assert.equal(source.ref,accepted.canonical.receiptRef)
   assert.deepEqual(fs.readFileSync(graph),bytes,'post-reap inspection cannot repair Graph')
   graphBarrierEvidence={case:'F',interaction:requests[0],roleRef:input.roleRef,
    before:initialCanonical.head,after:canonical.head,receiptRef:source.ref,source,
    producer:pending,repair,worker,active:status.projections.active,projectionRevision:before.revision,postReapRead:'PASS',implicitRepair:0}
   phase='graph-F-restart'
   await startDelivery()
  }
  await page.goto(origin+'/scenes?'+new URLSearchParams({key:selection.key,current:'true'}))
 }
 await page.waitForFunction(previous=>document.querySelector('#app')?.dataset.projectionRevision!==previous,sceneInput(before).revision,{timeout:publicationWaitMs})
 after=(await current()).snapshot;assert.ok(after)
 const finalData=await rendered(after)
 if(graphBarrierEvidence){
  await expect.poll(async()=>{
   const status=await context.request.get(origin+'/api/status').then(r=>r.json())
   return status.publication.streams.find(s=>s.key===selection.key)?.status?.state
  },{timeout:publicationWaitMs}).toBe('Published')
  const finalProducer=JSON.parse(fs.readFileSync(path.join(input.home,'derived/product-publication.json'))).streams.find(s=>s.key===selection.key)
  assert.deepEqual(finalProducer.intent,failedProducer.intent,'restart may not replace an accepted producer intent')
  assert.equal(finalProducer.status.canonicalReceipt,accepted.canonical.receiptRef)
  // A non-interactive Data projection is presented through the existing Scene
  // wrapper. Its lineage retains the stored revision; the two hashes have
  // different contracts and must not be compared as if they were identical.
  assert.equal(finalProducer.status.revision,after.lineage.dataProjection?.revision??after.revision)
  graphBarrierEvidence.finalProducer=finalProducer
 }
 assert.ok(after.lineage.sources.some(s=>s.ref===accepted.canonical.receiptRef))
 assert.ok(after.data.items.some(i=>i.semanticRef&&JSON.stringify(i.value).includes(input.value)))
 assert.deepEqual(requests[0].values,{editable:input.value})
 assert.equal(stderr,'','positive owner journey must not produce delivery failures')
 const security=await context.request.post(origin+'/api/connection',{data:{},headers:{origin}}).then(r=>r.json())
 const post=data=>context.request.post(origin+'/api/interactions',{headers:{origin,'x-hatter-csrf':security.csrf,'x-hatter-request-nonce':randomUUID()},data}).then(r=>r.json())
 const negative=[]
 for(const data of [{...requests[0],sourceTuple:[]},{...requests[0],values:{editable:input.value,roleRef:'forged'}},
  {...requests[0],generation:'stale'},{...requests[0],inputContractRef:'stale'},requests[0]]){
  const value=await post(data);assert.ok(['InvalidInput','StaleSceneAction'].includes(value.error?.code),JSON.stringify(value));negative.push(value)
 }
 assert.deepEqual((await current()).snapshot,after,'rejected requests cannot republish')
 await page.locator('[data-realtime-state="Live"]').waitFor()
 // Compare this live logical session across its reconnect. Full document
 // navigation for explicit recovery legitimately created a new client earlier.
 const session=frames.filter(f=>f.value.kind==='BIND').at(-1).value.capabilities.session
 socket.route.close({code:1001});socket.server.close({code:1001})
 await page.waitForFunction(()=>document.querySelector('[data-realtime-state]')?.dataset.realtimeState==='Reconnecting')
 await page.locator('[data-realtime-state="Live"]').waitFor();await rendered(after)
 assert.equal(frames.filter(f=>f.value.kind==='BIND').at(-1).value.capabilities.session,session)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.screenshot({path:path.join(input.evidence,'source-current-mobile.png')})
 await page.setViewportSize({width:1280,height:850});await rendered(after)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 for(const start of starts){
  const stages=startupObservations.filter(row=>row.pid===start.pid)
  for(const stage of ['HandoffStart','HandoffReady','ProjectionsStart','ProducerRecoveryStart','ProducerRecoveryReady','PublicationReconcileStart','PublicationReconcileReady','ProjectionsReady','ListenStart','SocketBound','ReadinessResponseFinished'])
   assert.ok(stages.some(row=>row.stage===stage),stage)
  assert.ok(stages.every((row,index)=>index===0||row.elapsedMs>=stages[index-1].elapsedMs))
 }
 assert.deepEqual(errors,fault==='response-loss'?['Failed to load resource: net::ERR_FAILED']:[])
 assert.equal(requests.length,1,'lost response must never resend the canonical command')
 assert.equal(stateCuts,fault==='state-loss'?1:0)
 await captureObservations()
 assert.ok(operationObservations.some(row=>row.observation?.requestRef),'normal entrypoint retains onOutcome')
 const diagnostics=stderr.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
 assert.deepEqual(diagnostics,negative.map(value=>value.error),'only the five deliberately rejected commands produce diagnostics')
 if(commandLaunch){
  // Close the browser subscription before an intentional full application
  // shutdown. Live socket reconnection was tested above, independently.
  await page.goto('about:blank')
  phase='command-restart';await closeDelivery();await startDelivery()
  await page.goto(origin+'/scenes?'+new URLSearchParams({key:selection.key,current:'true'}))
  await rendered(after);assert.deepEqual((await current()).snapshot,after)
  assert.deepEqual(errors,[])
 }
 await browser.close();browser=null;await closeDelivery()
 const oracle=new SourceOwnerClient(environment)
 let canonical,semantic
 try{
  phase='oracle-targets';canonical=await oracle.call({operation:'targets',maximumItems:32})
  assert.equal(canonical.head.commit,accepted.canonical.receiptRef)
  assert.equal(canonical.head.sequence,initialCanonical.head.sequence+1,'only one structural mutation')
  const source=after.lineage.sources.find(s=>s.owner==='sem-lang'),holder='d1-source:'+randomUUID()
  phase='oracle-acquire';const lease=await oracle.call({operation:'acquire',source,holder,durationMs:10000})
  try{phase='oracle-read';semantic=(await oracle.call({operation:'read',source,holder,generation:lease.generation})).body}
  finally{await oracle.call({operation:'release',owner:'sem-lang',holder,generation:lease.generation})}
  const projected=after.data.items.filter(i=>i.semanticRef)
  assert.deepEqual(projected.map(i=>i.value),semantic.claims)
  for(const item of projected)assert.deepEqual(item.provenance,semantic.provenance.filter(p=>p.claimIds.includes(item.value.id)).map(p=>p.packetId))
 }finally{await oracle.close()}
 fs.writeFileSync(path.join(input.evidence,'source-current-browser.json'),JSON.stringify({status:'PASS',commandLaunch,initialData,finalData,before,after,accepted,canonical,semantic,
  negative,requests,frames,fault,stateCuts,publicationFailure,graphBarrierEvidence,shutdowns,starts,startupAttempts,startupObservations,debuggerMessages,operationObservations,observationSnapshots,sameSession:true,mobile:true,desktop:true,keyboard:true,errors},null,2)+'\n',{flag:'wx'})
 process.stdout.write(JSON.stringify({status:'PASS',roleRef:accepted.canonical.roleRef})+'\n')
}catch(error){
 try{runtimeStatus=await page.context().request.get(origin+'/api/status',{timeout:3000}).then(r=>r.json())}catch{}
 try{await captureObservations()}catch{}
 // Preserve only this Rust fixture's bounded Graph specimen, after all owners
 // are reaped. No read repair and no production/user state capture.
 await browser?.close();browser=null;await owner.close()
 if(child){await stopProcess(child,{timeoutMs:3000});child=null}
 const home=fs.realpathSync(input.home),graph=path.join(home,'digital-twin','v1.redb')
 assert.equal(path.dirname(home),fs.realpathSync(os.tmpdir()))
 if(fs.existsSync(graph)){
  const stat=fs.lstatSync(graph);assert.ok(stat.isFile()&&stat.uid===process.getuid()&&stat.size<=16777216)
  fs.copyFileSync(graph,path.join(input.evidence,'failed-fixture-graph.redb'),fs.constants.COPYFILE_EXCL)
 }
 fs.writeFileSync(path.join(input.evidence,'source-current-failure.json'),JSON.stringify({message:error.message,ownerFailure:error.failure??null,phase,stderr,errors,requests,network,frames,runtimeStatus,before,after,accepted,graphBarrierEvidence,shutdowns,starts,startupAttempts,startupObservations,debuggerMessages,operationObservations,observationSnapshots,
  html:page&&!page.isClosed()?await page.locator('main').innerText():null},null,2)+'\n',{flag:'wx'});throw error
}finally{if(blockedProjection)fs.chmodSync(blockedProjection,projectionMode);await debuggerSession?.close();await browser?.close();await owner.close();if(child)await stopProcess(child,{timeoutMs:3000})}
