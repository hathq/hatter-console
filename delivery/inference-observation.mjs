// Hatter downstream 2026: project every canonical Work and its original failures.
// Read-only display of the shared scheduler. Running is a
// dispatch reservation, NEVER proof of physical token generation or progress.
export function inferenceObservation(value){
 const fail=()=>{throw Object.assign(Error('InferenceObservationInvalid'),{code:'InferenceObservationInvalid'})}
 if(!value?.scheduler?.works||typeof value.scheduler.works!=='object'||Array.isArray(value.scheduler.works)
   ||Object.keys(value.scheduler.works).length>128||!['idle','waiting','readingScheduler','dispatching','reconciling','finished'].includes(value.driver?.phase))fail()
 const counts={Runnable:0,Blocked:0,Running:0,Completed:0,Failed:0,Cancelled:0},roles=[]
 for(const work of Object.values(value.scheduler.works)){
  const kind=work.spec?.execution?.kind
  if(!['inference','resolution','invocation','operation','technical'].includes(kind))fail()
  const state=typeof work.state==='string'?work.state:Object.keys(work.state??{}).length===1?Object.keys(work.state)[0]:null
  if(!Object.hasOwn(counts,state)||!work.spec.roleRef?.id)fail()
  counts[state]++;roles.push({roleRef:work.spec.roleRef,state,kind,execution:work.spec.execution,requestRef:work.spec.requestRef,runtimeRef:work.spec.execution.runtimeRef,
   processRef:work.spec.execution.processRef,scopeRef:work.spec.scopeRef,sourceReceiptRef:work.spec.sourceReceiptRef,
   prerequisite:work.spec.prerequisite,acceptedSequence:work.acceptedSequence,inputAvailable:work.inputAvailable,
   detail:typeof work.state==='string'?null:work.state[state]})
 }
 return {available:true,counts,roles,driverPhase:value.driver.phase,revision:value.controlRevision,
  driverFailed:Boolean(value.driver.failure||value.driver.cleanupFailure||value.driver.workerFinished),
  failure:value.driver.failure??null,cleanupFailure:value.driver.cleanupFailure??null,physicalProgress:'not-observed'}
}
