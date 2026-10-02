// Hatter: prevent reintroducing product-specific owner ceremonies.
import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
const root = new URL('../', import.meta.url)
test('Hatter consumes packed browser protection but owns no Passkey or recovery implementation', async () => {
  for (const path of ['app/pages/connections/device-security.vue', 'server/api/device-security',
    'server/api/session', 'app/plugins/session.client.ts',
    'server/lib/crowsi-owner-security.mjs', 'shared/device-passkey-options.mjs',
    'server/lib/session-authority.mjs', 'server/lib/boundary.mjs']) {
    await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' })
  }
  const manifest = JSON.parse(await readFile(new URL('package.json', root)))
  assert.match(manifest.dependencies['@crowsi/browser-security'], /file:.*\/npm\/[a-f0-9]{64}\/crowsi-browser-security-0\.10\.0\.tgz$/u)
  for (const directory of ['delivery', 'server', 'shared']) {
    for (const path of await readdir(new URL(directory + '/', root), { recursive: true })) {
      if (!/\.(?:ts|mjs|vue)$/u.test(path)) continue
      const text = await readFile(new URL(directory + '/' + path, root), 'utf8')
      assert.doesNotMatch(text, /consumeLaunchCredential|createLaunchAccess|CROWSI_BROWSER_ACCESS_TOKEN/u, path)
      assert.doesNotMatch(text, /navigator\.credentials|passkey-register|owner-recovery-root|owner-key|ownerRecovery|device-security/u, path)
    }
  }
})
