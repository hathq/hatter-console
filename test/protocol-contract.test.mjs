// Hatter downstream 2026: exact canonical envelope and derived subset contract.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { verifySnapshot, graphPath } from '../scripts/sync-management-protocol.mjs'
import { methodSet, typeScript, stable } from '../bin/hatter-protocol-verify.mjs'
import { CLIENT_RPC_METHODS } from '../server/lib/rpc-policy.mjs'
const root = path.resolve(import.meta.dirname, '..')
const owner = path.resolve(root, '../hatter/cli')
const sha = b => createHash('sha256').update(b).digest('hex')

test('owner artifact, frozen Console projection, TS and graph agree; repeated verification is read-only', () => {
  const inputs = ['protocol-snapshot/manifest.json', 'protocol-snapshot/json/ClientRequest.json',
    'protocol-snapshot/json/CanonicalClientRequest.json', 'protocol-snapshot/typescript/ClientRequest.ts'].map(p => path.join(root, p)).concat(graphPath)
  const before = inputs.map(p => sha(fs.readFileSync(p)))
  const result = verifySnapshot()
  assert.deepEqual(verifySnapshot(), result)
  assert.deepEqual(inputs.map(p => sha(fs.readFileSync(p))), before)
  assert.deepEqual(methodSet(result.projected), [...CLIENT_RPC_METHODS].sort())
  assert.equal(result.ts, typeScript(result.projected))
  assert.equal(result.canonical['x-hatter-contract'].representation, 'jsonl-request-envelope')
  for (const branch of result.canonical.oneOf) {
    assert.equal(branch.additionalProperties, false)
    assert.deepEqual(branch.required, ['id', 'method'])
    const [textId,numberId]=branch.properties.id.oneOf
    assert.equal(textId.type,'string')
    assert.equal(textId.minLength,1)
    assert.equal(textId.maxLength,128)
    assert.equal(textId['x-max-utf8-bytes'],128)
    assert(new RegExp(textId.pattern).test('correlation:1'))
    assert(!new RegExp(textId.pattern).test('correlation\n1'))
    assert.deepEqual(numberId,{type:'number'})
    assert.deepEqual(branch.properties.params, {}) // Rust Value, not a claimed owner-payload schema.
  }
  for (const name of ['hat/activation/write','hat/activation/read','hat/activation/repair',
    'hat/activation/projection','hat/composition/prepare','hat/composition/approve','hat/composition/read']) {
    assert.ok(methodSet(result.projected).includes(name))
  }
  assert.deepEqual(result.projected.definitions, {}) // no inherited stale payload authority
})

test('canonical producer rejects unsupported wire, duplicate declarations and missing dispatch, independent of Console', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hatter-protocol-owner-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  fs.mkdirSync(path.join(temp, 'scripts')); fs.mkdirSync(path.join(temp, 'src/management_server'), { recursive: true })
  const generator = path.join(temp, 'scripts/generate-management-protocol.mjs')
  fs.copyFileSync(path.join(owner, 'scripts/generate-management-protocol.mjs'), generator)
  for (const name of ['wire','mod','hats','account','digital_twin','profile','instance']) {
    fs.copyFileSync(path.join(owner, `src/management_server/${name}.rs`), path.join(temp, `src/management_server/${name}.rs`))
  }
  const wire = path.join(temp, 'src/management_server/wire.rs'), original = fs.readFileSync(wire, 'utf8')
  const run = () => spawnSync(process.execPath, [generator, 'inspect'], { encoding: 'utf8' })
  assert.equal(run().status, 0)
  for (const [source, error] of [
    [original.replace('"initialize",', '"initialize", "initialize",'), 'DuplicateMethod'],
    [original.replace('"initialize",', '"fixture/absent",'), 'CanonicalMethodMissing'],
    [original.replace('pub params: Value,', 'pub params: String,'), 'UnsupportedRepresentation']
  ]) { fs.writeFileSync(wire, source); const r = run(); assert.equal(r.status, 1); assert.match(r.stderr, new RegExp(error)) }
  fs.writeFileSync(wire, original)
  const initial = JSON.parse(run().stdout)
  const head = original.indexOf('pub const METHODS'), end = original.indexOf('];', head)
  const segment = original.slice(head, end)
  const literals = [...segment.matchAll(/"([^"]+)"/g)].map(m => m[0]).reverse()
  fs.writeFileSync(wire, original.slice(0, head) + 'pub const METHODS: &[&str] = &[\n' + literals.map(x => '    '+x+',').join('\n') + '\n' + original.slice(end))
  const reordered = JSON.parse(run().stdout)
  assert.deepEqual(methodSet(reordered.schema), methodSet(initial.schema))
  assert.equal(reordered.typescript, initial.typescript)
  // Raw source provenance changes; effective representation stays identical.
  assert.equal(stable(reordered.schema.oneOf), stable(initial.schema.oneOf))
})
