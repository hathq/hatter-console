// Hatter F1: validate and project provider-owned authentication observations only.
const modes = [null, 'apikey', 'chatgpt', 'headers', 'agentIdentity', 'personalAccessToken']
const policy = 'agentIdentityToSessionOnBootstrapUnavailableV1'
const states = ['notResolved', 'resolvedPrimary', 'resolvedFallback', 'failedPrimary', 'failedAll', 'unavailable']
const fallbacks = ['notAttempted', 'notPermitted', 'accepted', 'rejected']
const sources = ['none', 'configured', 'environment', 'managedSnapshot', 'command', 'agentIdentity']
const codes = ['authenticationUnavailable', 'sessionUnavailable', 'sessionExpired', 'credentialRejected',
  'bootstrapUnavailable', 'providerAuthenticationRejected', 'configurationInvalid', 'stateStale', 'busy', 'timeout', 'transportUnavailable', 'responseTooLarge']
export function authResolution(value) {
  if (!value || !modes.includes(value.request?.primary)
    || ![null, policy].includes(value.request?.fallback) || !modes.includes(value.resolvedMode)
    || !states.includes(value.state) || !fallbacks.includes(value.fallback)
    || !sources.includes(value.credentialSource) || !Number.isSafeInteger(value.authGeneration)
    || value.authGeneration < 0) invalid()
  if (value.request.fallback !== null && value.request.primary !== 'agentIdentity') invalid()
  const primaryFailure = cause(value.primaryFailure), fallbackFailure = cause(value.fallbackFailure)
  if (value.state === 'resolvedPrimary' && (primaryFailure || fallbackFailure
    || value.fallback !== 'notAttempted' || value.resolvedMode !== value.request.primary)) invalid()
  if (value.state === 'resolvedFallback' && (!primaryFailure || fallbackFailure
    || value.fallback !== 'accepted' || value.request.fallback !== policy || value.resolvedMode !== 'chatgpt')) invalid()
  if (value.state === 'failedAll' && (!primaryFailure || !fallbackFailure)) invalid()
  if (value.state === 'failedPrimary' && !primaryFailure) invalid()
  if (value.state === 'notResolved' && (primaryFailure || fallbackFailure
    || value.fallback !== 'notAttempted' || value.credentialSource !== 'none')) invalid()
  if (['notResolved', 'failedPrimary', 'failedAll', 'unavailable'].includes(value.state)
    && value.resolvedMode !== null) invalid()
  return { request: { primary: value.request.primary, fallback: value.request.fallback },
    resolvedMode: value.resolvedMode, state: value.state, fallback: value.fallback,
    providerConfigRef: digest(value.providerConfigRef), accountRef: nullableDigest(value.accountRef),
    sessionRef: nullableDigest(value.sessionRef), authGeneration: value.authGeneration,
    credentialSource: value.credentialSource, primaryFailure, fallbackFailure }
}
function cause(value) {
  if (value === null) return null
  if (!value || !['hatter-login', 'hatter-model-provider', 'hatter-transport'].includes(value.owner)
    || !codes.includes(value.code) || (value.attempts !== null
      && (!Number.isSafeInteger(value.attempts) || value.attempts < 0 || value.attempts > 3))) invalid()
  return { owner: value.owner, code: value.code, attempts: value.attempts }
}
function digest(value) { if (!/^[a-f0-9]{64}$/u.test(value)) invalid(); return value }
function nullableDigest(value) { return value === null ? null : digest(value) }
function invalid() { throw new Error('hatter-console-auth-resolution-invalid') }
