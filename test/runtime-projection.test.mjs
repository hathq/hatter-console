// Hatter 2026: real zero counts and typed unavailable owners must stay distinct.
import assert from 'node:assert/strict'
import test from 'node:test'
import { projectRuntimeStatus } from '../server/lib/runtime-projection.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('projects a valid zero-HAT, inference-free runtime status', () => {
  const raw = { schemaId: 'hathq://hatter/runtime-status/v1', observedAtUnixMs: 1,
    version: '0.10.0', platformFamily: 'unix', platformOs: 'linux',
    semanticContract: { status: 'semantic-foundation-integrated-runtime-assembly-pending',
      digest: `sha256:${'1'.repeat(64)}` }, installedHatCount: 0,
    owners: ['hatter/control', 'hatter/admission', 'sem-lang'].map(owner => ({owner, failure:null,
      observation:{owner_type:owner==='sem-lang'?'Semantic':'Graph',
        process:{owner_ref:owner,incarnation:Array(32).fill(1),protocol_generation:Array(32).fill(2),executable_identity:Array(32).fill(3)},
        availability:{process_alive:true,transport_available:true,owner_ready:'Ready',domain_dispatch_available:true}}})),
    hatBinding: { status: 'available', reason: null, failure: null, contextPartitionId: null,
      activeActionCount: 0 }, account: { authMode: null },
    modelCatalog: { catalog: { source: 'configured', freshness: 'unknown', refresh: 'notAttempted', failure: null, refreshedAtMs: null, observedAtMs: null, sourceRevision: null }, count: 0, defaultModel: null, defaultReasoning: null,
      defaultServiceTier: null },
    rateLimits: { status: 'unavailable', reason: 'rate-limit-unavailable' },
    containsSecretValues: false }
  const value = projectRuntimeStatus(raw)
  assert.equal(value.schema, 'hathq://hatter-console/overview/v1')
  assert.equal(value.installedHatCount, 0)
  assert.equal(value.hatBinding.state, 'available')
  assert.equal(value.modelCatalog.count, 0)
  assert.equal('builtInHats' in value, false)
  assert.throws(() => projectRuntimeStatus({ ...raw, containsSecretValues: true }),
    /projection-invalid/u)
  const failure = { schema:'hathq://hatter/management-failure/v1',
    code:'inference-state-unavailable', reasonId:'hathq://vocabulary/reason/dependency-unavailable/v1',
    class:'availability', recovery:'external-change', responsibility:'hatter',
    operation:'hatter/status/read', nextActionId:null,
    parameters:{sourceOwner:'hatter/admission',control:JSON.stringify({Graph:{Storage:'[redacted]'}})} }
  const damaged = { ...raw, installedHatCount:null,
    hatBinding:{status:'unavailable',reason:failure.reasonId,failure,activeActionCount:null},
    owners:[raw.owners[0],{owner:'hatter/admission',observation:null,failure},raw.owners[2]] }
  const projected = projectRuntimeStatus(damaged)
  assert.equal(projected.installedHatCount,null)
  assert.equal(projected.hatBinding.activeActionCount,null)
  assert.deepEqual(projected.hatBinding.failure.parameters,failure.parameters)
  assert.deepEqual(projected.owners[1].failure.parameters,failure.parameters)
  assert.deepEqual(projected.owners[0].observation,raw.owners[0].observation)
  for (const owner_ready of ['Starting','Recovering',{Unavailable:'RecoveryRequired'},{Unavailable:'Corrupt'}]) {
    const entry = structuredClone(raw.owners[0])
    entry.observation.availability.owner_ready = owner_ready
    entry.observation.availability.domain_dispatch_available = false
    assert.deepEqual(projectRuntimeStatus({...raw,owners:[entry]}).owners[0].observation,entry.observation)
    entry.observation.availability.domain_dispatch_available = true
    assert.throws(()=>projectRuntimeStatus({...raw,owners:[entry]}),/projection-invalid/u)
  }
  assert.throws(()=>projectRuntimeStatus({...damaged,owners:[]}),/projection-invalid/u)
  assert.throws(()=>projectRuntimeStatus({...damaged,owners:[raw.owners[0],raw.owners[0]]}),/projection-invalid/u)
  assert.throws(()=>projectRuntimeStatus({...damaged,hatBinding:{...damaged.hatBinding,activeActionCount:0}}),/projection-invalid/u)
  if (process.env.HATTER_STARTUP_EVIDENCE) {
    for (const name of ['control','admission']) {
      const actual=JSON.parse(readFileSync(join(process.env.HATTER_STARTUP_EVIDENCE,`${name}.json`)))
      const overview=projectRuntimeStatus(actual)
      const state=overview.owners.find(s=>s.owner===`hatter/${name}`)
      assert.deepEqual(state,actual.owners.find(s=>s.owner===state.owner))
      assert.ok(state.failure || state.observation?.availability.domain_dispatch_available===false)
      assert.equal(overview.installedHatCount,name==='admission'?null:0)
      assert.equal(overview.hatBinding.activeActionCount,name==='admission'?null:0)
    }
  }
})
