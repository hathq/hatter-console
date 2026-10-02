// Added by the Hatter downstream project, 2026.
// Purpose: prove Hatter inference readiness is visible with zero installed HATs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectInferenceEngineStatus } from '../server/lib/inference-engine-status-projection.mjs'

function status(overrides = {}) {
  return { schema: 'hathq://hatter/inference-engine-status/v1', observedAtUnixMs: 10,
    configurationState: 'ready', activityState: 'idle',
    provider: { id: 'openai', name: 'OpenAI', requiresAccount: true },
    execution: { kind: 'external-provider', activation: 'on-demand', hatRequired: false,
      reachability: 'not-tested' },
    authentication: { state: 'authenticated', mode: 'chatgpt' },
    modelCatalog: { catalog: { source: 'configured', freshness: 'unknown', refresh: 'notAttempted', failure: null, refreshedAtMs: null, observedAtMs: null, sourceRevision: null }, count: 3, defaultModel: 'gpt-test', defaultReasoning: 'low',
      defaultServiceTier: null },
    observability: { recording: true, traceCount: 0, activeInferenceCount: 0,
      measuredInferenceCount: 0, lastActivityAtUnixMs: null, containsRawContent: false },
    containsSecretValues: false, ...overrides }
}

test('projects a ready idle engine without any HAT field or dependency', () => {
  const value = projectInferenceEngineStatus(status())
  assert.equal(value.configurationState, 'ready')
  assert.equal(value.execution.hatRequired, false)
  assert.equal(value.observability.activeInferenceCount, 0)
  assert.equal(JSON.stringify(value).includes('repository'), false)
})

test('projects a credentialless configured provider without inventing authentication', () => {
  const value = projectInferenceEngineStatus(status({
    provider: { id: 'owner-runtime', name: 'Owner runtime', requiresAccount: false },
    authentication: { state: 'not-required', mode: null }
  }))
  assert.equal(value.provider.id, 'owner-runtime')
  assert.equal(value.authentication.state, 'not-required')
})

test('rejects invented reachability and inconsistent activity', () => {
  assert.throws(() => projectInferenceEngineStatus(status({ execution: {
    ...status().execution, reachability: 'connected' } })), /inference-engine-status-invalid/u)
  assert.throws(() => projectInferenceEngineStatus(status({ activityState: 'running' })),
    /inference-engine-status-invalid/u)
})
