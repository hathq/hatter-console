// Hatter M4-E 2026: validate owner data; never derive freshness from model count.
import { authResolution } from './auth-resolution.mjs'
export function catalogState(value) {
  if (!value || !['missing', 'configured', 'bundled', 'remote'].includes(value.source)
    || !['fresh', 'stale', 'unknown'].includes(value.freshness)
    || !['notAttempted', 'succeeded', 'failed'].includes(value.refresh)) invalid()
  const failure = value.failure
  if (failure !== null && (!failure
    || !['hatter-models-manager', 'hatter-model-provider', 'hatter-transport'].includes(failure.owner)
    || !['cacheMissing', 'sourceUnavailable', 'parseFailed', 'configurationInvalid',
      'refreshFailed', 'sourceChanged', 'boundExceeded'].includes(failure.code)
    || !safeSourceCode(failure.sourceCode))) invalid()
  if (value.refresh === 'failed' && failure === null) invalid()
  if (value.freshness === 'fresh' && failure !== null) invalid()
  if (value.sourceRevision !== null
    && !/^[a-f0-9]{64}$/u.test(value.sourceRevision)) invalid()
  return { source: value.source, freshness: value.freshness, refresh: value.refresh,
    failure: failure === null ? null : { owner: failure.owner, code: failure.code,
      sourceCode: failure.sourceCode, httpStatus: nullableCount(failure.httpStatus),
      line: nullableCount(failure.line), column: nullableCount(failure.column),
      ...(failure.authentication === undefined ? {} : { authentication: authResolution(failure.authentication) }) },
    refreshedAtMs: nullableCount(value.refreshedAtMs), observedAtMs: nullableCount(value.observedAtMs),
    sourceRevision: value.sourceRevision }
}
// Hatter HTTP intake: project the owner's closed numeric error details, not its policy.
function safeSourceCode(value) {
  if (value === null) return true
  if (typeof value === 'string') return /^[A-Za-z][A-Za-z0-9_]{0,100}$/u.test(value)
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3 && value.code === 'response_too_large'
    && Number.isSafeInteger(value.limit) && value.limit >= 0
    && Number.isSafeInteger(value.observedAtLeast) && value.observedAtLeast >= 0
}
export function nullableCount(value) {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) invalid()
  return value
}
function invalid() { throw new Error('hatter-console-catalog-state-invalid') }
