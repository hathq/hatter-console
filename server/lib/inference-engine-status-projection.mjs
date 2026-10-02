// Added by the Hatter downstream project, 2026.
// Purpose: validate the HAT-independent inference-engine status projected by Hatter.
import { assertSafeProjection } from './projection.mjs'
import { catalogState, nullableCount } from './catalog-state.mjs'

export function projectInferenceEngineStatus(value) {
  if (value?.schema !== 'hathq://hatter/inference-engine-status/v1'
    || value?.containsSecretValues !== false
    || !['authentication-required', 'model-unavailable', 'catalog-unavailable', 'ready'].includes(
      value.configurationState)
    || !['idle', 'running'].includes(value.activityState)
    || value.execution?.kind !== 'external-provider'
    || value.execution?.activation !== 'on-demand'
    || value.execution?.hatRequired !== false
    || value.execution?.reachability !== 'not-tested'
    || !['required', 'authenticated', 'not-required'].includes(value.authentication?.state)
    || value.observability?.containsRawContent !== false) invalid()
  const authenticationMode = nullableText(value.authentication.mode, 40)
  const requiresAccount = boolean(value.provider?.requiresAccount)
  if ((value.authentication.state === 'authenticated') !== (authenticationMode != null)
    || (requiresAccount && value.authentication.state === 'not-required')
    || (!requiresAccount && value.authentication.state !== 'not-required')) invalid()
  const activeInferenceCount = integer(value.observability.activeInferenceCount)
  if ((value.activityState === 'running') !== (activeInferenceCount > 0)) invalid()
  return assertSafeProjection({ schema: 'hathq://hatter-console/inference-engine-status/v1',
    observedAtUnixMs: integer(value.observedAtUnixMs),
    configurationState: value.configurationState, activityState: value.activityState,
    provider: { id: token(value.provider?.id), name: text(value.provider?.name, 120),
      requiresAccount },
    execution: { kind: 'external-provider', activation: 'on-demand', hatRequired: false,
      reachability: 'not-tested' },
    authentication: { state: value.authentication.state, mode: authenticationMode },
    modelCatalog: { count: nullableCount(value.modelCatalog?.count),
      catalog: catalogState(value.modelCatalog?.catalog),
      defaultModel: nullableText(value.modelCatalog?.defaultModel, 120),
      defaultReasoning: nullableText(value.modelCatalog?.defaultReasoning, 40),
      defaultServiceTier: nullableText(value.modelCatalog?.defaultServiceTier, 80) },
    observability: { recording: value.observability.recording === true,
      traceCount: integer(value.observability.traceCount), activeInferenceCount,
      measuredInferenceCount: integer(value.observability.measuredInferenceCount),
      lastActivityAtUnixMs: nullableInteger(value.observability.lastActivityAtUnixMs),
      containsRawContent: false }, containsSecretValues: false })
}

function nullableText(value, max) {
  if (value == null) return null
  if (typeof value !== 'string' || !value || value.length > max) invalid()
  return value
}
function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid()
  return value
}
function nullableInteger(value) { return value == null ? null : integer(value) }
function text(value, max) {
  if (typeof value !== 'string' || !value || value.length > max) invalid()
  return value
}
function token(value) {
  const result = text(value, 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(result)) invalid()
  return result
}
function boolean(value) { if (typeof value !== 'boolean') invalid(); return value }
function invalid() { throw new Error('hatter-console-inference-engine-status-invalid') }
