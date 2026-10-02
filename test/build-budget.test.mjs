import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  measureBuild,
  validateDependencyBoundary,
  validateMetrics
} from '../scripts/verify-build-budget.mjs'

test('keeps runtime dependencies on the reviewed lightweight boundary', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const policy = JSON.parse(await readFile(new URL('../build-policy.json', import.meta.url), 'utf8'))
  assert.doesNotThrow(() => validateDependencyBoundary(manifest, policy))
  for (const name of ['@hathq/delivery-server', '@hathq/delivery-client', '@hathq/dom-renderer']) {
    assert.match(manifest.dependencies[name], /^file:.*\/\.artifacts\/npm\/[a-f0-9]{64}\//u)
  }
  for (const name of ['nuxt', 'vue', 'nitropack', 'sigma', 'graphology', 'd3', 'd3-force', 'd3-hierarchy', 'd3-selection']) {
    assert.equal(name in manifest.dependencies, false)
  }
  assert.throws(() => validateDependencyBoundary({ dependencies: {
    ...manifest.dependencies, sqlite3: '5.1.7' } }, policy), /forbidden-runtime-dependency/)
  assert.throws(() => validateDependencyBoundary({ dependencies: {
    ...manifest.dependencies, 'd3-force': '3.0.0' } }, policy), /forbidden-runtime-dependency/)
  assert.throws(() => validateDependencyBoundary({ dependencies: {
    ...manifest.dependencies, nuxt: '4.5.0' } }, policy), /forbidden-runtime-dependency/)
})

test('measures client, server and generated-map costs and rejects budget drift', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-budget-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'public/assets'), { recursive: true })
  await mkdir(join(root, 'server'), { recursive: true })
  await writeFile(join(root, 'public/assets/entry.js'), '12345')
  await writeFile(join(root, 'public/assets/entry.css'), '123')
  await writeFile(join(root, 'server/index.mjs'), '12')
  const metrics = await measureBuild(root)
  assert.deepEqual(metrics, {
    outputBytes: 10,
    outputFiles: 3,
    serverBytes: 2,
    clientJavaScriptBytes: 5,
    clientCssBytes: 3,
    largestClientJavaScriptBytes: 5,
    sourceMapFiles: 0,
    outputNodeModuleFiles: 0,
    serverEntryBytes: 2
  })
  assert.doesNotThrow(() => validateMetrics(metrics, {
    outputBytes: 10, outputFiles: 3, serverBytes: 2, clientJavaScriptBytes: 5,
    clientCssBytes: 3, largestClientJavaScriptBytes: 5, sourceMapFiles: 0,
    outputNodeModuleFiles: 0
  }))
  assert.throws(() => validateMetrics(metrics, { clientJavaScriptBytes: 4 }),
    /budget-exceeded:clientJavaScriptBytes/)
})
