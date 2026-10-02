// Hatter downstream 2026: compound mutation matrix, no compatibility fixtures.
import assert from 'node:assert/strict'
import test from 'node:test'
import { expectedProtocol } from '../scripts/sync-management-protocol.mjs'
import { projectSchema, verifyProjection, methodSet, stable } from '../bin/hatter-protocol-verify.mjs'
import { CLIENT_RPC_METHODS } from '../server/lib/rpc-policy.mjs'
test('exact subset projection rejects missing/extra/duplicate methods, stale schemas, unknown policy and TS drift', () => {
  const { canonical, projected, ts } = expectedProtocol()
  const verify = p => verifyProjection(canonical, p, ts, CLIENT_RPC_METHODS)
  const missing = structuredClone(projected); missing.oneOf.pop()
  assert.throws(() => verify(missing), e => e.code === 'SchemaProjectionIncomplete')
  const extra = structuredClone(projected), branch = structuredClone(extra.oneOf[0])
  branch.properties.method.enum = ['fixture/extra']; extra.oneOf.push(branch)
  assert.throws(() => verify(extra), e => e.code === 'SchemaProjectionExtra')
  const duplicate = structuredClone(projected); duplicate.oneOf.push(duplicate.oneOf[0])
  assert.throws(() => verify(duplicate), e => e.code === 'DuplicateMethod')
  const stale = structuredClone(projected); stale.oneOf[0].required = []
  assert.throws(() => verify(stale), e => e.code === 'StaleSnapshot')
  assert.throws(() => projectSchema(canonical, [...CLIENT_RPC_METHODS, 'fixture/unsupported']), e => e.code === 'UnknownConsoleMethod')
  assert.throws(() => verifyProjection(canonical, projected, ts + '// edited', CLIENT_RPC_METHODS), e => e.code === 'JsonTypeScriptMismatch')
  assert.throws(() => methodSet({ oneOf: [{}] }), e => e.code === 'UnsupportedRepresentation')
  const shuffled = structuredClone(canonical); shuffled.oneOf.reverse()
  assert.equal(stable(projectSchema(shuffled, [...CLIENT_RPC_METHODS].reverse())), stable(projected))
})
