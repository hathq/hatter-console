// Hatter 0.10.0: exact owner input and detached Work response projection.
import test from 'node:test'
import assert from 'node:assert/strict'
import {produce,scene,canonical} from '@hathq/projection-contracts'
import {exactInteraction,submitInteraction,ownerCommandFailure} from '../server/runtime/product-interactions.mjs'
import {DiagnosticStore} from '../server/lib/diagnostic-store.mjs'
const source={owner:'hatter/control',ref:'receipt:1',revision:'revision:1',kind:'control'}
const reference={schema:'confirmation',id:'c',revision:1,digest_sha256:'a'.repeat(64)}
function fixture(kind='resolution'){
  const source={owner:kind==='subject'?'sem-lang':'hatter/control',ref:'receipt:1',revision:'revision:1',kind:kind==='subject'?'semantic':'control'}
  const input={action:{operation_id:kind==='subject'?'digital-twin/contribution/apply':'inference/role/decide',target:'c',contract_revision:'contract:1',availability:{state:'available'},expected_revision_required:true,
    input_schema:{type:'object',fields:{choice:{type:'string',min_length:1,max_length:64,choices:['exact-option']}},required:['choice']}},
    fields:{choice:{label:'Select',sensitive:false,choices:[{value:'exact-option',label:'Human label'}]}}}
  const interaction={ref:canonical(reference),generation:'g:1',inputContractRef:'contract:1',input}
  const snapshot=scene(produce({key:'product:key',producer:{id:'test',version:'0.10.0',contract:'test',configuration:'test'},sources:[source],focus:'c',purpose:kind,visibilityRef:'owner',limits:{}},
    [{source,items:[{id:'confirmation',semanticRef:null,group:{kind:'structural',ref:'c'},value:{kind:'confirmation',reference},evidence:[],provenance:[],resolutionRefs:[],visibility:'visible'}],relations:[],unresolved:[],truncated:false}]),
    {key:'product:key',focus:'c',purpose:kind,regions:[],actions:[{id:'decide',targetOwner:'hatter',commandRef:kind==='subject'?'digital-twin/contribution/apply':'inference/role/decide',label:'Decide',sourceRefs:[source],contextRefs:['c'],interaction}]})
  const submission={projectionKey:snapshot.key,projectionRevision:snapshot.revision,sceneId:snapshot.key,actionId:'decide',
    interactionRef:interaction.ref,generation:interaction.generation,inputContractRef:interaction.inputContractRef,values:{choice:'exact-option'}}
  return {snapshot,submission,product:{read:()=>snapshot}}
}
test('Resolution admission is not a completed decision and relies on the existing canonical publication watcher',async()=>{
  const {product,submission}=fixture(),requestRef='f'.repeat(64)
  const work={spec:{requestRef,execution:{kind:'resolution',confirmationRef:reference}},state:'Runnable'}
  let calls=0
  const result=await submitInteraction(product,async()=>{calls++;return {state:'Accepted',requestRef,work}},submission,
    ()=>assert.fail('queued Work must not publish a fabricated decision receipt'))
  assert.equal(calls,1)
  assert.equal(result.canonical.workRef,requestRef)
  assert.equal(result.canonical.receiptRef,null)
  assert.equal(result.canonical.outcome,null)
  assert.equal(result.projection.state,'Pending')
  assert.deepEqual(result.work,work)
})
test('product submission fences exact Scene/generation/contract/choice, supplies owner refs only from retained Scene, and separates accepted canonical result from projection failure',async()=>{
  // HTTP framing/admission is tested against the delivery-server socket, not
  // the superseded h3 adapter. This case owns exact product interaction binding.
  const {product,submission}=fixture()
  assert.deepEqual(exactInteraction(product,submission),{operation:'submit',confirmationRef:reference,generation:'g:1',inputContractRef:'contract:1',values:{choice:'exact-option'}})
  for(const invalid of [
    {...submission,sourceTuple:[source]}, {...submission,projectionRevision:'old'}, {...submission,sceneId:'other'},
    {...submission,generation:'old'}, {...submission,inputContractRef:'other'}, {...submission,interactionRef:'other'},
    {...submission,values:{choice:'Human label'}}, {...submission,values:{choice:'exact-option',roleRef:'other'}},
  ])assert.throws(()=>exactInteraction(product,invalid))
  let calls=0
  const {product:sourceProduct,submission:sourceSubmission}=fixture('subject')
  const result=await submitInteraction(sourceProduct,async(method,request)=>{
    calls++;assert.equal(method,'interaction/execute');assert.equal(request.values.choice,'exact-option')
    return {receipt:{commit:{commit_ref:'accepted'},restoration:{secret:'private'}},outcome:{kind:'Resolved'}}
  },sourceSubmission,async()=>{throw Object.assign(Error('not published'),{code:'ProjectionQueueFull'})})
  assert.equal(calls,1);assert.equal(result.canonical.state,'Accepted');assert.equal(result.canonical.receiptRef,'accepted')
  assert.equal(result.projection.state,'FailedTyped');assert.ok(!JSON.stringify(result).includes('private'))
  await assert.rejects(submitInteraction(product,async()=>{throw Error('canonical rejected')},submission,()=>assert.fail('cannot publish rejected command')))
})
test('validated interaction lineage joins delivery without values, principal inference or observer authority',async()=>{
  const {product,snapshot,submission}=fixture('subject'),store=new DiagnosticStore()
  const requestRef='00000000-0000-0000-0000-000000000001',receiptRef='e'.repeat(64)
  let effects=0
  await store.withOperation(requestRef,()=>submitInteraction(product,async()=>{effects++;return {commit:{commit_ref:receiptRef}}},
    submission,async()=>({state:'Pending'}),()=>{},context=>{
      store.recordObservation(context)
      context.sourceRefs[0].revision='observer cannot change owner input'
      context.dataProjectionRef.revision='observer cannot change lineage'
      throw Error('observer failure must not cancel dispatch')
    }))
  store.recordObservation({requestRef,owner:'hatter/control',stage:'OWNER_COMMITTED',receiptRef,
    operation:'interaction/execute',httpStatus:200,managementRequestRef:2})
  const observation=store.list()[0].observation,context=observation.interaction
  assert.equal(effects,1);assert.equal(store.list().length,1)
  assert.deepEqual(context.sceneRef,{key:snapshot.key,revision:snapshot.revision})
  assert.deepEqual(context.dataProjectionRef,snapshot.lineage.dataProjection)
  assert.notEqual(context.sceneRef.revision,context.dataProjectionRef.revision)
  assert.deepEqual(context.sourceRefs,[{...source,owner:'sem-lang',kind:'semantic'}]);assert.equal(context.inputGeneration,submission.generation)
  assert.equal(context.actionId,submission.actionId);assert.equal(observation.receiptRef,receiptRef)
  assert.ok(!JSON.stringify(observation).includes('exact-option'))
  assert.equal(Object.hasOwn(context,'principalRef'),false)
  assert.throws(()=>exactInteraction(product,{...submission,projectionRevision:'stale'},()=>assert.fail('unvalidated input cannot be reported as exact')))
})
test('exact interaction outcomes preserve no-dispatch, owner rejection, uncertain disconnect and original commit through publication failure without resends',async()=>{
  const {product,submission}=fixture('subject'),receiptRef='c'.repeat(64)
  const failure={code:'inference-request-invalid',reasonId:'hathq://vocabulary/reason/operation-rejected/v1',class:'input',
    recovery:'none',responsibility:'hatter',operation:'interaction/execute',parameters:{},nextActionId:null}
  for(const [phase,expected]of [['NotDispatched','NOT_DISPATCHED'],['PossiblyDispatched','OUTCOME_UNCERTAIN'],['OwnerResponded','OWNER_REJECTED']]){
    let calls=0;const observations=[]
    const error=Object.assign(Error('private owner implementation'),{failure,rpc:{phase,requestRef:phase==='NotDispatched'?null:7}})
    await assert.rejects(submitInteraction(product,async()=>{calls++;throw error},submission,()=>assert.fail('cannot publish unproven command'),v=>observations.push(v)),e=>e===error)
    assert.equal(observations.at(-1).stage,expected);assert.equal(calls,1)
  }
  const unclassified=[]
  await assert.rejects(submitInteraction(product,async()=>{throw Object.assign(Error('unknown commit disposition'),{
    rpc:{phase:'OwnerResponded',requestRef:8},failure:{...failure,code:'unclassified-owner-failure',class:'conflict'}})},submission,
    ()=>assert.fail('cannot publish uncertain command'),v=>unclassified.push(v)))
  assert.equal(unclassified.at(-1).stage,'OUTCOME_UNCERTAIN','an error class alone cannot prove absence of a commit')
  const committed={domain:'control',operation_id:'role:interaction',prepared_ref:'a'.repeat(64),commit_ref:receiptRef,parent_refs:[],
    previous_revision:{sequence:1,commit:'b'.repeat(64)},committed_revision:{sequence:2,commit:receiptRef},payload_digest:'d'.repeat(64)}
  const afterCommit=Object.assign(Error('private raw detail'),{rpc:{phase:'OwnerResponded',requestRef:8},
    failure:{...failure,code:'inference-state-unavailable',reasonId:'hathq://vocabulary/reason/dependency-unavailable/v1',class:'availability',recovery:'external-change',
      parameters:{sourceOwner:'sem-lang',ownerFailure:JSON.stringify({Role:{Publication:{PublishedSource:{receipt:committed,source:'Unavailable'}}}})}}})
  const observations=[]
  await assert.rejects(submitInteraction(product,async()=>{throw afterCommit},submission,()=>assert.fail('owner registration failed'),v=>observations.push(v)),e=>e===afterCommit)
  assert.equal(observations.at(-1).stage,'OWNER_COMMITTED');assert.equal(observations.at(-1).receiptRef,receiptRef)
  const safe=ownerCommandFailure(afterCommit,'hatter/control','interaction/execute')
  assert.deepEqual(JSON.parse(safe.failure.detail.parameters.ownerFailure).Role.Publication.PublishedSource.receipt,committed)
  assert.ok(!JSON.stringify(safe.failure).includes('private'))
  for(const parameters of [
    {canonicalReceipt:JSON.stringify(committed)},
    {sourceOwner:'hatter/control',ownerFailure:afterCommit.failure.parameters.ownerFailure},
    {sourceOwner:'sem-lang',ownerFailure:JSON.stringify({Other:{Publication:{PublishedSource:{receipt:committed,source:'Unavailable'}}}})},
    {sourceOwner:'sem-lang',ownerFailure:JSON.stringify({Role:{Publication:{PublishedSource:{receipt:{...committed,commit_ref:'bad'},source:'Unavailable'}}}})},
    {sourceOwner:'sem-lang',ownerFailure:JSON.stringify({Role:{Publication:{PublishedSource:{receipt:committed,source:'Unavailable',extra:true}}}})},
  ]) {
    const error=Object.assign(Error('untrusted disposition'),{rpc:afterCommit.rpc,failure:{...afterCommit.failure,parameters}})
    const stages=[]
    await assert.rejects(submitInteraction(product,async()=>{throw error},submission,()=>assert.fail('unproven publication'),v=>stages.push(v)),e=>e===error)
    assert.equal(stages.at(-1).stage,'OUTCOME_UNCERTAIN')
  }
  const forged=Object.assign(Error('untrusted'),{failure:{...failure,parameters:{token:'a secret'}}})
  assert.equal(ownerCommandFailure(forged,'hatter/control','interaction/execute'),forged)
  for(const code of ['ProjectionQueueFull','CrowsiPublicationUnavailable']){
    let effects=0;const stages=[]
    const result=await submitInteraction(product,async()=>{effects++;return {commit:committed}},submission,
      async()=>{throw Object.assign(Error('private publication detail'),{code})},v=>stages.push(v))
    assert.equal(effects,1);assert.equal(result.canonical.receiptRef,receiptRef)
    assert.equal(result.projection.state,'FailedTyped');assert.equal(result.projection.code,code)
    assert.equal(stages.at(-1).stage,'PUBLICATION_FAILED_AFTER_COMMIT')
  }
  let effects=0
  await submitInteraction(product,async()=>{effects++;return {commit:committed}},submission,async()=>({state:'Pending'}),()=>{throw Error('diagnostic sink')})
  assert.equal(effects,1)
})
