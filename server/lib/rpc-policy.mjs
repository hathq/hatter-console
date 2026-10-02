// Modified by the Hatter downstream project, 2026.
// Purpose: keep the owner-browser RPC method set closed over formal management operations.
export const CLIENT_RPC_METHODS = new Set([
  'world/execute',
  'storage/execute',
  'model/runtime/execute',
  'hatter/status/read', 'inference/status/read',
  'runtime/codex-trace/read',
  'inference/role/list', 'inference/role/memory',
  'interaction/execute',
  'instance/read',
  'digital-twin/status/read', 'digital-twin/foundation/read', 'digital-twin/projection/read',
  'digital-twin/operational/list', 'digital-twin/task/runnable',
  'hat/catalog/list', 'hat/catalog/install', 'hat/catalog/package-preview',
  'hat/catalog-source/list', 'hat/catalog-source/write', 'hat/catalog-source/select',
  'hat/package/install-local', 'hat/package/install-ip', 'hat/package/read',
  'hat/capability/list', 'hat/action-plan/list', 'hat/action-plan/write',
  'hat/action-plan/approve', 'hat/information-surface/list', 'hat/service-requirement/list', 'hat/setup/list',
  'hat/setup/complete',
  'hat/activation/write', 'hat/activation/read', 'hat/activation/repair',
  'hat/activation/projection', 'hat/composition/prepare', 'hat/composition/approve',
  'hat/composition/read', 'hat/placement/read',
  'hat/placement/list', 'hat/placement/list-all', 'hat/placement/select',
  'hat/projection-journal/read',
  'hat/invocation/invoke', 'hat/invocation/list', 'hat/invocation/read',
  'hat/invocation/control',
  'hat/invocation/evidence/recover',
  'hat/worker/claim', 'hat/worker/register', 'hat/worker/read',
  'hat/worker/status', 'hat/worker/complete', 'hat/worker/unregister',
  'profile/form/list', 'profile/dictionary/read', 'profile/entry/list', 'profile/entry/read',
  'profile/entry/write', 'schema/graph/read',
  'model/list', 'model/refresh', 'model/provider/list', 'model/route/list', 'model/route/write',
  'model/route/remove', 'account/read',
  'account/login/start', 'account/login/cancel', 'account/logout',
  'account/select', 'account/remove',
  'account/rateLimits/read', 'account/usage/read'
])

export const SERVER_REQUEST_METHODS = new Set()

/** Forces account material to die with the supervised app-server process. */
export function appServerArguments(profile = null) {
  if (profile !== null && !/^[a-z][a-z0-9-]{0,63}$/u.test(profile)) {
    throw new Error('hatter-console-profile-invalid')
  }
  return [
    ...(profile === null ? [] : ['--profile', profile]),
    '-c', 'cli_auth_credentials_store="ephemeral"',
    'app-server', '--stdio', '--strict-config',
    '--client-profile', 'management-console'
  ]
}

export function requireClientMethod(method) {
  if (!CLIENT_RPC_METHODS.has(method)) throw new Error('hatter-console-rpc-rejected')
  return method
}

export function loginParameters(flow) {
  if (flow === 'browser') return { type: 'chatgpt', codexStreamlinedLogin: true,
    useHostedLoginSuccessPage: true }
  if (flow === 'device') return { type: 'chatgptDeviceCode' }
  throw new Error('hatter-console-login-flow-rejected')
}
