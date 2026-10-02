// M4-A: Console forwarding and typed failures, not an admission implementation.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HatterRuntime } from '../server/runtime/hatter-runtime.mjs'
import { managementFailureError, failureFromError } from '../server/lib/management-failure.mjs'

test('owner commands and exact responses remain unchanged; typed absence is not an empty registry', async () => {
  const calls = [], response = { outcome: 'snapshot', revision: { sequence: 0, commit: null }, artifacts: [], runtimes: [] }
  const host = { rpc: async (method, params) => { calls.push({ method, params }); return response } }
  assert.deepEqual(await HatterRuntime.prototype.localRuntimeRegistry.call(host, { operation: 'inspect' }), response)
  assert.deepEqual(calls, [{ method: 'model/runtime/execute', params: { operation: 'inspect' } }])
  for (const code of ['registry-missing', 'artifact-unavailable', 'artifact-corrupt', 'digest-mismatch',
    'unsupported-runtime', 'invalid-configuration', 'admission-conflict', 'capacity-exceeded', 'timeout']) {
    const error = managementFailureError({ code: -32000, message: 'model-operation-rejected', data: {
      schema: 'hathq://hatter/management-failure/v1', code: 'model-operation-rejected',
      reasonId: 'hathq://vocabulary/reason/model-operation-rejected/v1', class: 'dependency',
      recovery: 'external-change', responsibility: 'external-service', operation: 'model/runtime/execute',
      parameters: { sourceOwner: 'zixcel-local-inference', modelAdmission: code }, nextActionId: null
    } })
    assert.equal(failureFromError(error).parameters.modelAdmission, code)
    host.rpc = async () => { throw error }
    await assert.rejects(HatterRuntime.prototype.localRuntimeRegistry.call(host, { operation: 'inspect' }), value => value === error)
  }
})
