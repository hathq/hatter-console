// Hatter F1: passive projections retain exact owner results and reject ambiguity.
import assert from 'node:assert/strict'
import test from 'node:test'
import { authResolution } from '../server/lib/auth-resolution.mjs'
import { authentication } from './auth-resolution-fixture.mjs'
test('owner primary, explicit alternate, failure chain and restart remain distinct and safe', () => {
  const initial = authentication
  assert.deepEqual(authResolution(initial), initial)
  const primary = { ...initial, request: { primary: 'apikey', fallback: null },
    state: 'resolvedPrimary', resolvedMode: 'apikey', credentialSource: 'command' }
  assert.deepEqual(authResolution(primary), primary)
  const failure = { owner: 'hatter-login', code: 'bootstrapUnavailable', attempts: 3 }
  const alternate = { ...initial, request: { primary: 'agentIdentity',
    fallback: 'agentIdentityToSessionOnBootstrapUnavailableV1' }, state: 'resolvedFallback',
    resolvedMode: 'chatgpt', fallback: 'accepted', credentialSource: 'managedSnapshot', primaryFailure: failure }
  assert.deepEqual(authResolution(alternate), alternate)
  const failed = { ...alternate, state: 'failedAll', resolvedMode: null, fallback: 'rejected',
    fallbackFailure: { owner: 'hatter-model-provider', code: 'credentialRejected', attempts: null } }
  assert.deepEqual(authResolution(failed), failed)
  for (const bad of [undefined, { ...initial, state: 'failedPrimary' }, { ...primary, primaryFailure: failure },
    { ...alternate, request: { primary: 'agentIdentity', fallback: null } },
    { ...alternate, primaryFailure: null }, { ...failed, fallbackFailure: null },
    { ...initial, resolvedMode: 'apikey' }, { ...initial, authGeneration: -1 },
    { ...primary, providerConfigRef: 'Bearer private' },
    { ...failed, primaryFailure: { ...failure, code: 'private-token' } }]) {
    assert.throws(() => authResolution(bad), { message: 'hatter-console-auth-resolution-invalid' })
  }
  const untrusted = { ...alternate, token: 'private-token', primaryFailure: { ...failure, body: 'private-token' } }
  assert(!JSON.stringify(authResolution(untrusted)).includes('private-token'))
})
