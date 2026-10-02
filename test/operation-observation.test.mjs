// Hatter 2026: compound diagnostic bounds, exact evidence and non-authority.
import test from 'node:test'
import assert from 'node:assert/strict'
import {DiagnosticStore} from '../server/lib/diagnostic-store.mjs'
const id='00000000-0000-0000-0000-000000000001'
test('startup observations use the same bounded store, monotonic time and a closed stage set',()=>{
 const store=new DiagnosticStore(8,()=>-1)
 assert.equal(store.recordStartup('invented-owner-proof'),null)
 const first=store.recordStartup('HandoffStart'),second=store.recordStartup('HandoffReady')
 assert.ok(second.elapsedMs>=first.elapsedMs)
 first.stage='observer mutation'
 assert.equal(store.list().at(-1).startup.stage,'HandoffStart')
 for(let n=0;n<40;n++)store.recordStartup('ProducerRecoveryStart')
 assert.equal(store.list().length,8);assert.equal(store.startupCount,24)
 assert.equal(store.recordStartup('SocketBound'),null)
 assert.ok(store.list().every(row=>JSON.stringify(row).length<1024))
})
test('owner/delivery observations preserve separate outcomes, reject bodies and bound retention',()=>{
 const store=new DiagnosticStore(2,()=>17)
 const source={callRef:id,method:'source/execute',operation:'targets',outcome:'ProjectionExecutionTimeout',rpc:{phase:'PossiblyDispatched',requestRef:2},
  stages:[{stage:'RequestAccepted',elapsedMs:0},{stage:'OwnerInitializationReady',elapsedMs:1},{stage:'RpcTransportEntered',elapsedMs:14}]}
 store.recordObservation(source)
 source.stages[0].elapsedMs=99
 assert.equal(store.list()[0].observation.stages[0].elapsedMs,0)
 const delivery={requestRef:id,owner:'hatter/control',stage:'OWNER_COMMITTED',receiptRef:'a'.repeat(64),operation:'interaction/execute',httpStatus:504,managementRequestRef:2}
 store.recordObservation(delivery)
 assert.deepEqual(store.list()[0].observation,{...delivery,sources:[],omittedSources:0})
 const before=store.list()
 for(const bad of [{...delivery,body:'private'}, {...delivery,stack:'private'}, {...delivery,operation:'http://secret'},
  {...source,stages:Array(25).fill({stage:'RequestAccepted',elapsedMs:0})}, {...source,stages:[{stage:'RpcBytesSent',elapsedMs:0}]},
  {...source,stages:[{stage:'RequestAccepted',elapsedMs:2},{stage:'RpcTransportEntered',elapsedMs:1}]}, {...source,rpc:{phase:'OwnerRead',requestRef:2}}])store.recordObservation(bad)
 assert.deepEqual(store.list(),before)
 store.record('hatter-test-failure','error','runtime')
 assert.equal(store.list().length,2)
 assert.equal(store.list()[1].observation.receiptRef,'a'.repeat(64))
 assert.equal(store.list()[1].observation.httpStatus,504,'HTTP failure never erases owner receipt')
})
test('concurrent calls join only their HTTP context and retain finite monotonic stages',async()=>{
 const store=new DiagnosticStore(8)
 const source={callRef:id,method:'source/execute',operation:'targets',outcome:'Ready',rpc:{phase:'OwnerResponded',requestRef:2},stages:[]}
 const other='00000000-0000-0000-0000-000000000002'
 await Promise.all([id,other].map(requestRef=>store.withOperation(requestRef,async()=>{
   store.recordStage('RequestAccepted')
   await Promise.resolve()
   for(let i=0;i<10;i++)store.recordObservation({...source,callRef:requestRef})
   store.recordStage('OwnerOperationSettled')
   store.recordStage('not-a-real-stage')
 })))
 store.recordObservation({requestRef:id,owner:'hatter/control',stage:'NOT_DISPATCHED',receiptRef:null,operation:'source/execute',httpStatus:400})
 assert.equal(store.list().length,2)
 for(const row of store.list()){
   assert.equal(row.observation.sources.length,4)
   assert.equal(row.observation.omittedSources,6)
   assert.ok(row.observation.sources.every(s=>s.callRef===row.observation.requestRef))
   assert.ok(Buffer.byteLength(JSON.stringify(row.observation))<=8192)
   assert.deepEqual(row.observation.stages.map(s=>s.stage),['RequestAccepted','OwnerOperationSettled'])
   assert.ok(row.observation.stages[1].elapsedMs>=row.observation.stages[0].elapsedMs)
 }
 store.list()[0].observation.sources.length=0
 assert.equal(store.list()[0].observation.sources.length,4)
})
test('pre-dispatch failure keeps its exact failed stage even when observation sink throws',async()=>{
 const {SourceOwnerClient}=await import('../server/runtime/source-owner-client.mjs')
 let observed
 const owner=new SourceOwnerClient({onObservation:value=>{observed=value;throw Error('observer-only')}})
 try{
   await assert.rejects(owner.call({operation:'targets',maximumItems:32}),error=>{
     assert.equal(error.rpc.phase,'NotDispatched')
     assert.equal(error.rpc.requestRef,null)
     assert.equal(error.sourceObservation.failedAt,'RequestAccepted')
     return true
   })
   assert.equal(observed.failedAt,'RequestAccepted')
   assert.equal(observed.stages.at(-1).stage,'RequestAccepted')
   assert.ok(observed.stages.every(s=>!s.stage.startsWith('Rpc')))
 }finally{await owner.close()}
})
test('interaction reference budget is finite and overflow cannot corrupt an existing observation',()=>{
 const store=new DiagnosticStore(),context={kind:'interaction-context',sceneRef:{key:'scene',revision:'pp:'+'a'.repeat(64)},
  dataProjectionRef:{key:'data',revision:'pp:'+'b'.repeat(64)},actionId:'action',inputGeneration:'generation',inputContractRef:'contract',sourceRefs:[]}
 store.withOperation(id,()=>{
  store.recordStage('RequestAccepted');store.recordObservation(context)
  const before=store.list()
  for(const invalid of [{...context,values:{secret:'private'}},{...context,principalRef:'invented'},
    {...context,sourceRefs:Array(17).fill({owner:'x',ref:'y',revision:'z',kind:'source'})},
    {...context,sourceRefs:[{owner:'x',ref:'y',revision:'z',kind:'source',body:'private'}]}])store.recordObservation(invalid)
  assert.deepEqual(store.list(),before)
  const source={owner:'x'.repeat(512),ref:'y'.repeat(512),revision:'z'.repeat(512),kind:'source'}
  store.recordObservation({...context,sourceRefs:Array(6).fill(source)})
  assert.deepEqual(store.list(),before,'oversized observations are dropped without changing prior evidence')
  for(let n=0;n<24;n++)store.recordStage('SceneActionValidationReady')
  const fullStages=store.list()
  const nearLimit={...context,sourceRefs:Array(4).fill({...source,kind:'k'.repeat(200)})}
  assert.ok(Buffer.byteLength(JSON.stringify(nearLimit))<8192,'individual observation fits; joined record does not')
  store.recordObservation(nearLimit)
  assert.deepEqual(store.list(),fullStages,'join overflow cannot mutate the existing bounded record')
  assert.ok(Buffer.byteLength(JSON.stringify(store.list()[0].observation))<=8192)
 })
})
