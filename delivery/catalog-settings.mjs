// Hatter downstream 2026: presentation of original catalog-source commands.
// No catalog authority, implicit trust, source switching or read-time mutation.
import {validateInputValues} from '@zixcel/interaction/input'

const fields={
 sourceId:['Source ID',128],label:['Display name',100],
 kind:['Source type',32,[['https','HTTPS'],['local_directory','Local directory']]],
 location:['HTTPS address or absolute directory path',4096],
 logicalOrigin:['Signed catalog origin (HTTPS)',2048],
 signingKeyId:['Signing key ID',128],publicKeyHex:['Trusted public key (64 hexadecimal characters)',64],
 federationSigningKeyId:['Federation signing key ID (optional)',128],
 federationPublicKeyHex:['Federation public key (optional)',64],
 select:['Use this source',null]
}
export function catalogActions(registry){
 const revision=registry.revision
 const declaration=(operation,spec)=>({action:{operation_id:'hat/catalog-source/'+operation,
  target:'hatter/catalog-source',contract_revision:'catalog-source:'+revision,availability:{state:'available'},expected_revision_required:true,
  input_schema:{type:'object',fields:Object.fromEntries(Object.entries(spec).map(([id,[,maximum,choices]])=>[id,maximum===null?{type:'boolean'}:
   {type:'string',min_length:id.startsWith('federation')?0:1,max_length:maximum,...(choices?{choices:choices.map(([value])=>value)}:{})}])),required:Object.keys(spec)}},
  fields:Object.fromEntries(Object.entries(spec).map(([id,[label,,choices]])=>[id,{label,sensitive:false,...(choices?{choices:choices.map(([value,label])=>({value,label}))}:{})}]))})
 return [
  {id:'catalog:select:'+revision,label:'Choose distribution source',input:declaration('select',{sourceId:['Distribution source',128,registry.sources.map(s=>[s.sourceId,s.label])]})},
  {id:'catalog:write:'+revision,label:'Register distribution source',input:declaration('write',fields)}
 ]
}
export async function submitCatalogSettings(runtime,id,values){
 const match=/^catalog:(write|select):(0|[1-9][0-9]*)$/u.exec(id)
 if(!match||!Number.isSafeInteger(Number(match[2])))throw Object.assign(Error('InvalidInput'),{code:'InvalidInput'})
 const registry=await runtime.catalogSources(),expectedRevision=Number(match[2])
 // Preserve the reviewed revision: do not silently rebase a stale form onto
 // current settings. The canonical owner also enforces this exact CAS.
 if(registry.revision!==expectedRevision)throw Object.assign(Error('hat-state-revision-conflict'),{code:'hat-state-revision-conflict'})
 const action=catalogActions(registry).find(a=>a.id===id)
 if(!action||validateInputValues(action.input,values).length)throw Object.assign(Error('InvalidInput'),{code:'InvalidInput'})
 if(match[1]==='select')return runtime.selectCatalogSource({...values,expectedRevision})
 return runtime.writeCatalogSource({...values,expectedRevision,
  federationSigningKeyId:values.federationSigningKeyId||null,federationPublicKeyHex:values.federationPublicKeyHex||null})
}
