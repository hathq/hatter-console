import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertSafeProjection,
  projectAccount
} from '../server/lib/projection.mjs'

test('removes account email and rejects unsafe generic projections', () => {
  assert.deepEqual(projectAccount({ account: {
    type: 'chatgpt', email: 'owner@example.invalid', planType: 'plus'
  }, provider: { id: 'chatgpt', name: 'ChatGPT', requiresAccount: true } }), {
    state: 'authenticated', type: 'chatgpt', planType: 'plus',
    provider: { id: 'chatgpt', label: 'ChatGPT', kind: 'inference-provider' },
    accounts: [], activeHandle: null,
    accountPolicy: { cardinality: 'multiple', maximumAccounts: 16,
      activeSelection: 'exactly-one-when-present', providerIdentityExposed: true },
    authenticationRequired: true, authenticationSatisfied: true,
    codexEnabled: true, persistence: 'process-ephemeral'
  })
  assert.equal(projectAccount({ account: {
    type: 'chatgpt', planType: 'plus'
  }, provider: { id: 'owner-runtime', name: 'Owner runtime', requiresAccount: false }
  }).codexEnabled, true)
  assert.equal(projectAccount({ account: null,
    provider: { id: 'chatgpt', name: 'ChatGPT', requiresAccount: true }
  }).authenticationSatisfied, false)
  assert.equal(projectAccount({ account: null,
    provider: { id: 'owner-runtime', name: 'Owner runtime', requiresAccount: false }
  }).codexEnabled, true)
  assert.throws(() => projectAccount({ account: null }), /provider-id-rejected/u)
  assert.throws(() => assertSafeProjection({ token: 'not-allowed' }),
    /projection-field-rejected/u)
})

test('projects multiple opaque account handles and one active selection', () => {
  const value = projectAccount({ account: { type: 'chatgpt', planType: 'plus' },
    accounts: [{ handle: `account-${'a'.repeat(24)}`, selected: false, kind: 'chatgpt' },
      { handle: `account-${'b'.repeat(24)}`, selected: true, kind: 'chatgpt' }],
    provider: { id: 'chatgpt', name: 'ChatGPT', requiresAccount: true } })
  assert.equal(value.accounts.length, 2)
  assert.equal(value.activeHandle, `account-${'b'.repeat(24)}`)
  assert.deepEqual(value.accounts.map(item => item.label), ['認証 1', '認証 2'])
})
