// Modified by the Hatter downstream project, 2026.
// Purpose: bind the exact Hatter and Console payload into one immutable release digest.
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** Digests the exact executable release payload; symlinks are never admitted. */
export async function releaseDigest(root) {
  return treeDigest(root, ['.output', 'bin', 'licenses', 'protocol'])
}

export async function treeDigest(root, directories) {
  const files = (await Promise.all(directories
    .map(value => walkRoot(root, join(root, value))))).flat().sort()
  if (!files.length) throw new Error('hatter-console-release-empty')
  const digest = createHash('sha256')
  for (const file of files) {
    const entry = await lstat(join(root, file))
    if (!entry.isFile() || entry.isSymbolicLink()) invalid()
    digest.update(`${file}\0${entry.mode & 0o777}\0`)
    digest.update(await readFile(join(root, file))); digest.update('\0')
  }
  return `sha256:${digest.digest('hex')}`
}

async function walkRoot(root, directory) {
  const entry = await lstat(directory)
  if (!entry.isDirectory() || entry.isSymbolicLink()) invalid()
  return walk(root, directory)
}

async function walk(root, directory) {
  const values = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) invalid()
    if (entry.isDirectory()) values.push(...await walk(root, path))
    else if (entry.isFile()) values.push(relative(root, path))
    else invalid()
  }
  return values
}
function invalid() { throw new Error('hatter-console-release-entry-invalid') }
