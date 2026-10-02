// Added by the Hatter downstream project, 2026.
// Purpose: keep the standalone Console release within an explicit dependency and byte budget.
import { lstat, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))

export async function verifyBuildBudget(output = join(repository, '.output'), options = {}) {
  const policy = options.policy ?? JSON.parse(await readFile(
    options.policyPath ?? join(repository, 'build-policy.json'), 'utf8'))
  const manifest = options.manifest ?? JSON.parse(await readFile(
    options.manifestPath ?? join(repository, 'package.json'), 'utf8'))
  validateDependencyBoundary(manifest, policy)
  const metrics = await measureBuild(output)
  validateMetrics(metrics, policy.budgets)
  return { schema: policy.schema, metrics }
}

export async function measureBuild(output) {
  const files = await regularFiles(output)
  const size = path => files.find(value => value.path === path)?.bytes ?? 0
  const client = files.filter(value => value.path.startsWith('public/assets/'))
  const clientJavaScript = client.filter(value => value.path.endsWith('.js'))
  return {
    outputBytes: files.reduce((total, value) => total + value.bytes, 0),
    outputFiles: files.length,
    serverBytes: files.filter(value => value.path.startsWith('server/'))
      .reduce((total, value) => total + value.bytes, 0),
    clientJavaScriptBytes: clientJavaScript.reduce((total, value) => total + value.bytes, 0),
    clientCssBytes: client.filter(value => value.path.endsWith('.css'))
      .reduce((total, value) => total + value.bytes, 0),
    largestClientJavaScriptBytes: Math.max(0, ...clientJavaScript.map(value => value.bytes)),
    sourceMapFiles: files.filter(value => value.path.endsWith('.map')).length,
    outputNodeModuleFiles: files.filter(value => value.path.includes('/node_modules/')
      || value.path.startsWith('node_modules/')).length,
    serverEntryBytes: size('server/index.mjs')
  }
}

export function validateDependencyBoundary(manifest, policy) {
  const dependencies = Object.keys(manifest.dependencies ?? {}).sort()
  const allowed = [...policy.runtimeDependencies].sort()
  const forbidden = dependencies.filter(value => policy.forbiddenRuntimeDependencies.includes(value))
  if (forbidden.length) fail(`forbidden-runtime-dependency:${forbidden.join(',')}`)
  if (JSON.stringify(dependencies) !== JSON.stringify(allowed)) {
    const unexpected = dependencies.filter(value => !allowed.includes(value))
    const missing = allowed.filter(value => !dependencies.includes(value))
    fail(`runtime-dependency-boundary:unexpected=${unexpected.join(',')};missing=${missing.join(',')}`)
  }
  for (const [name, specification] of Object.entries(manifest.dependencies ?? {})) {
    const local = String(specification).startsWith('file:')
    if (local !== policy.localRuntimeDependencies.includes(name)) {
      fail(`runtime-dependency-source:${name}`)
    }
    if (/^(?:https?|git\+|github:)/u.test(String(specification)) || specification === '*') {
      fail(`runtime-dependency-unpinned:${name}`)
    }
  }
}

export function validateMetrics(metrics, budgets) {
  for (const [name, maximum] of Object.entries(budgets)) {
    const actual = metrics[name]
    if (!Number.isSafeInteger(actual) || actual < 0) fail(`metric-invalid:${name}`)
    if (actual > maximum) fail(`budget-exceeded:${name}:${actual}:${maximum}`)
  }
}

async function regularFiles(root) {
  const values = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const status = await lstat(path)
      if (status.isSymbolicLink()) fail(`output-link:${relative(root, path)}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) values.push({ path: relative(root, path), bytes: status.size })
      else fail(`output-entry:${relative(root, path)}`)
    }
  }
  await visit(root)
  return values
}

function fail(reason) {
  throw new Error(`hatter-console-build-${reason}`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await verifyBuildBudget(process.argv[2])
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
