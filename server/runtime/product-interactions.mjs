// Hatter product command orchestration. Inputs/meaning/decisions remain owned
// by their existing providers; a Scene action is never an execution grant.
import {canonical} from '@hathq/projection-contracts'
import {validateSubmission,inputAction} from '@hathq/delivery-contracts'
import {sceneInput} from './scene-input.mjs'
import {projectManagementFailure,committedOwnerReceipt} from '../lib/management-failure.mjs'
const fail=code=>{throw Object.assign(Error(code),{code})}
export function ownerCommandFailure(error,owner,operation){
  const candidate=error?.failure
  const detail=projectManagementFailure({code:-32000,message:candidate?.code,
    data:{schema:'hathq://hatter/management-failure/v1',...candidate}})
  if(!detail)return error
  // Reuse the delivery requirement failure shape. Preserve only already
  // validated owner data, not implementation messages, paths or credentials.
  return Object.assign(new Error(detail.code,{cause:error}),{failure:{owner,operation,
    code:detail.code,requirementRef:'hatter:'+operation,detail}})
}
export function interactionFailure(error){
  const codes=new Set(['InvalidInput','ProjectionLimitExceeded','SceneUnavailable','StaleSceneAction','InteractionUnavailable',
    'ProjectionUnavailable','ProjectionQueueFull','ProjectionStoreBusy','ProjectionRuntimeClosed','SourceUnavailable','SourceNotRetained','ProjectionInputTimeout'])
  const code=codes.has(error?.code)?error.code:error?.failure?.code
    ??(/^hatter-console-[a-z0-9-]{3,96}$/u.test(error?.message??'')?error.message:error instanceof SyntaxError?'InvalidInput':'OwnerUnavailable')
  return {code,ownerFailure:error?.failure??null}
}
export function exactInteraction(product,submission,onValidated=()=>{}){
  validateSubmission(submission)
  const stored=product.read(submission.projectionKey)
  if(!stored)fail('SceneUnavailable')
  const snapshot=sceneInput(stored)
  const action=inputAction(snapshot,submission)
  const binding=action.interaction
  // Observe only the retained, validated references, never input values or
  // presentation labels. Target context is not a communicating principal.
  const ready=request=>{
    try{onValidated({kind:'interaction-context',sceneRef:{key:snapshot.key,revision:snapshot.revision},
      dataProjectionRef:{...snapshot.lineage.dataProjection},actionId:action.id,
      inputGeneration:binding.generation,inputContractRef:binding.inputContractRef,
      sourceRefs:action.sourceRefs.map(source=>({...source}))})}catch{}
    return request
  }
  if(action.targetOwner!=='hatter')fail('InteractionUnavailable')
  if(action.commandRef==='digital-twin/contribution/apply'){
    if(snapshot.data.purpose!=='subject'||!action.sourceRefs.some(s=>s.owner==='sem-lang'))fail('StaleSceneAction')
    return ready({operation:'sourceSubmit',providerId:binding.ref,generation:binding.generation,inputContractRef:binding.inputContractRef,values:submission.values})
  }
  if(action.commandRef!=='inference/role/decide')fail('InteractionUnavailable')
  // The exact reference is taken from a retained server Scene, never from a
  // client-chosen source tuple or an interpretation of presentation labels.
  const confirmation=snapshot.data.items.find(i=>i.value?.kind==='confirmation'
    &&canonical(i.value.reference)===binding.ref&&i.sourceRefs.some(s=>action.sourceRefs.some(a=>canonical(a)===canonical(s))))
  if(!confirmation)fail('StaleSceneAction')
  return ready({operation:'submit',confirmationRef:confirmation.value.reference,generation:binding.generation,
    inputContractRef:binding.inputContractRef,values:submission.values})
}
export async function submitInteraction(product,rpc,submission,publish,observe=()=>{},onValidated=()=>{}){
  const observation={owner:'hatter/control',operation:'interaction/execute'}
  const record=value=>{try{observe({...observation,...value})}catch{}}
  record({stage:'NOT_DISPATCHED'})
  const request=exactInteraction(product,submission,onValidated)
  record({stage:'OUTCOME_UNCERTAIN'})
  let result
  try{result=await rpc('interaction/execute',request,undefined,value=>{
    record({stage:value.phase==='NotDispatched'?'NOT_DISPATCHED':'OUTCOME_UNCERTAIN',managementRequestRef:value.requestRef})
  })}catch(error){
    if(error?.rpc?.phase==='NotDispatched')record({stage:'NOT_DISPATCHED',managementRequestRef:error.rpc.requestRef})
    const candidate=error?.failure
    const failure=projectManagementFailure({code:-32000,message:candidate?.code,
      data:{schema:'hathq://hatter/management-failure/v1',...candidate}})
    const receipt=committedOwnerReceipt(failure)
    if(receipt)record({stage:'OWNER_COMMITTED',receiptRef:receipt.commit_ref})
    // Only this audited validation rejection establishes no canonical mutation
    // in the current source/decision entrypoints. A generic error class is NOT
    // an execution disposition, even when an owner response was received.
    if(error?.rpc?.phase==='OwnerResponded'&&failure?.code==='inference-request-invalid'
      &&!failure?.parameters?.ownerFailure)record({stage:'OWNER_REJECTED'})
    throw error
  }
  if(request.operation==='submit'){
    // Work admission is not a semantic decision. Existing canonical Activity
    // reconciliation observes completion; HTTP owns neither polling nor execution.
    if(result.state!=='Accepted'||!/^[a-f0-9]{64}$/u.test(result.requestRef??'')
      ||result.work?.spec?.requestRef!==result.requestRef||result.work.spec.execution?.kind!=='resolution')fail('InteractionUnavailable')
    return {canonical:{state:'Accepted',workRef:result.requestRef,receiptRef:null,outcome:null},
      work:result.work,projection:{state:'Pending'}}
  }
  const canonicalResult={receiptRef:result.commit?.commit_ref??result.receipt?.commit?.commit_ref??null,roleRef:result.roleRef??result.receipt?.roleRef??null,
    outcome:result.outcome?.kind??result.resolution?.reason??null}
  if(request.operation==='sourceSubmit'&&result.commit===null)return {canonical:{state:'Unresolved',...canonicalResult},projection:{state:'Unchanged'}}
  if(canonicalResult.receiptRef)record({stage:'OWNER_COMMITTED',receiptRef:canonicalResult.receiptRef})
  // A successful owner mutation must never be reported as rejected merely
  // because derived publication or transport is temporarily unavailable.
  let projection
  try{projection=await publish(result)}catch(error){
    record({stage:'PUBLICATION_FAILED_AFTER_COMMIT',receiptRef:canonicalResult.receiptRef})
    projection={state:'FailedTyped',code:error.code??'ProjectionUnavailable',ownerFailure:error.failure??null}
  }
  return {canonical:{state:'Accepted',...canonicalResult},projection}
}
