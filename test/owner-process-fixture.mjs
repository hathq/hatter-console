import { stopProcess } from '@crowsi/transport-foundation/process'
/** Hatter-specific error presentation; process ownership/reaping belongs to Crowsi. */
export async function stopProcessGroup(child, timeoutMs = 2_000, group = true) {
  // JSONL EOF is the management owner's normal drain/close contract. Signals
  // remain bounded escalation, not the normal way to close Graph writers.
  if (!group && child?.stdin && !child.stdin.destroyed) child.stdin.end()
  try { await stopProcess(child, { timeoutMs, group, graceMs:group ? 0 : timeoutMs }) }
  catch (cause) {
    throw new Error('hatter-app-server-process-not-reaped', { cause })
  }
}
