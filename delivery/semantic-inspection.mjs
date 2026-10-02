// Hatter 2026: passive exact owner observations, never a new semantic authority.
import {semanticOverview} from './semantic-overview.mjs'
export async function semanticInspection(runtime,roleId){
 const listed=await runtime.rpc('inference/role/list',{maximumItems:32})
 const roles=listed.roles.map(r=>({id:r.roleRef.id,ref:r.roleRef}))
 const selected=roleId?roles.find(r=>r.id===roleId):roles[0]
 if(roleId&&!selected)throw Object.assign(Error('UnknownSemanticRole'),{code:'UnknownSemanticRole'})
 if(!selected)return {roles,selected:null,documents:[],failures:[],overview:semanticOverview([])}
 const documents=[],failures=[],ref=selected.ref
 for(const [method,params,keys]of [
  ['profile/dictionary/read',{roleRef:ref,maximumItems:256},['definitions','bindings','restoration']],
  ['profile/entry/list',{roleRef:ref,maximumItems:256},['claims','provenance']],
  ['inference/role/memory',{roleRef:ref},['shortTerm']]
 ]){
  try{
   const result=await runtime.rpc(method,params)
   if(!['schema','id','revision','digest_sha256'].every(k=>result.roleRef?.[k]===ref[k]))throw Object.assign(Error('SemanticReferenceMismatch'),{code:'SemanticReferenceMismatch'})
   for(const key of keys){if(!Object.hasOwn(result,key))throw Object.assign(Error('SemanticStructureMissing'),{code:'SemanticStructureMissing'})}
   // Each observation retains its own revision. Never imply a cross-read atomic snapshot.
   for(const key of keys)documents.push({id:key,label:key,value:result[key],source:{method,roleRef:ref,semanticRevision:result.semanticRevision,memoryRevision:result.memoryRevision??null,truncated:result.truncated===true}})
  }catch(error){failures.push({method,error})}
 }
 if(Buffer.byteLength(JSON.stringify(documents))>524288)throw Object.assign(Error('SemanticInspectionLimitExceeded'),{code:'SemanticInspectionLimitExceeded'})
 return {roles,selected:selected.id,documents,failures,overview:semanticOverview(documents)}
}
