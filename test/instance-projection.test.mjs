import assert from 'node:assert/strict'
import test from 'node:test'
import { projectInstance } from '../server/lib/instance-projection.mjs'

const active = { instance: {
  schema: 'hathq://hatter/instance-projection/v2', stateRevision: 1,
  initialized: true, instanceId: 'instance-a', role: 'standalone',
  identityState: 'unpaired', personIdentityRef: null, authorityEpoch: null,
  primaryInstanceId: null, workspaceRootId: 'workspace-root-a',
  workspaceRootFingerprintSha256: 'ab'.repeat(32), workspaceRootState: 'active',
  continuity: { state: 'retained', action: 'none', reason: 'working-root-retained' },
  platformFamily: 'unix', platformOs: 'linux',
  identityContractOwner: 'ihat-identity-contracts', transportContractOwner: 'crowsi'
} }

test('projects path-free standalone instance state without workspace taxonomy', () => {
  const value = projectInstance(active)
  assert.equal(value.workingRootId, 'workspace-root-a')
  assert.equal(value.workingRootState, 'active')
  assert.equal('workspaceRootId' in value, false)
})

test('rejects a path or unknown contextPartition-root state', () => {
  assert.throws(() => projectInstance({ instance: { ...active.instance,
    canonicalWorkspaceRoot: '/secret' } }), /projection-invalid/)
  assert.throws(() => projectInstance({ instance: { ...active.instance,
    workspaceRootState: 'guessed' } }), /projection-invalid/)
})
