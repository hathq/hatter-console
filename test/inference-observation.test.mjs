import test from 'node:test'
import assert from 'node:assert/strict'
import {inferenceObservation} from '../delivery/inference-observation.mjs'
import {HatterRuntime} from '../server/runtime/hatter-runtime.mjs'
test('local inference display uses exact scheduler kinds, preserves blocked/reserved distinctions and never asserts physical progress',async()=>{
 const states=['Runnable',{Blocked:'InputUnavailable'},{Running:{claim:1,cancel_requested:false}},{Completed:{result_ref:'result'}},{Failed:{source:{owner:'provider',code:'failed'}}},'Cancelled']
 const works=Object.fromEntries(states.map((state,i)=>['r'+i,{spec:{requestRef:'r'+i,roleRef:{id:'role'},scopeRef:{id:'scope',revision:4},sourceReceiptRef:'receipt',prerequisite:null,execution:{kind:'inference',runtimeRef:'runtime',processRef:'process'}},acceptedSequence:i+1,inputAvailable:i!==1,state}]))
 for(const kind of ['resolution','invocation','operation','technical'])works[kind]={spec:{requestRef:kind,roleRef:{id:'other-role'},execution:{kind,confirmationRef:{id:'confirmation:exact',revision:2}}},state:{Failed:{source:{owner:'sem-lang',code:'ExactRefusal'}}}}
 const input={scheduler:{works},driver:{phase:'dispatching'},controlRevision:{commit:'exact',sequence:1}}
 const result=inferenceObservation(input)
 assert.deepEqual(result.counts,{Runnable:1,Blocked:1,Running:1,Completed:1,Failed:5,Cancelled:1})
 assert.equal(result.roles.length,10);assert.equal(result.physicalProgress,'not-observed');assert.deepEqual(result.revision,input.controlRevision)
 for(const [i,work]of result.roles.slice(0,6).entries()){
  assert.deepEqual(work.scopeRef,works['r'+i].spec.scopeRef);assert.equal(work.acceptedSequence,i+1)
  assert.equal(work.processRef,'process');assert.equal(work.sourceReceiptRef,'receipt');assert.equal(work.inputAvailable,i!==1)
  assert.deepEqual(work.detail,typeof states[i]==='string'?null:Object.values(states[i])[0])
 }
 for(const kind of ['resolution','invocation','operation','technical']){
  const work=result.roles.find(work=>work.kind===kind)
  assert.deepEqual(work.execution,works[kind].spec.execution)
  assert.deepEqual(work.detail,works[kind].state.Failed)
 }
 const failure={code:'inference-request-invalid',parameters:{sourceOwner:'sem-lang',ownerFailure:'exact original owner failure'}}
 const cleanupFailure={code:'WorkInputUnavailable',parameters:{sourceOwner:'hatter/control'}}
 const failed=inferenceObservation({...input,driver:{phase:'finished',failure,cleanupFailure}})
 assert.deepEqual(failed.failure,failure);assert.deepEqual(failed.cleanupFailure,cleanupFailure);assert.equal(failed.driverFailed,true)
 assert.throws(()=>inferenceObservation({...input,scheduler:{works:{other:{spec:{execution:{kind:'unknown'}}}}}}),/Invalid/)
 assert.throws(()=>inferenceObservation({...input,driver:{phase:'guess'}}),/Invalid/)
 const runtime=Object.create(HatterRuntime.prototype);let calls=0,finish
 runtime.rpc=()=>{calls++;return new Promise(resolve=>finish=resolve)}
 const a=runtime.workObservation(),b=runtime.workObservation();assert.equal(calls,1);finish(input);assert.equal(await a,await b);assert.equal(runtime.workRead,null)
 runtime.rpc=async()=>{throw Error('Unavailable')};await assert.rejects(runtime.workObservation(),/Unavailable/);assert.equal(runtime.workRead,null)
})
