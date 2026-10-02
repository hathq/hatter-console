// Hatter-owned presentation of exact Role observations, NOT an admission decision.
// Neither a binding nor a provider registration proves a usable runtime or grant.
export function rolePreparation(role,record){
 const count=value=>Array.isArray(value)?value.length:null
 const bindings=count(record?.hat_binding_refs)
 return {sourceRef:role?.roleRef??null,executionReadiness:'not-verified',
  label:!role?'Role information unavailable':'Execution preparation not verified',
  detail:'HAT links are not semantic execution bindings or permission to run a model.',
  facts:[{label:'Declared HAT links',value:bindings}]}
}

// Exact inspection already performed by the observation owner. No extra model
// probing, inferred permissions, or independent readiness authority.
export function feedbackPreparation(context){
 if(!context?.roleRef||!['bindingRefs','providerRefs','grantRefs'].every(key=>Array.isArray(context[key])&&context[key].length<=128)
   ||!Number.isSafeInteger(context.adoptedBindingCount)||context.adoptedBindingCount<0)throw Object.assign(Error('RoleObservationInvalid'),{code:'RoleObservationInvalid'})
 return {sourceRef:context.roleRef,executionReadiness:'not-verified',
  label:'Execution context',detail:'Observed references are not proof of an executable operation. Execution validates the exact meaning, scope and permission.',
  facts:[{label:'Semantic execution binding sets',value:context.bindingRefs.length},
   {label:'Provider references',value:context.providerRefs.length},{label:'Grant references',value:context.grantRefs.length},
   {label:'Adopted semantic bindings',value:context.adoptedBindingCount}]}
}
