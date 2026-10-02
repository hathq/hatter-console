// Hatter 0.10.0: actual Rust failure wire shapes, not an invented owner status.
import test from 'node:test'
import assert from 'node:assert/strict'
import {managementFailureError,projectManagementFailure} from '../server/lib/management-failure.mjs'
import {requirement} from '../delivery/site.mjs'
import {readiness,validateDelivery} from '@hathq/delivery-contracts'

const raw=(parameters,code='hat-state-unavailable')=>({code:-32000,message:code,data:{
 schema:'hathq://hatter/management-failure/v1',code,
 reasonId:'hathq://vocabulary/reason/dependency-unavailable/v1',class:'availability',
 recovery:'external-change',responsibility:'hatter',operation:'source/execute',parameters,nextActionId:null
}})

test('missing owner offers only explicit setup; corrupt, recovering and uncertain failures preserve their evidence',()=>{
 const setup={id:'hatter:source:provision',owner:'hatter/control',operation:'provision'}
 const original=raw({sourceOwner:'hatter/admission',sourceRecord:'{"Io":"NotFound"}'})
 const missing=requirement('hatter/control','startup',managementFailureError(original),setup)
 assert.equal(missing.state,'SetupRequired');assert.deepEqual(missing.setup,setup)
 assert.deepEqual(missing.failure.detail,projectManagementFailure(original))
 assert.equal(requirement('hatter/control','startup',managementFailureError(original)).state,'Unavailable')
 for(const ownerFailure of [{Unavailable:'Missing'},{Source:{Storage:'NotFound'}}]){
  const error=managementFailureError(raw({sourceOwner:'hatter/control',ownerFailure:JSON.stringify(ownerFailure)}))
  const row=requirement('hatter/control','startup',error,setup)
  assert.equal(row.state,'SetupRequired');assert.deepEqual(row.setup,
   ownerFailure.Unavailable==='Missing'?{id:'hatter:storage:control',owner:'hatter/control',operation:'initialize'}:setup)
  assert.deepEqual(row.failure.detail,error.failure)
 }
 for(const owner of ['hatter/admission','sem-lang','unknown']){
  const row=requirement('hatter/control','startup',managementFailureError(raw({sourceOwner:owner,ownerFailure:'{"Unavailable":"Missing"}'})),setup)
  assert.equal(row.setup?.owner??null,owner==='unknown'?null:owner)
 }
 const details=[{control:'{"Graph":{"Storage":"[redacted]"}}'},
  {control:'{"Graph":{"Commit":"RecoveryRequired"}}'},
  {sourceRecord:'{"Io":"PermissionDenied"}'},
  ...[{Unavailable:'Corrupt'},{Unavailable:'RecoveryRequired'},{Source:{Storage:'PermissionDenied'}},
    {phase:'exchange',dispatch:'OutcomeUncertain'}].map(ownerFailure=>({sourceOwner:'hatter/control',ownerFailure:JSON.stringify(ownerFailure)}))]
 for(const parameters of details){
  const error=managementFailureError(raw(parameters)),row=requirement('hatter/control','startup',error,setup)
  assert.equal(row.state,'Unavailable');assert.equal(row.setup,null)
  assert.deepEqual(row.failure.detail,error.failure)
  const envelope={contract:'hatter/delivery/1',site:{id:'fixture',revision:'a'.repeat(64)},
   initial:null,snapshot:null,readiness:readiness([row.ref],[row]),assets:[],transport:{path:'/api/projection-live',classes:['STATE']}}
  assert.equal(validateDelivery(envelope).readiness.state,'Unavailable')
 }
 const uncertain=managementFailureError(raw({},'hat-execution-outcome-uncertain'))
 assert.equal(requirement('hat/provider','invoke',uncertain,setup).setup,null)
 assert.equal(requirement('hat/provider','invoke',uncertain,setup).failure.code,'hat-execution-outcome-uncertain')
})

test('exact Graph dependency conflict survives Console validation without admitting paths or private payloads',()=>{
 const expected={sequence:1,commit:'a'.repeat(64)},actual={sequence:2,commit:'b'.repeat(64)}
 const detail={Graph:{DependencyConflict:{space:'hatter/package/control/installations',expected,actual}}}
 const original=raw({control:JSON.stringify(detail)},'inference-state-revision-conflict')
 assert.deepEqual(projectManagementFailure(original)?.parameters,original.data.parameters)
 for(const space of ['/home/private','../private','hatter//installations','hatter/../private']){
  const invalid=structuredClone(detail);invalid.Graph.DependencyConflict.space=space
  assert.equal(projectManagementFailure(raw({control:JSON.stringify(invalid)})),null)
 }
 const invalid=structuredClone(detail);invalid.Graph.DependencyConflict.expected={sequence:0,commit:'a'.repeat(64)}
 assert.equal(projectManagementFailure(raw({control:JSON.stringify(invalid)})),null)
 const privateValue=structuredClone(detail);privateValue.Graph.DependencyConflict.path='/private'
 assert.equal(projectManagementFailure(raw({control:JSON.stringify(privateValue)})),null)
 assert.equal(projectManagementFailure(raw({semantic:JSON.stringify(detail)})),null)
})
