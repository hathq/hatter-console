import test from 'node:test'
import assert from 'node:assert/strict'
import {rolePreparation,feedbackPreparation} from '../delivery/role-preparation.mjs'

test('role observations preserve unknown versus empty and never equate bindings with permission or execution',()=>{
 const ref={id:'role:one',revision:1}
 assert.equal(rolePreparation(null,null).label,'Role information unavailable')
 const empty=rolePreparation({roleRef:ref},{hat_binding_refs:[]})
 assert.equal(empty.label,'Execution preparation not verified')
 assert.deepEqual(empty.facts.map(f=>f.value),[0])
 assert.deepEqual(empty.sourceRef,ref)
 const unknown=rolePreparation({roleRef:ref},null)
 assert.equal(unknown.label,'Execution preparation not verified')
 assert(unknown.facts.every(f=>f.value===null))
 const bound=rolePreparation({roleRef:ref},{hat_binding_refs:[{}]})
 assert.equal(bound.label,'Execution preparation not verified')
 assert.equal(bound.executionReadiness,'not-verified')
 assert(!JSON.stringify([empty,unknown,bound]).match(/mail|Microsoft|OpenAI/))
 const context={roleRef:ref,bindingRefs:[{namespace:'owner',revision:'exact'}],providerRefs:[],grantRefs:[],adoptedBindingCount:2}
 const preparation=feedbackPreparation(context)
 assert.deepEqual(preparation.sourceRef,ref);assert.deepEqual(preparation.facts.map(f=>f.value),[1,0,0,2])
 assert.equal(preparation.executionReadiness,'not-verified')
 for(const invalid of [null,{}, {...context,grantRefs:null},{...context,adoptedBindingCount:-1}])assert.throws(()=>feedbackPreparation(invalid),/RoleObservationInvalid/)
})
