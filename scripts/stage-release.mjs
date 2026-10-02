// Modified by the Hatter downstream project, 2026.
// Purpose: stage only the projected management protocol used by the standalone Console.
import {
  chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm,
  stat, writeFile
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseDigest, treeDigest } from './lib/release-digest.mjs'
import { verifyBuildBudget } from './verify-build-budget.mjs'
import { verifyRelease, PRODUCT_EXECUTABLES } from '../bin/hatter-release-verify.mjs'
import { verifySnapshot, graphPath } from './sync-management-protocol.mjs'
import { stageDeliveryLicenses } from './stage-delivery-licenses.mjs'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const inputs = process.argv.slice(2)
if (inputs.length !== 3) fail('argument-count-invalid')
const [destination, hatter, protocolSource] = inputs
for (const value of inputs) {
  if (!isAbsolute(value ?? '') || value === '/') fail('argument-invalid')
}
await trustedExecutable(hatter)
const ownerImages = Object.entries(PRODUCT_EXECUTABLES)
  .filter(([key]) => !['hatter', 'console'].includes(key))
  .map(([key, path]) => [key, join(dirname(hatter), path.slice(4)), path])
for (const [, source] of ownerImages) await trustedExecutable(source)
await stat(join(repository, '.output/server/index.mjs')).catch(() => fail('build-required'))
await verifyBuildBudget(join(repository, '.output'))
await trustedDirectory(protocolSource)
await trustedTree(protocolSource)
// Protocol preflight is read-only and uses the same canonical/subset/parity gate
// as development verification. No compatibility snapshot path is selected.
verifySnapshot(protocolSource)
await mkdir(destination, { recursive: true, mode: 0o700 })
const temporary = await mkdtemp(join(destination, '.stage-'))
try {
  await mkdir(join(temporary, 'bin'), { recursive: true })
  await cp(join(repository, '.output'), join(temporary, '.output'), { recursive: true })
  await mkdir(join(temporary, 'protocol/schema/json'), { recursive: true })
  await mkdir(join(temporary, 'protocol/schema/typescript'), { recursive: true })
  for (const name of ['ClientRequest.json', 'CanonicalClientRequest.json']) {
    await cp(join(protocolSource, 'json', name), join(temporary, 'protocol/schema/json', name))
  }
  await cp(join(protocolSource, 'typescript/ClientRequest.ts'),
    join(temporary, 'protocol/schema/typescript/ClientRequest.ts'))
  await cp(join(repository, 'protocol-snapshot/hat-discovery-contract.schema.json'),
    join(temporary, 'protocol/schema/json/HatDiscoveryProjection.json'))
  await mkdir(join(temporary, 'protocol/schema/debug'), { recursive: true })
  await cp(graphPath, join(temporary, 'protocol/schema/debug/protocol-schema-graph.json'))
  await mkdir(join(temporary, 'licenses'), { recursive: true })
  await cp(join(repository, 'licenses/hatter'), join(temporary, 'licenses/hatter'), { recursive: true })
  await stageDeliveryLicenses(repository, join(temporary, 'licenses'))
  await mkdir(join(temporary, 'licenses/hatter-console'), { recursive: true })
  await cp(join(repository, 'LICENSE'), join(temporary, 'licenses/hatter-console/LICENSE'))
  await cp(join(repository, 'NOTICE'), join(temporary, 'licenses/hatter-console/NOTICE'))
  await cp(join(repository, 'THIRD_PARTY_NOTICES.md'),
    join(temporary, 'licenses/hatter-console/THIRD_PARTY_NOTICES.md'))
  for (const [source, name, mode] of [
    [hatter, 'hatter', 0o700],
    [join(repository, 'bin/hatter-console'), 'hatter-console', 0o700],
    [join(repository, '.output/bin/hatter-console.mjs'), 'hatter-console.mjs', 0o600],
    [join(repository, 'bin/hatter-release-verify.mjs'), 'hatter-release-verify.mjs', 0o600],
    [join(repository, 'bin/hatter-protocol-verify.mjs'), 'hatter-protocol-verify.mjs', 0o600]
  ]) {
    await cp(source, join(temporary, 'bin', name)); await chmod(join(temporary, 'bin', name), mode)
  }
  for (const [, source, path] of ownerImages) {
    await cp(source, join(temporary, path)); await chmod(join(temporary, path), 0o700)
  }
  const payloadDigest = await releaseDigest(temporary)
  const protocolDigest = await treeDigest(temporary, ['protocol'])
  const licensesDigest = await treeDigest(temporary, ['licenses'])
  const version = JSON.parse(await readFile(join(repository, 'package.json'))).version
  const manifest = { schema: 'hathq://hatter-console/release/v2', version,
    payloadDigest, port: 4213, appServerProtocol: 'v2',
    credentialPersistence: 'process-ephemeral',
    executables: {
      hatter: binary('bin/hatter', await fileDigest(join(temporary, 'bin/hatter'))),
      console: binary('bin/hatter-console',
        await fileDigest(join(temporary, 'bin/hatter-console'))),
      ...Object.fromEntries(await Promise.all(ownerImages.map(async ([key, , path]) =>
        [key, binary(path, await fileDigest(join(temporary, path)))])))
    }, protocol: { path: 'protocol', digest: protocolDigest,
      clientSchema: 'protocol/schema/json/ClientRequest.json',
      typescript: 'protocol/schema/typescript/ClientRequest.ts',
      hatDiscoverySchema: 'protocol/schema/json/HatDiscoveryProjection.json' },
    licenses: { path: 'licenses', digest: licensesDigest } }
  await writeFile(join(temporary, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  const target = join(destination, payloadDigest.slice('sha256:'.length))
  try { await rename(temporary, target) } catch (error) {
    // Linux reports ENOTEMPTY when a non-empty generation already exists;
    // treat it like EEXIST so repeated staging is idempotent.  The existing
    // generation is still fully verified before the temporary tree is gone.
    if (!['EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw error
    await rm(temporary, { recursive: true, force: true }); await verifyRelease(target)
  }
  process.stdout.write(`${target}\n`)
} catch (error) {
  await rm(temporary, { recursive: true, force: true }); throw error
}

function binary(path, digest) { return { path, digest } }
async function trustedExecutable(path) {
  const [value, physical] = await Promise.all([lstat(path), realpath(path)])
  if (!value.isFile() || value.isSymbolicLink() || physical !== path
    || value.uid !== process.getuid?.() || (value.mode & 0o111) === 0
    || (value.mode & 0o022) !== 0) fail('executable-untrusted')
}
async function trustedDirectory(path) {
  const [entry, physical] = await Promise.all([lstat(path), realpath(path)])
  if (!entry.isDirectory() || entry.isSymbolicLink() || physical !== path
    || entry.uid !== process.getuid?.() || (entry.mode & 0o022) !== 0) {
    fail('protocol-artifact-untrusted')
  }
}
async function trustedTree(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || entry.uid !== process.getuid?.()
      || (entry.mode & 0o022) !== 0) fail('protocol-artifact-untrusted')
    if (entry.isDirectory()) await trustedTree(path)
    else if (!entry.isFile()) fail('protocol-artifact-untrusted')
  }
}
async function fileDigest(path) {
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`
}
function fail(code) { throw new Error(`hatter-console-release-${code}`) }
