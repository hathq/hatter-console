import assert from 'node:assert/strict'
import test from 'node:test'
import { expectedProtocol } from '../scripts/sync-management-protocol.mjs'
import { methodSet } from '../bin/hatter-protocol-verify.mjs'
import {
  CLIENT_RPC_METHODS,
  SERVER_REQUEST_METHODS,
  appServerArguments,
  loginParameters
} from '../server/lib/rpc-policy.mjs'

test('pins ephemeral authentication and strict local app-server mode', () => {
  assert.deepEqual(appServerArguments(), [
    '-c', 'cli_auth_credentials_store="ephemeral"',
    'app-server', '--stdio', '--strict-config',
    '--client-profile', 'management-console'
  ])
  assert.deepEqual(appServerArguments('local'), [
    '--profile', 'local',
    '-c', 'cli_auth_credentials_store="ephemeral"',
    'app-server', '--stdio', '--strict-config',
    '--client-profile', 'management-console'
  ])
  assert.throws(() => appServerArguments('../local'), /profile-invalid/u)
})

test('keeps the browser bridge method set closed', () => {
  assert(CLIENT_RPC_METHODS.has('account/login/start'))
  assert(CLIENT_RPC_METHODS.has('instance/read'))
  for (const removed of ['instance/initialize', 'instance/relocate', 'translation/interpret', 'translation/present']) {
    assert.equal(CLIENT_RPC_METHODS.has(removed), false)
  }
  const current = methodSet(expectedProtocol().canonical)
  for (const method of CLIENT_RPC_METHODS) assert(current.includes(method), method)
  for (const removed of ['thread/list', 'thread/read', 'thread/start', 'turn/start',
    'review/start', 'hat/package/install']) assert.equal(CLIENT_RPC_METHODS.has(removed), false)
  for (const rejected of ['fs/readFile', 'command/exec', 'process/spawn',
    'config/value/write', 'marketplace/add', 'remoteControl/enable']) {
    assert.equal(CLIENT_RPC_METHODS.has(rejected), false)
  }
  assert.deepEqual([...SERVER_REQUEST_METHODS], [])
})

test('allows only ChatGPT browser and device login', () => {
  assert.deepEqual(loginParameters('browser'), { type: 'chatgpt',
    codexStreamlinedLogin: true, useHostedLoginSuccessPage: true })
  assert.deepEqual(loginParameters('device'), { type: 'chatgptDeviceCode' })
  assert.throws(() => loginParameters('apiKey'), /login-flow-rejected/)
  assert.throws(() => loginParameters('externalTokens'), /login-flow-rejected/)
})
