import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyRelease, PRODUCT_EXECUTABLES } from '../bin/hatter-release-verify.mjs'
import { releaseDigest, treeDigest } from '../scripts/lib/release-digest.mjs'
import { typeScript, graphProjection } from '../bin/hatter-protocol-verify.mjs'

test('bundled verifier accepts one complete generation and detects mutation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-release-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const path of ['bin', '.output/server', 'protocol/schema/json',
    'protocol/schema/typescript', 'protocol/schema/debug', 'licenses/hatter', 'licenses/hatter-console',
    'licenses/hathq/dom-renderer']) {
    await mkdir(join(root, path), { recursive: true })
  }
  const binaries = Object.values(PRODUCT_EXECUTABLES).map(path => path.slice(4))
  for (const name of binaries) {
    await writeFile(join(root, 'bin', name), `fixture-${name}`); await chmod(join(root, 'bin', name), 0o700)
  }
  await writeFile(join(root, 'bin/hatter-release-verify.mjs'), 'fixture verifier')
  await writeFile(join(root, 'bin/hatter-console.mjs'), 'fixture launcher')
  await writeFile(join(root, '.output/server/index.mjs'), 'fixture server')
  const client = JSON.parse(await readFile(new URL('../protocol-snapshot/json/ClientRequest.json', import.meta.url)))
  const canonical = JSON.parse(await readFile(new URL('../protocol-snapshot/json/CanonicalClientRequest.json', import.meta.url)))
  await writeFile(join(root, 'protocol/schema/json/ClientRequest.json'), JSON.stringify(client))
  await writeFile(join(root, 'protocol/schema/json/CanonicalClientRequest.json'), JSON.stringify(canonical))
  await writeFile(join(root, 'protocol/schema/debug/protocol-schema-graph.json'), JSON.stringify({ management_protocol: graphProjection(canonical, client) }))
  await writeFile(join(root, 'protocol/schema/json/HatDiscoveryProjection.json'),
    JSON.stringify(hatDiscoverySchema()))
  await writeFile(join(root, 'protocol/schema/typescript/ClientRequest.ts'), typeScript(client))
  for (const file of ['hatter/LICENSE', 'hatter/NOTICE', 'hatter-console/LICENSE',
    'hatter-console/NOTICE', 'hatter-console/THIRD_PARTY_NOTICES.md',
    'hathq/dom-renderer/LICENSE']) {
    await writeFile(join(root, 'licenses', file), `fixture ${file}`)
  }
  await writeFile(join(root, 'licenses/inventory.json'), JSON.stringify({
    schema: 'hatter/delivery/licenses/1', packages: [{ name: '@hathq/dom-renderer',
      files: [{ path: 'hathq/dom-renderer/LICENSE', digest: await fileDigest(join(root, 'licenses/hathq/dom-renderer/LICENSE')) }] }]
  }))
  const executables = {}
  for (const [key, path] of Object.entries(PRODUCT_EXECUTABLES)) {
    executables[key] = { path, digest: await fileDigest(join(root, path)) }
  }
  const manifest = { schema: 'hathq://hatter-console/release/v2', version: '0.10.0',
    payloadDigest: await releaseDigest(root), port: 4213, appServerProtocol: 'v2',
    credentialPersistence: 'process-ephemeral', executables,
    protocol: { path: 'protocol', digest: await treeDigest(root, ['protocol']),
      clientSchema: 'protocol/schema/json/ClientRequest.json',
      typescript: 'protocol/schema/typescript/ClientRequest.ts',
      hatDiscoverySchema: 'protocol/schema/json/HatDiscoveryProjection.json' },
    licenses: { path: 'licenses', digest: await treeDigest(root, ['licenses']) } }
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest))
  assert.equal((await verifyRelease(root)).payloadDigest, manifest.payloadDigest)
  const owner = join(root, PRODUCT_EXECUTABLES.graph), image = await readFile(owner)
  await writeFile(owner, 'wrong owner generation')
  await assert.rejects(verifyRelease(root), /binary-digest-mismatch/)
  await writeFile(owner, image)
  const graph = manifest.executables.graph
  delete manifest.executables.graph
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest))
  await assert.rejects(verifyRelease(root), /executables-incomplete/)
  manifest.executables.graph = graph
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'protocol/schema/typescript/ClientRequest.ts'), 'export type ClientRequest = unknown\n')
  await assert.rejects(verifyRelease(root), /JsonTypeScriptMismatch/)
  await writeFile(join(root, 'protocol/schema/typescript/ClientRequest.ts'), typeScript(client))
  await writeFile(join(root, 'bin/hatter'), 'mutated'); await chmod(join(root, 'bin/hatter'), 0o700)
  await assert.rejects(verifyRelease(root), /binary-digest-mismatch/)
})

test('release hashing rejects symbolic links even when they stay inside output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-linked-output-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.output/server/shared'), { recursive: true })
  await writeFile(join(root, '.output/server/shared/index.mjs'), 'export default true\n')
  await symlink('shared', join(root, '.output/server/linked'))
  await assert.rejects(treeDigest(root, ['.output']), /release-entry-invalid/u)
})

test('release hashing rejects a linked output root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-linked-root-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'physical/server'), { recursive: true })
  await writeFile(join(root, 'physical/server/index.mjs'), 'export default true\n')
  await symlink('physical', join(root, '.output'))
  await assert.rejects(treeDigest(root, ['.output']), /release-entry-invalid/u)
})

function hatDiscoverySchema() {
  return { $id: 'hathq://hatter-console/hat-discovery/v1', properties: {
    candidateSource: { const: 'signed-catalog' },
    genreSource: { const: 'hat-information-coordinate.data_domain_term_id' }
  }, $defs: { candidate: { properties: {} }, genre: { properties: {} } } }
}
async function fileDigest(path) {
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`
}
