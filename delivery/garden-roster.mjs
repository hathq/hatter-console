import {conversationViews} from './role-conversation.mjs'
import {rolePreparation} from './role-preparation.mjs'

// Equal concurrent observations borrow one owner read. No success/error cache,
// replay, extra queue or relaxation of the transport's four-response budget.
export function gardenReader(runtime){
 const pending=new Map()
 const share=(key,read)=>{
  if(pending.has(key))return pending.get(key)
  if(pending.size>=8)return Promise.reject(Object.assign(Error('ProjectionQueueFull'),{code:'ProjectionQueueFull'}))
  const result=Promise.resolve().then(read).finally(()=>pending.delete(key));pending.set(key,result);return result
 }
 return {candidates:()=>share('candidates',()=>runtime.publication.candidates()),
  labels:candidates=>share(JSON.stringify(candidates),()=>gardenRoster(runtime,candidates))}
}

// Decoration over current owner references, never a cache or another Role store.
export async function gardenRoster(runtime,candidates){
 const world={title:'Your world',objects:[]}
 if(!candidates.length)return world
 const roles=await runtime.rpc('inference/role/list',{maximumItems:32})
 const representatives=await runtime.operationalRecords('representative-role',32)
 world.objects=candidates.map(candidate=>{
  const role=roles.roles.find(r=>['id','revision','digest_sha256','schema'].every(k=>r.roleRef[k]===candidate.roleRef[k]))
  const record=representatives.records.find(r=>role?.identityRef?.id==='representative-role:'+r.instance_id&&role.identityRef.revision===r.revision)
  return {id:candidate.roleRef.id,title:record?.display_name??'Display name unavailable',summary:record?.description??'Review this subject in System.',symbol:'person',status:role?candidate.availability:'Updating',roleRef:candidate.roleRef,preparation:rolePreparation(role,record),hatBindings:record?.hat_binding_refs??[],activities:conversationViews(runtime.publication.inspect().streams??[],candidate.roleRef.id)}
 })
 return world
}
