// Hatter downstream 2026: explicit generation; verification never writes.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { CLIENT_RPC_METHODS } from '../server/lib/rpc-policy.mjs'
import { projectManagementClientSchema } from './project-management-protocol.mjs'
import { typeScript, verifyProjection, graphProjection, stable, protocolFailure } from '../bin/hatter-protocol-verify.mjs'
const consoleRoot = path.resolve(import.meta.dirname, '..')
const producer = path.resolve(consoleRoot, '../hatter/cli/scripts/generate-management-protocol.mjs')
const generated = path.resolve(consoleRoot, '../hatter/cli/schema/generated')
export const graphPath = path.resolve(consoleRoot, '../../../hat-spec/repositories/hat-protocol-schema-debugger/generated/protocol-schema-graph.json')
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex')
export function expectedProtocol() {
  // Explicit owner process boundary, no cross-repository runtime/source import.
  const result = spawnSync(process.execPath, [producer, 'inspect'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  const owner = JSON.parse(result.stdout), canonical = owner.schema
  if (fs.readFileSync(path.join(generated, 'ClientRequest.json'), 'utf8') !== JSON.stringify(canonical, null, 2) + '\n'
    || fs.readFileSync(path.join(generated, 'ClientRequest.ts'), 'utf8') !== owner.typescript) protocolFailure('StaleSnapshot', ['canonical artifact'])
  const projected = projectManagementClientSchema(canonical), ts = typeScript(projected)
  verifyProjection(canonical, projected, ts, CLIENT_RPC_METHODS)
  return { canonical, projected, ts, graph: graphProjection(canonical, projected) }
}
export function verifySnapshot(root = path.join(consoleRoot, 'protocol-snapshot'), graph = graphPath) {
  const expected = expectedProtocol(), read = p => fs.readFileSync(path.join(root, p), 'utf8')
  const canonical = JSON.parse(read('json/CanonicalClientRequest.json'))
  if (stable(canonical) !== stable(expected.canonical)) protocolFailure('StaleSnapshot', ['canonical copy'])
  verifyProjection(canonical, JSON.parse(read('json/ClientRequest.json')), read('typescript/ClientRequest.ts'), CLIENT_RPC_METHODS)
  const manifest = JSON.parse(read('manifest.json'))
  for (const [p, hash] of Object.entries(manifest.files)) if (sha(read(p)) !== hash) protocolFailure('StaleSnapshot', [p])
  if (stable(JSON.parse(fs.readFileSync(graph)).management_protocol) !== stable(expected.graph)) protocolFailure('StaleSnapshot', ['graph'])
  return expected
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2]
    if (process.argv.length !== 3 || !['generate', 'verify'].includes(mode)) protocolFailure('UnsupportedRepresentation')
    if (mode === 'generate') {
      const value = expectedProtocol(), root = path.join(consoleRoot, 'protocol-snapshot')
      const files = { 'json/CanonicalClientRequest.json': JSON.stringify(value.canonical, null, 2) + '\n',
        'json/ClientRequest.json': JSON.stringify(value.projected, null, 2) + '\n', 'typescript/ClientRequest.ts': value.ts }
      const previous = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))), hashes = { ...previous.files }
      for (const [p, bytes] of Object.entries(files)) hashes[p] = sha(bytes)
      files['manifest.json'] = JSON.stringify({ schema: previous.schema, source: 'Derived from current Hatter Rust Request + METHODS; params validation belongs to runtime handlers.',
        representation: 'jsonl-request-envelope', files: hashes }, null, 2) + '\n'
      const graph = JSON.parse(fs.readFileSync(graphPath)); graph.management_protocol = value.graph
      // All derivation and parity validation finishes before publishing bytes.
      for (const [p, bytes] of Object.entries(files)) {
        const target = path.join(root, p); fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target + '.new', bytes, { flag: 'wx' }); fs.renameSync(target + '.new', target)
      }
      fs.writeFileSync(graphPath + '.new', JSON.stringify(graph, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(graphPath + '.new', graphPath)
    }
    verifySnapshot(); process.stdout.write('Hatter protocol snapshot verified.\n')
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
