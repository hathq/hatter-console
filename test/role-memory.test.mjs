import assert from 'node:assert/strict'
import test from 'node:test'
import { roleMemory } from '../shared/role-memory.mjs'
import { HatterRuntime } from '../server/runtime/hatter-runtime.mjs'

test('role memory preserves exact short and long-term data and distinguishes missing, empty and corrupt responses', async () => {
  const record = { reference: 'b'.repeat(64), input_ref: 'input:1', input_digest: 'c'.repeat(64),
    surface: 'tomorrow', retention: 'KeepAsEvidence',
    context: { subject: { id: 'person:owner', class: 'person' }, evidence: [], at: null,
      locale: 'en', semantic_revision: 'd'.repeat(64), context_refs: [],
      context_scope: 'CurrentRequest', observation_evidence: [] } }
  const roleRef = { schema: 'hathq://semantic/reference/v1', id: 'runtime-role:observer', revision: 2, digest_sha256: 'a'.repeat(64) }
  const metadata = { roleRef, subjectRef: record.context.subject, semanticRevision: 'b'.repeat(64), memoryRevision: 'd'.repeat(64) }
  const retained = { id: 'default:1', subject: record.context.subject, kind: 'TimeZone', value: 'Asia/Tokyo',
    scope: 'PersistentAgentDefault', validity: { valid_from: null, valid_until: null, superseded_by: null },
    evidence: [{ reference: 'evidence:1', detail: 'accepted by owner' }], revision: 'context:1', promotion_ref: 'promotion:1' }
  const value = { ...metadata, shortTerm: [record], longTerm: [retained] }
  assert.equal(roleMemory(value), value)
  for (const valid of [{ ...metadata, shortTerm: [], longTerm: [] },
    { ...metadata, shortTerm: [{ ...record, surface: null, retention: 'DiscardAfterCompile' }], longTerm: [] }])
    assert.equal(roleMemory(valid), valid)
  for (const invalid of [null, {}, { items: [] }, { shortTerm: [], history: [] },
    { ...metadata, shortTerm: null },
    { ...metadata, roleRef: { ...roleRef, schema: 'wrong' }, shortTerm: [] },
    { ...metadata, candidates: [], shortTerm: [] },
    { ...metadata, shortTerm: [{ ...record, retention: 'two-years' }] },
    { ...metadata, shortTerm: [{ ...record, surface: null }] },
    { ...metadata, shortTerm: [{ ...record, retention: 'DiscardAfterCompile' }] },
    { ...metadata, shortTerm: [{ ...record, context: { ...record.context, subject: null } }] },
    { ...metadata, shortTerm: [{ ...record, completedAt: 123 }] }])
    assert.throws(() => roleMemory(invalid), /role-memory-invalid/)
  const runtime = new HatterRuntime()
  runtime.rpc = async (method, ...args) => {
    assert.equal(method, 'inference/role/memory'); assert.deepEqual(args, [{ roleRef }])
    return value
  }
  assert.deepEqual(await runtime.roleMemory(roleRef), value)
  runtime.rpc = async () => { throw Error('unavailable') }
  await assert.rejects(runtime.roleMemory(roleRef), /unavailable/)
})
