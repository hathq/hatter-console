// Added by the Hatter downstream project, 2026.
// Purpose: validate the privacy-bounded Codex trace projection before browser delivery.
import { assertSafeProjection } from './projection.mjs'

const STATUS = new Set(['running', 'completed', 'failed', 'cancelled', 'aborted'])

export function projectCodexTrace(raw) {
  // This identifier is the Hatter Core management contract. Keep the Console
  // strict so a stale or differently shaped trace cannot be rendered as if it
  // were current telemetry.
  if (raw?.schema !== 'hathq://hatter/hatter-rollout-trace-projection/v1'
    || raw.source !== 'owner-local-rollout-trace' || raw.containsRawContent !== false
    || typeof raw.recording !== 'boolean') invalid()
  return assertSafeProjection({ schema: 'hathq://hatter-console/codex-trace/v1',
    recording: raw.recording, source: raw.source, containsRawContent: false,
    rejectedBundleCount: integer(raw.rejectedBundleCount, 32),
    traces: array(raw.traces, 32, trace) })
}

function trace(value) {
  return { traceId: token(value?.traceId, 160), rolloutId: token(value?.rolloutId, 160),
    status: status(value?.status), startedAtUnixMs: timestamp(value?.startedAtUnixMs),
    endedAtUnixMs: nullableTimestamp(value?.endedAtUnixMs),
    threadCount: integer(value?.threadCount, 256), turnCount: integer(value?.turnCount, 100_000),
    inferenceCount: integer(value?.inferenceCount, 100_000),
    toolCallCount: integer(value?.toolCallCount, 100_000),
    compactionCount: integer(value?.compactionCount, 100_000), usage: usage(value?.usage),
    toolKinds: toolKinds(value?.toolKinds), inferences: array(value?.inferences, 256, inference),
    compactions: array(value?.compactions, 10_000, compaction) }
}

function usage(value) {
  const projected = { measuredInferenceCount: integer(value?.measuredInferenceCount, 100_000),
    inputTokens: count(value?.inputTokens), cachedInputTokens: count(value?.cachedInputTokens),
    cacheWriteInputTokens: count(value?.cacheWriteInputTokens),
    outputTokens: count(value?.outputTokens),
    reasoningOutputTokens: count(value?.reasoningOutputTokens), totalTokens: count(value?.totalTokens) }
  if (projected.cachedInputTokens > projected.inputTokens
    || projected.reasoningOutputTokens > projected.outputTokens
    || projected.totalTokens !== projected.inputTokens + projected.outputTokens) invalid()
  return projected
}

function inference(value) {
  const startedAtUnixMs = timestamp(value?.startedAtUnixMs)
  const endedAtUnixMs = nullableTimestamp(value?.endedAtUnixMs)
  const durationMs = value?.durationMs == null ? null : integer(value.durationMs, Number.MAX_SAFE_INTEGER)
  if ((endedAtUnixMs == null) !== (durationMs == null)
    || (endedAtUnixMs != null && endedAtUnixMs - startedAtUnixMs !== durationMs)) invalid()
  return { inferenceCallId: token(value?.inferenceCallId, 160),
    threadId: token(value?.threadId, 160), codexTurnId: token(value?.codexTurnId, 160),
    model: text(value?.model, 160), providerName: text(value?.providerName, 160),
    status: status(value?.status), startedAtUnixMs, endedAtUnixMs, durationMs,
    requestItemCount: integer(value?.requestItemCount, 1_000_000),
    responseItemCount: integer(value?.responseItemCount, 1_000_000),
    usage: value?.usage == null ? null : usage(value.usage) }
}

function compaction(value) {
  return { compactionId: token(value?.compactionId, 160),
    codexTurnId: token(value?.codexTurnId, 160),
    installedAtUnixMs: timestamp(value?.installedAtUnixMs),
    inputItemCount: integer(value?.inputItemCount, 1_000_000),
    replacementItemCount: integer(value?.replacementItemCount, 1_000_000),
    requestCount: integer(value?.requestCount, 10_000) }
}

function toolKinds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length > 64) invalid()
  return Object.fromEntries(Object.entries(value).map(([key, count]) =>
    [token(key, 80), integer(count, 1_000_000)]))
}
function status(value) { if (!STATUS.has(value)) invalid(); return value }
function token(value, max) { const result = text(value, max); if (!/^[A-Za-z0-9._:/-]+$/u.test(result)) invalid(); return result }
function text(value, max) { if (typeof value !== 'string' || !value || value.length > max) invalid(); return value }
function timestamp(value) { return integer(value, 9_999_999_999_999) }
function nullableTimestamp(value) { return value == null ? null : timestamp(value) }
function count(value) { return integer(value, Number.MAX_SAFE_INTEGER) }
function integer(value, max) { if (!Number.isSafeInteger(value) || value < 0 || value > max) invalid(); return value }
function array(value, max, project) { if (!Array.isArray(value) || value.length > max) invalid(); return value.map(project) }
function invalid() { throw new Error('hatter-console-codex-trace-projection-invalid') }
