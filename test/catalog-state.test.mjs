// Hatter M4-E: contract projection, not product execution evidence.
import test from 'node:test'
import assert from 'node:assert/strict'
import { authentication } from './auth-resolution-fixture.mjs'
import { projectModels } from '../server/lib/runtime-projection.mjs'
const state = { source: 'configured', freshness: 'unknown', refresh: 'notAttempted',
  failure: null, refreshedAtMs: null, observedAtMs: null, sourceRevision: null }
const provider = { id: 'fixture', name: 'Fixture', requiresAccount: false }
test('retains empty, unavailable and failed retained data without inventing freshness or leaking error payload', () => {
  const empty = projectModels({ authentication, provider, data: [], catalog: state, nextCursor: null })
  assert.deepEqual(empty.models, [])
  assert.deepEqual(empty.catalog, state)
  assert.throws(() => projectModels({ authentication, provider, data: null, catalog: state, nextCursor: null }),
    /runtime-projection-invalid/)
  const failure = { owner: 'hatter-model-provider', code: 'refreshFailed', sourceCode: 'request_timeout',
    httpStatus: null, line: null, column: null }
  const unavailable = projectModels({ authentication, provider, data: null,
    catalog: { ...state, source: 'missing', refresh: 'failed', failure }, nextCursor: null })
  assert.equal(unavailable.models, null)
  assert.deepEqual(unavailable.catalog.failure, failure)
  const stale = projectModels({ authentication, provider, data: [],
    catalog: { ...state, freshness: 'stale', refresh: 'failed', failure }, nextCursor: null })
  assert.deepEqual(stale.models, [])
  assert.equal(stale.catalog.freshness, 'stale')
  const intakeFailure = { ...failure, owner: 'hatter-transport', code: 'boundExceeded',
    sourceCode: { code: 'response_too_large', limit: 8388608, observedAtLeast: 8388609 }, httpStatus: 500 }
  const intake = sourceCode => projectModels({ authentication, provider, data: [],
    catalog: { ...state, freshness: 'stale', refresh: 'failed',
      failure: { ...intakeFailure, sourceCode } }, nextCursor: null })
  assert.deepEqual(intake(intakeFailure.sourceCode).catalog.failure, intakeFailure)
  for (const sourceCode of [{ ...intakeFailure.sourceCode, body: 'private' },
    { ...intakeFailure.sourceCode, limit: -1 }, { ...intakeFailure.sourceCode, observedAtLeast: 'private' },
    { ...intakeFailure.sourceCode, code: 'unknown' }]) {
    assert.throws(() => intake(sourceCode), /catalog-state-invalid/)
  }
  for (const broken of [{}, { ...state, freshness: 'invented' },
    { ...state, refresh: 'failed' }, { ...state, failure: { ...failure, sourceCode: '/private/token' } }]) {
    assert.throws(() => projectModels({ authentication, provider, data: [], catalog: broken }), /catalog-state-invalid/)
  }
})
