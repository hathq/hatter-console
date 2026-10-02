import assert from 'node:assert/strict'
// Hatter 0.10.0: communication attribution is not an authorization identity.
import test from 'node:test'
import { DiagnosticStore } from '../server/lib/diagnostic-store.mjs'
import {
  failureFromError, managementFailureError, projectManagementFailure
} from '../server/lib/management-failure.mjs'

const semantic = { code: -32000, message: 'hat-worker-unavailable', data: {
  schema: 'hathq://hatter/management-failure/v1', code: 'hat-worker-unavailable',
  reasonId: 'hathq://vocabulary/reason/hat-worker-unavailable/v1',
  class: 'availability', recovery: 'external-change', responsibility: 'hat',
  operation: 'hat/worker/read', parameters: {}, nextActionId: null
} }

test('uncertain external outcome survives projection and diagnostics without suggesting resend',()=>{
  const raw={...semantic,message:'hat-execution-outcome-uncertain',data:{...semantic.data,
    code:'hat-execution-outcome-uncertain',operation:'hat/invocation/control',
    reasonId:'hathq://vocabulary/reason/dependency-unavailable/v1'}}
  const projected=projectManagementFailure(raw)
  assert.deepEqual(failureFromError(managementFailureError(raw)),projected)
  assert.equal(projected.recovery,'external-change')
  assert.equal(projected.nextActionId,null)
  const store=new DiagnosticStore(4,()=>10)
  store.record(raw.message,'warning','hat',projected)
  assert.equal(store.list()[0].operation,'hat/invocation/control')
  assert.equal(store.list()[0].recovery,'external-change')
})

test('historical evidence failures remain distinct and never turn into a retry instruction', () => {
  for (const suffix of ['unavailable', 'expired', 'transport-failed', 'storage-failed', 'conflict', 'rejected']) {
    const conflict = ['conflict', 'rejected'].includes(suffix)
    const code = `hat-execution-evidence-${suffix}`
    const raw = { ...semantic, message: code, data: { ...semantic.data, code,
      operation: 'hat/invocation/evidence/recover', class: conflict ? 'conflict' : 'availability',
      reasonId: `hathq://vocabulary/reason/${conflict ? 'precondition-unmet' : 'dependency-unavailable'}/v1` } }
    const projected = projectManagementFailure(raw)
    assert.equal(projected.code, code)
    assert.equal(projected.recovery, 'external-change')
    assert.equal(projected.nextActionId, null)
    assert.equal(projected.responsibility, 'hat')
    assert.deepEqual(failureFromError(managementFailureError(raw)), projected)
    const evidence = suffix === 'conflict' ? { Conflict: {
      references: ['[redacted]', 'a'.repeat(64)], total: 20, omitted: 18
    } } : suffix === 'storage-failed' ? { Storage: 'DeliveryUnknown' }
      : ({ unavailable: 'Unavailable', expired: 'Expired',
        'transport-failed': 'Transport', rejected: 'Proof' })[suffix]
    const parameters = { sourceOwner: 'hatter/admission',
      ownerFailure: JSON.stringify({ Admission: { Evidence: evidence } }) }
    const owned = projectManagementFailure({ ...raw, data: { ...raw.data, parameters } })
    assert.deepEqual(owned?.parameters, parameters)
    assert.equal(owned.recovery, 'external-change')
    assert.equal(owned.nextActionId, null)
    const store = new DiagnosticStore(4, () => 10)
    store.record(code, 'warning', 'hat', projected)
    assert.equal(store.list()[0].reasonId, raw.data.reasonId)
    assert.equal(store.list()[0].operation, raw.data.operation)
    assert.equal(projectManagementFailure({ ...raw, data: { ...raw.data,
      parameters: { signingKey: 'private', proof: 'private' } } }), null)
  }
})

test('exact scheduler exclusion refusal is preserved without accepting arbitrary component text',()=>{
  const parameters={component:'hatter/scheduler',schedulerBoundary:'dispatchExclusion',schedulerExclusion:'TimedOut',transport:'Backpressure',
    sourceOwner:'sem-lang',ownerFailure:JSON.stringify({Invocation:{Reservation:'TimedOut'}})}
  const raw={code:-32000,message:'management-transport-failed',data:{...semantic.data,
    code:'management-transport-failed',class:'limit',recovery:'none',responsibility:'hatter',
    operation:'interaction/execute',parameters}}
  assert.deepEqual(projectManagementFailure(raw)?.parameters,parameters)
  for(const [key,value] of [['component','/private/location'],['schedulerBoundary','unknown'],['schedulerExclusion','retry']])
    assert.equal(projectManagementFailure({...raw,data:{...raw.data,parameters:{...parameters,[key]:value}}}),null)
  for(const detail of [{Projection:{Retention:'Unavailable'}},{Projection:{Retention:'Mismatch'}},
    {Maintenance:{Retention:'Required'}},
    {Maintenance:{Retention:{Repository:{CommitFailure:'DeliveryUnknown'}}}},
    {Maintenance:{Requirements:{Admission:{Graph:'DependencyUnavailable'}}}},
    {Maintenance:{Requirements:{Admission:{Graph:'Invalid'}}}},
    {Role:{Processing:{EvaluationLimitExceeded:{bound:'EvidenceReferences',limit:64,observed:65}}}},
    {Invocation:{Publication:{Graph:{DependencyConflict:{space:'hatter/package/control/installations',expected:{sequence:1,commit:'a'.repeat(64)},actual:{sequence:2,commit:'b'.repeat(64)}}}}}}]) {
    const next={...raw,data:{...raw.data,parameters:{sourceOwner:'sem-lang',ownerFailure:JSON.stringify(detail)}}}
    const projected=projectManagementFailure(next)
    assert.deepEqual(projected?.parameters,next.data.parameters)
    const store=new DiagnosticStore(4,()=>10)
    store.record(raw.message,'warning','owner',projected)
    assert.deepEqual(store.list()[0].parameters,next.data.parameters)
  }
  for(const detail of [{path:'/private/file'},{detail:'private diagnostics'},{Repository:'/private/file'},
    {token:'secret'}, {reason:'Bearer secret'}, {reference:'C:/private/path'},
    {reference:'id/../private'}, {reference:'id//private'}, {value:'x'.repeat(5000)}]) {
    assert.equal(projectManagementFailure({...raw,data:{...raw.data,parameters:{sourceOwner:'sem-lang',ownerFailure:JSON.stringify(detail)}}}),null)
  }
})

test('participant owner refusal reaches diagnostics without names or source bodies', () => {
  const parameters={sourceOwner:'hatter/participant',sourceCode:'ParticipantSourceStale'}
  const input={code:-32000,message:'participant-unavailable',data:{...semantic.data,
    code:'participant-unavailable',reasonId:'hathq://vocabulary/reason/operation-rejected/v1',
    operation:'participant/execute',responsibility:'hatter',parameters}}
  assert.deepEqual(projectManagementFailure(input)?.parameters,parameters)
  const store=new DiagnosticStore(4,()=>10)
  const failure=failureFromError(managementFailureError(input))
  store.record('hatter-console-participant-unavailable','warning','participant',failure)
  assert.deepEqual(store.list()[0].parameters,parameters)
  for(const sourceCode of ['ParticipantUnknown','/home/private','Bearer-secret'])
    assert.equal(projectManagementFailure({...input,data:{...input.data,parameters:{...parameters,sourceCode}}}),null)
})

test('accepts one bounded semantic management failure without raw detail', () => {
  assert.deepEqual(projectManagementFailure(semantic), {
    code: 'hat-worker-unavailable',
    reasonId: 'hathq://vocabulary/reason/hat-worker-unavailable/v1',
    class: 'availability', recovery: 'external-change', responsibility: 'hat',
    operation: 'hat/worker/read', parameters: {}, nextActionId: null
  })
  const error = managementFailureError(semantic)
  assert.equal(error.message, 'hatter-console-hat-worker-unavailable')
  assert.equal(failureFromError(error).responsibility, 'hat')
})

test('represents machine retry without inventing an owner action', () => {
  const failure = { ...semantic.data, code: 'hat-state-conflict',
    reasonId: 'hathq://vocabulary/reason/state-conflict/v1', class: 'conflict',
    recovery: 'retry', responsibility: 'hatter', nextActionId: null }
  const value = projectManagementFailure({ ...semantic,
    message: 'hat-state-conflict', data: failure })
  assert.equal(value.recovery, 'retry')
  assert.equal(value.nextActionId, null)
})

test('rejects unknown fields, mismatched codes, and unbounded parameters', () => {
  assert.equal(projectManagementFailure({ ...semantic,
    data: { ...semantic.data, rawProviderError: 'secret' } }), null)
  assert.equal(projectManagementFailure({ ...semantic, message: 'substituted' }), null)
  assert.equal(projectManagementFailure({ ...semantic,
    data: { ...semantic.data, parameters: { detail: 'private path' } } }), null)
  assert.equal(managementFailureError({ code: -32602,
    message: 'private provider detail' }).message, 'hatter-app-server-request-rejected')
})

test('diagnostics retain semantic recovery but no implementation error text', () => {
  const failure = projectManagementFailure(semantic)
  const store = new DiagnosticStore(4, () => 10)
  store.record('hatter-console-hat-worker-unavailable', 'warning', 'hat', failure)
  assert.deepEqual(store.list()[0], {
    sequence: 1, code: 'hatter-console-hat-worker-unavailable', severity: 'warning',
    area: 'hat', observedAtUnixMs: 10,
    reasonId: 'hathq://vocabulary/reason/hat-worker-unavailable/v1',
    class: 'availability', recovery: 'external-change', responsibility: 'hat',
    operation: 'hat/worker/read', parameters: {}, nextActionId: null
  })
})

test('source owner structured variants survive server projection; malformed/private diagnostics do not', () => {
  const parameters = { sourceOwner: 'sem-lang', sourceRetention: JSON.stringify({
    Repository: { CommitFailure: { Rejected: 'Reclaiming' } }
  }) }
  const source = { ...semantic, data: { ...semantic.data, operation: 'source/execute', parameters } }
  assert.deepEqual(projectManagementFailure(source)?.parameters, parameters)
  assert.deepEqual(failureFromError(managementFailureError(source))?.parameters, parameters)
  for (const parameters of [
    { sourceOwner: 'sem-lang', source: 'SourceRevisionMismatch' },
    { sourceOwner: 'hatter/control', controlSource: 'LeaseUnavailable' },
    { sourceOwner: 'sem-lang', sourceRetention: JSON.stringify('Required') }
    ,{ sourceOwner: 'sem-lang', sourceRetention: JSON.stringify({Restoration:{MissingReference:{kind:'runtime'}}}) }
  ]) assert.deepEqual(projectManagementFailure({ ...source, data: { ...source.data, parameters } })?.parameters, parameters)
  for (const parameters of [
    { sourceOwner: 'unknown/owner' }, { sourceRetention: '{invalid' },
    { sourceRetention: JSON.stringify({ Repository: { Io: '/tmp/private-file' } }) },
    { sourceRetention: JSON.stringify({ restoration: { objects: ['private'] } }) },
    { sourceRetention: JSON.stringify({ Repository: 'x'.repeat(8192) }) }
  ]) assert.equal(projectManagementFailure({ ...source, data: { ...source.data, parameters } }), null)
})
