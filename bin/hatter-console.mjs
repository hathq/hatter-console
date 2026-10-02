#!/usr/bin/env node
// Modified by Hatter, 2026: delegate local browser access to the standalone Crowsi package.
import { randomBytes } from 'node:crypto'
import { sha256 } from '../server/lib/handoff.mjs'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const root = dirname(directory)
const server = join(root, '.output/server/index.mjs')

export async function validateLauncherHandoff(environment, launchers = []) {
  if (environment.HATTER_CONSOLE_HANDOFF_VERSION !== '1'
    || environment.HATTER_CONSOLE_HANDOFF_ACTIVE !== '1') invalid('handoff-inactive')
  const executable = environment.HATTER_CLI_EXECUTABLE
  const digest = environment.HATTER_CLI_EXECUTABLE_SHA256
  if (!isAbsolute(executable ?? '') || !/^sha256:[0-9a-f]{64}$/u.test(digest ?? '')) {
    invalid('handoff-invalid')
  }
  const [entry, physical] = await Promise.all([lstat(executable), realpath(executable)])
  if (!entry.isFile() || entry.size > 1024 ** 3 || entry.isSymbolicLink() || physical !== executable
    || entry.uid !== process.getuid?.() || (entry.mode & 0o111) === 0
    || (entry.mode & 0o022) !== 0 || launchers.includes(physical)
    || await sha256(physical) !== digest) invalid('handoff-untrusted')
  return physical
}

export async function validateLaunchDirectory(value) {
  if (!isAbsolute(value ?? '')) invalid('launch-cwd-invalid')
  const [entry, physical] = await Promise.all([lstat(value), realpath(value)])
  if (!entry.isDirectory() || entry.isSymbolicLink() || physical !== value) {
    invalid('launch-cwd-untrusted')
  }
  return physical
}

async function main() {
  const wrapper = await realpath(join(directory, 'hatter-console'))
  const launcher = await realpath(fileURLToPath(import.meta.url))
  await trustedFile(server, false)
  await trustedFile(wrapper, true)
  await trustedFile(launcher, false)
  await validateLauncherHandoff(process.env, [wrapper, launcher])
  await validateLaunchDirectory(process.env.HATTER_LAUNCH_CWD)
  if (!process.env.HATTER_MANAGEMENT_ENDPOINT) invalid('management-endpoint-required')
  // The shared Rust root owns this Node helper. There is no nested delivery
  // child or Console-owned Management process and no independent reaper.
  process.env.HATTER_CONSOLE_READINESS_TOKEN = randomBytes(32).toString('base64url')
  process.env.HATTER_CONSOLE_ORIGIN = 'http://localhost:4213'
  process.env.NODE_ENV = 'production'
  await import(pathToFileURL(server).href)
  process.stdout.write('http://localhost:4213/\n')
}

async function trustedFile(path, executable) {
  const [entry, physical] = await Promise.all([lstat(path), realpath(path)])
  if (!entry.isFile() || entry.isSymbolicLink() || physical !== path
    || entry.uid !== process.getuid?.() || (entry.mode & 0o022) !== 0
    || (executable && (entry.mode & 0o111) === 0)) invalid('release-untrusted')
}
function invalid(code) { throw new Error(`hatter-console-${code}`) }

if (process.argv[1] && await realpath(process.argv[1]).catch(() => '')
  === await realpath(fileURLToPath(import.meta.url))) main().catch(error => {
  process.stderr.write(`${error.message.startsWith('hatter-console-')
    ? error.message : 'hatter-console-launch-failed'}\n`); process.exitCode = 1
})
