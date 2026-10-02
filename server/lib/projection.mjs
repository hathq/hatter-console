const forbiddenKeys = /^(?:path|cwd|command|commandActions|preview|prompt|log|logs|secret|token|email)$/iu
const secretText = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{12,})/u

export function projectAccount(raw) {
  const account = raw?.account
  const accounts = projectAccounts(raw?.accounts)
  const provider = { id: token(raw?.provider?.id), label: displayRequired(raw?.provider?.name, 120),
    kind: 'inference-provider' }
  const authenticationRequired = boolean(raw?.provider?.requiresAccount)
  if (!account) return { state: 'signed-out', type: null, planType: null,
    provider, accounts, activeHandle: accounts.find(value => value.selected)?.handle ?? null,
    accountPolicy: accountPolicy(),
    authenticationRequired,
    authenticationSatisfied: !authenticationRequired,
    codexEnabled: !authenticationRequired, persistence: 'process-ephemeral' }
  const type = ['apiKey', 'chatgpt'].includes(account.type)
    ? account.type : 'unknown'
  return { state: 'authenticated', type,
    planType: account.type === 'chatgpt' ? display(account.planType, 40) : null,
    provider, accounts, activeHandle: accounts.find(value => value.selected)?.handle ?? null,
    accountPolicy: accountPolicy(),
    authenticationRequired, authenticationSatisfied: true,
    codexEnabled: true,
    persistence: 'process-ephemeral' }
}

function accountPolicy() { return { cardinality: 'multiple', maximumAccounts: 16,
  activeSelection: 'exactly-one-when-present', providerIdentityExposed: true } }

function projectAccounts(value) {
  if (!Array.isArray(value)) return []
  return value.map((account, index) => {
    if (typeof account?.handle !== 'string'
      || !/^account-[a-z0-9]{24,32}$/u.test(account.handle)) fail('account-handle-rejected')
    return { handle: account.handle, selected: account.selected === true,
      label: `${account.kind === 'apiKey' ? 'API接続' : '認証'} ${index + 1}` }
  })
}

export function assertSafeProjection(value, { relativeAssetPaths = false } = {}) {
  visit(value, relativeAssetPaths)
  return value
}

function visit(value, relativeAssetPaths) {
  const userHomePrefix = `/${'home'}/`
  if (typeof value === 'string' && (secretText.test(value) || value.includes(userHomePrefix))) {
    fail('projection-secret-rejected')
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { for (const item of value) visit(item, relativeAssetPaths); return }
  for (const [key, child] of Object.entries(value)) {
    // Explicit technical asset DTOs may contain a bounded single relative leaf.
    // This does not authorize filesystem paths, source paths, commands or secrets.
    const relativeLeaf = relativeAssetPaths && key === 'path' && typeof child === 'string'
      && child !== '.' && child !== '..' && /^[A-Za-z0-9._+\-]{1,128}$/u.test(child)
    if (forbiddenKeys.test(key) && !relativeLeaf) fail('projection-field-rejected')
    visit(child, relativeAssetPaths)
  }
}

function display(value, max) {
  return typeof value === 'string' && value.length <= max && !secretText.test(value)
    ? value : null
}
function displayRequired(value, max) {
  const result = display(value, max)
  if (result == null || !result) fail('provider-name-rejected')
  return result
}
function token(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    fail('provider-id-rejected')
  }
  return value
}
function boolean(value) {
  if (typeof value !== 'boolean') fail('provider-policy-rejected')
  return value
}
function fail(code) { throw new Error(`hatter-console-${code}`) }
