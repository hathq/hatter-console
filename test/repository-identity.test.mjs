// Hatter M3 FINAL: product identity uses the A0.1 explicit scope, not global discovery.
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('resolves the exact Console identity through the frozen product scope and rejects outsiders', async () => {
  const repository = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const identity = await readFile(join(repository, 'repository.toml'), 'utf8')
  assert.match(identity, /^schema_id = "repository-identity-v1"\nrepository_id = "hatter-console"\n$/u)
  const wonderland = await findWonderland(repository)
  const resolver = join(wonderland, 'tools/hatter-product-input.mjs')
  const options = { cwd: wonderland, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  const output = execFileSync(process.execPath,
    [resolver, 'value', 'repository', 'hatter-console'], options).trim()
  assert.equal(output, repository)
  assert.throws(() => execFileSync(process.execPath,
    [resolver, 'value', 'repository', 'zixcel-source-evidence'], options),
  error => error.status === 1 && error.stderr.includes('hatter-input-unexpected-repository'))
})

async function findWonderland(start) {
  let current = start
  while (dirname(current) !== current) {
    try { await access(join(current, 'tools/hatter-product-input.mjs')); return current } catch {}
    current = dirname(current)
  }
  throw new Error('wonderland-root-not-found')
}
