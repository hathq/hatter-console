// Hatter M4-E 2026: retain catalog availability and owner provenance.
import { assertSafeProjection } from './projection.mjs'
import { catalogState, nullableCount } from './catalog-state.mjs'
import { authResolution } from './auth-resolution.mjs'
import { projectManagementFailure } from './management-failure.mjs'

export function projectRuntimeStatus(raw) {
  if (raw?.schemaId !== 'hathq://hatter/runtime-status/v1'
    || raw.containsSecretValues !== false) invalid()
  return safe({ schema: 'hathq://hatter-console/overview/v1',
    observedAtUnixMs: integer(raw.observedAtUnixMs),
    runtime: { version: text(raw.version, 80),
      platformFamily: text(raw.platformFamily, 40), platformOs: text(raw.platformOs, 40),
      semanticState: text(raw.semanticContract?.status, 80),
      semanticDigest: digest(raw.semanticContract?.digest) },
    account: { authMode: nullableText(raw.account?.authMode, 40),
      persistence: 'process-ephemeral' },
    installedHatCount: nullableCount(raw.installedHatCount),
    owners: owners(raw.owners),
    modelCatalog: { count: nullableCount(raw.modelCatalog?.count),
      catalog: catalogState(raw.modelCatalog?.catalog),
      defaultModel: nullableText(raw.modelCatalog?.defaultModel, 120),
      defaultReasoning: nullableText(raw.modelCatalog?.defaultReasoning, 40),
      defaultServiceTier: nullableText(raw.modelCatalog?.defaultServiceTier, 80) },
    hatBinding: hatBinding(raw.hatBinding), rateLimits: unavailable(raw.rateLimits) })
}

export function projectModels(raw) {
  if (raw?.data !== null && (!Array.isArray(raw?.data) || raw.data.length > 256)) invalid()
  const catalog = catalogState(raw.catalog)
  if (raw.data === null && catalog.failure === null) invalid()
  const provider = { id: token(raw?.provider?.id), name: text(raw?.provider?.name, 120),
    requiresAccount: boolean(raw?.provider?.requiresAccount) }
  const models = raw.data === null ? null : raw.data.map(value => ({ id: text(value?.id, 120),
    displayName: text(value?.displayName, 160), default: value?.isDefault === true,
    reasoning: array(value?.supportedReasoningEfforts, item =>
      text(item?.reasoningEffort, 40), 16),
    serviceTiers: array(value?.serviceTiers, item => ({ id: text(item?.id, 80),
      name: text(item?.name, 120) }), 16),
    defaultReasoning: nullableText(value?.defaultReasoningEffort, 40),
    defaultServiceTier: nullableText(value?.defaultServiceTier, 80) }))
  return safe({ schema: 'hathq://hatter-console/models/v1', provider, models, catalog,
    authentication: authResolution(raw.authentication),
    nextCursor: nullableText(raw.nextCursor, 512) })
}

export function projectModelProviders(raw) {
  const providers = array(raw?.providers, value => ({ id: token(value?.id),
    name: text(value?.name, 120), requiresAccount: boolean(value?.requiresAccount),
    active: boolean(value?.active) }), 32)
  if (new Set(providers.map(value => value.id)).size !== providers.length
    || providers.filter(value => value.active).length !== 1) invalid()
  return safe({ schema: 'hathq://hatter-console/model-providers/v1', providers })
}

export function projectUsage(rateResult, usageResult) {
  const rate = rateResult?.state === 'available'
    ? { state: 'available', primary: window(rateResult.value?.rateLimits?.primary),
      secondary: window(rateResult.value?.rateLimits?.secondary) }
    : { state: 'unavailable', primary: null, secondary: null }
  const summary = usageResult?.state === 'available'
    ? { state: 'available', lifetimeTokens: count(usageResult.value?.summary?.lifetimeTokens),
      peakDailyTokens: count(usageResult.value?.summary?.peakDailyTokens),
      currentStreakDays: count(usageResult.value?.summary?.currentStreakDays) }
    : { state: 'unavailable', lifetimeTokens: null,
      peakDailyTokens: null, currentStreakDays: null }
  return safe({ schema: 'hathq://hatter-console/usage/v1', rateLimits: rate, usage: summary })
}

export function projectLogin(raw, handles) {
  if (raw?.type === 'chatgpt') return safe({ flow: 'browser',
    handle: handles.issue('login', text(raw.loginId, 512)),
    authorizationUrl: httpsUrl(raw.authUrl), persistence: 'process-ephemeral' })
  if (raw?.type === 'chatgptDeviceCode') return safe({ flow: 'device',
    handle: handles.issue('login', text(raw.loginId, 512)),
    verificationUrl: httpsUrl(raw.verificationUrl), userCode: code(raw.userCode),
    persistence: 'process-ephemeral' })
  invalid()
}

function unavailable(value) {
  return value?.status === 'unavailable'
    ? { state: 'unavailable', reason: text(value.reason, 160) }
    : { state: 'unknown', reason: null }
}
function hatBinding(value) {
  const state = text(value?.status, 32)
  if (!['unavailable', 'waiting', 'available'].includes(state)) invalid()
  const failure = ownerFailure(value.failure)
  const activeActionCount = nullableCount(value.activeActionCount)
  if ((state === 'available' && (failure !== null || activeActionCount === null))
    || (state === 'unavailable' && (failure === null || activeActionCount !== null))) invalid()
  return { state, reason: nullableText(value?.reason, 160), failure,
    contextPartitionId: nullableText(value?.contextPartitionId, 128),
    activeActionCount }
}
function ownerFailure(value) {
  if (value === null) return null
  const failure = projectManagementFailure({ code: -32000, message: value?.code, data: value })
  if (failure === null) invalid()
  return failure
}
function owners(value) {
  const observations = array(value, entry => {
    const owner = text(entry?.owner, 512)
    const failure = ownerFailure(entry.failure)
    const observation = entry.observation
    if (observation === null) {
      if (failure === null || failure.parameters.sourceOwner !== owner) invalid()
    } else {
      if (failure !== null || !observation || JSON.stringify(observation).length > 4096) invalid()
      const status = observation.availability
      boolean(status?.process_alive); boolean(status?.transport_available)
      boolean(status?.domain_dispatch_available)
      // Retain the original bounded handshake. Presentation does not recreate
      // process identity/readiness or turn Empty/uncertain Work into readiness.
      if ((status.transport_available && !status.process_alive)
        || (status.domain_dispatch_available && (!status.process_alive
          || !status.transport_available || status.owner_ready !== 'Ready'))) invalid()
      text(observation.owner_type, 80)
      text(observation.process?.owner_ref, 512)
      for (const field of ['incarnation', 'protocol_generation', 'executable_identity']) {
        const bytes = observation.process[field]
        if (!Array.isArray(bytes) || bytes.length !== 32
          || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)
          || bytes.every(b => b === 0)) invalid()
      }
    }
    return { owner, observation, failure }
  }, 8)
  if (observations.length === 0 || new Set(observations.map(o => o.owner)).size !== observations.length) invalid()
  return observations
}
function window(value) {
  return value ? { usedPercent: finite(value.usedPercent),
    durationMinutes: nullableInteger(value.windowDurationMins),
    resetsAtUnixSeconds: nullableInteger(value.resetsAt) } : null
}
function array(value, map, max) {
  if (!Array.isArray(value) || value.length > max) invalid()
  return value.map(map)
}
function boolean(value) { if (typeof value !== 'boolean') invalid(); return value }
function token(value) {
  const result = text(value, 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(result)) invalid()
  return result
}
function httpsUrl(value) {
  const url = new URL(text(value, 4096))
  if (url.protocol !== 'https:' || url.username || url.password) invalid()
  return url.toString()
}
function code(value) {
  const result = text(value, 32)
  if (!/^[A-Z0-9-]+$/iu.test(result)) invalid()
  return result
}
function digest(value) {
  const result = text(value, 80)
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) invalid()
  return result
}
function text(value, max) {
  if (typeof value !== 'string' || !value || value.length > max) invalid()
  return value
}
function nullableText(value, max) { return value == null ? null : text(value, max) }
function integer(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) invalid()
  return result
}
function nullableInteger(value) { return value == null ? null : integer(value) }
function finite(value) {
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0 || result > 100) invalid()
  return result
}
function count(value) { return value == null ? null : integer(value) }
function safe(value) { return assertSafeProjection(value) }
function invalid() { throw new Error('hatter-console-runtime-projection-invalid') }
