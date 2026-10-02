import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyProjection, graphProjection, stable } from './hatter-protocol-verify.mjs'

// Hatter 2026: one generation binds all mandatory owner process images.
export const PRODUCT_EXECUTABLES = Object.freeze({
  hatter: 'bin/hatter', console: 'bin/hatter-console',
  graph: 'bin/hatter-graph-owner', admission: 'bin/hatter-admission-owner',
  semantic: 'bin/hatter-semantic-owner'
})

export async function verifyRelease(root) {
  if (!isAbsolute(root ?? '') || root === '/') fail('path-invalid')
  const manifest = JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8'))
  if (manifest.schema !== 'hathq://hatter-console/release/v2'
    || manifest.port !== 4213 || manifest.appServerProtocol !== 'v2'
    || manifest.credentialPersistence !== 'process-ephemeral') fail('manifest-invalid')
  const expected = PRODUCT_EXECUTABLES
  if (JSON.stringify(Object.keys(manifest.executables ?? {}).sort())
    !== JSON.stringify(Object.keys(expected).sort())) fail('executables-incomplete')
  if ('codeModeHost' in (manifest.executables ?? {})) fail('removed-host-present')
  for (const [name, path] of Object.entries(expected)) {
    const item = manifest.executables?.[name]
    if (item?.path !== path || dirname(item.path) !== 'bin') fail('layout-invalid')
    await trustedExecutable(join(root, path))
    if (await fileDigest(join(root, path)) !== item.digest) fail('binary-digest-mismatch')
  }
  if (manifest.protocol?.path !== 'protocol'
    || manifest.protocol?.clientSchema !== 'protocol/schema/json/ClientRequest.json'
    || manifest.protocol?.typescript !== 'protocol/schema/typescript/ClientRequest.ts'
    || manifest.protocol?.hatDiscoverySchema
      !== 'protocol/schema/json/HatDiscoveryProjection.json') {
    fail('protocol-manifest-invalid')
  }
  await stat(join(root, manifest.protocol.clientSchema))
  await stat(join(root, manifest.protocol.typescript))
  await stat(join(root, manifest.protocol.hatDiscoverySchema))
  await verifyWireContract(root)
  await verifyHatDiscoveryContract(join(root, manifest.protocol.hatDiscoverySchema))
  if (await treeDigest(root, ['protocol']) !== manifest.protocol.digest) {
    fail('protocol-digest-mismatch')
  }
  if (manifest.licenses?.path !== 'licenses') fail('licenses-manifest-invalid')
  for (const file of ['hatter/LICENSE', 'hatter/NOTICE', 'hatter-console/LICENSE',
    'hatter-console/NOTICE', 'hatter-console/THIRD_PARTY_NOTICES.md', 'inventory.json']) {
    await stat(join(root, 'licenses', file)).catch(() => fail('license-required'))
  }
  const inventory = JSON.parse(await readFile(join(root, 'licenses/inventory.json'), 'utf8'))
  if (inventory.schema !== 'hatter/delivery/licenses/1' || !Array.isArray(inventory.packages)
    || inventory.packages.length < 1 || inventory.packages.length > 64) fail('license-inventory-invalid')
  const packageNames = new Set()
  for (const item of inventory.packages) {
    if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(item.name) || packageNames.has(item.name)
      || /^(?:nuxt|nitro|nitropack|vue|vue-router|h3|@nuxt\/|@vue\/|@nuxtjp\/)/.test(item.name)
      || !Array.isArray(item.files) || !item.files.length || item.files.length > 5) fail('license-inventory-invalid')
    packageNames.add(item.name)
    for (const file of item.files) {
      if (typeof file.path !== 'string' || !file.path.startsWith(item.name.replace('@', '') + '/')
        || file.path.includes('..') || !/^LICENSE(?:\.md|-MIT|-APACHE)?$|^NOTICE$/.test(file.path.split('/').at(-1))) fail('license-inventory-invalid')
      if (await fileDigest(join(root, 'licenses', file.path)) !== file.digest) fail('license-digest-mismatch')
    }
  }
  if (await treeDigest(root, ['licenses']) !== manifest.licenses.digest) {
    fail('licenses-digest-mismatch')
  }
  if ('builtInHats' in manifest || await exists(join(root, 'share/hatter/hats'))) {
    fail('retired-built-in-hats-present')
  }
  if (await treeDigest(root, ['.output', 'bin', 'licenses', 'protocol'])
    !== manifest.payloadDigest) {
    fail('payload-digest-mismatch')
  }
  return manifest
}

async function verifyWireContract(root) {
  const canonical = JSON.parse(await readFile(join(root, 'protocol/schema/json/CanonicalClientRequest.json'), 'utf8'))
  const client = JSON.parse(await readFile(join(root, 'protocol/schema/json/ClientRequest.json'), 'utf8'))
  const ts = await readFile(join(root, 'protocol/schema/typescript/ClientRequest.ts'), 'utf8')
  const allowed = client['x-hatter-projection']?.methods
  if (!Array.isArray(allowed)) fail('protocol-projection-required')
  verifyProjection(canonical, client, ts, allowed)
  const graph = JSON.parse(await readFile(join(root, 'protocol/schema/debug/protocol-schema-graph.json'), 'utf8'))
  if (stable(graph.management_protocol) !== stable(graphProjection(canonical, client))) fail('protocol-graph-mismatch')
}
async function verifyHatDiscoveryContract(schemaPath) {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
  if (schema.$id !== 'hathq://hatter-console/hat-discovery/v1'
    || schema.properties?.candidateSource?.const !== 'signed-catalog'
    || schema.properties?.genreSource?.const
      !== 'hat-information-coordinate.data_domain_term_id') {
    fail('hat-discovery-schema-invalid')
  }
  for (const value of [schema.$defs?.candidate?.properties, schema.$defs?.genre?.properties]) {
    for (const field of ['path', 'route', 'icon', 'component', 'executable']) {
      if (field in (value ?? {})) fail('hat-discovery-schema-invalid')
    }
  }
}
async function trustedExecutable(path) {
  const [entry, physical] = await Promise.all([lstat(path), realpath(path)])
  if (!entry.isFile() || entry.isSymbolicLink() || physical !== path
    || entry.uid !== process.getuid?.() || (entry.mode & 0o111) === 0
    || (entry.mode & 0o077) !== 0) fail('executable-untrusted')
}
async function treeDigest(root, directories) {
  const files = (await Promise.all(directories.map(value => walkRoot(root, join(root, value)))))
    .flat().sort()
  const digest = createHash('sha256')
  for (const file of files) {
    const entry = await lstat(join(root, file))
    if (!entry.isFile() || entry.isSymbolicLink()) fail('entry-invalid')
    digest.update(`${file}\0${entry.mode & 0o777}\0`)
    digest.update(await readFile(join(root, file))); digest.update('\0')
  }
  return `sha256:${digest.digest('hex')}`
}
async function walkRoot(root, directory) {
  const entry = await lstat(directory)
  if (!entry.isDirectory() || entry.isSymbolicLink()) fail('entry-invalid')
  return walk(root, directory)
}
async function walk(root, directory) {
  const values = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) fail('entry-invalid')
    if (entry.isDirectory()) values.push(...await walk(root, path))
    else if (entry.isFile()) values.push(relative(root, path))
    else fail('entry-invalid')
  }
  return values
}
async function fileDigest(path) {
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`
}
async function exists(path) { try { await lstat(path); return true } catch { return false } }
function fail(code) { throw new Error(`hatter-console-release-${code}`) }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRelease(process.argv[2]).then(value => process.stdout.write(`${value.payloadDigest}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
