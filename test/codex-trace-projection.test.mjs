import assert from 'node:assert/strict'
import test from 'node:test'
import { projectCodexTrace } from '../server/lib/codex-trace-projection.mjs'

function measuredUsage(overrides = {}) {
  return { measuredInferenceCount: 1, inputTokens: 100, cachedInputTokens: 40,
    cacheWriteInputTokens: 8, outputTokens: 20, reasoningOutputTokens: 5,
    totalTokens: 120, ...overrides }
}

function projection() {
  return { schema: 'hathq://hatter/hatter-rollout-trace-projection/v1', recording: true,
    source: 'owner-local-rollout-trace', containsRawContent: false, rejectedBundleCount: 0,
    traces: [{ traceId: 'trace-1', rolloutId: 'rollout-1', status: 'completed',
      startedAtUnixMs: 1000, endedAtUnixMs: 1200, threadCount: 1, turnCount: 1,
      inferenceCount: 1, toolCallCount: 1, compactionCount: 1, usage: measuredUsage(),
      toolKinds: { apply_patch: 1 }, inferences: [{ inferenceCallId: 'inference-1',
        threadId: 'thread-1', codexTurnId: 'turn-1', model: 'gpt-5.6-sol',
        providerName: 'openai', status: 'completed', startedAtUnixMs: 1000,
        endedAtUnixMs: 1200, durationMs: 200, requestItemCount: 4,
        responseItemCount: 2, usage: measuredUsage() }], compactions: [{
        compactionId: 'compaction-1', codexTurnId: 'turn-1', installedAtUnixMs: 1150,
        inputItemCount: 20, replacementItemCount: 4, requestCount: 1 }] }] }
}

test('projects exact measured token, cache, tool and compaction facts', () => {
  const value = projectCodexTrace(projection())
  assert.equal(value.containsRawContent, false)
  assert.equal(value.traces[0].usage.cachedInputTokens, 40)
  assert.equal(value.traces[0].toolKinds.apply_patch, 1)
  assert.equal(value.traces[0].compactions[0].replacementItemCount, 4)
})

test('rejects inconsistent token totals and strips browser-unsafe raw additions', () => {
  const inconsistent = projection()
  inconsistent.traces[0].usage.totalTokens = 119
  assert.throws(() => projectCodexTrace(inconsistent),
    /hatter-console-codex-trace-projection-invalid/u)
  const raw = projection()
  raw.prompt = 'secret'
  assert.equal('prompt' in projectCodexTrace(raw), false)
})
