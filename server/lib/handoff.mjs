// Modified by Hatter, 2026: finite handoff hashing; no mutable source fallback.
import { constants } from 'node:fs'
import { access, lstat, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { isAbsolute } from 'node:path'

/** Rechecks the CLI-issued handoff before the executable crosses the process boundary. */
export async function readHandoff(environment = process.env) {
  if (environment.HATTER_CONSOLE_HANDOFF_VERSION !== '1'
    || environment.HATTER_CONSOLE_HANDOFF_ACTIVE !== '1') {
    throw new Error('hatter-console-handoff-inactive')
  }
  const executable = environment.HATTER_CLI_EXECUTABLE
  const expectedDigest = environment.HATTER_CLI_EXECUTABLE_SHA256
  const launchCwd = environment.HATTER_LAUNCH_CWD
  if (typeof executable !== 'string' || !isAbsolute(executable)) {
    throw new Error('hatter-console-handoff-executable-invalid')
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedDigest ?? '')) {
    throw new Error('hatter-console-handoff-digest-invalid')
  }
  if (typeof launchCwd !== 'string' || !isAbsolute(launchCwd)) {
    throw new Error('hatter-console-handoff-launch-cwd-invalid')
  }
  try {
    const [entry, physical] = await Promise.all([lstat(launchCwd), realpath(launchCwd)])
    if (!entry.isDirectory() || entry.isSymbolicLink() || physical !== launchCwd) {
      throw new Error('untrusted')
    }
  } catch {
    throw new Error('hatter-console-handoff-launch-cwd-untrusted')
  }
  try {
    const [entry, physical] = await Promise.all([lstat(executable), realpath(executable)])
    const uid = process.getuid?.()
    if (!entry.isFile() || entry.size > 1024 ** 3 || physical !== executable || entry.isSymbolicLink()
      || (entry.mode & 0o111) === 0 || (entry.mode & 0o022) !== 0
      || uid === undefined || entry.uid !== uid) throw new Error('untrusted')
    await access(executable, constants.X_OK)
    if (await sha256(executable) !== expectedDigest) throw new Error('untrusted')
  } catch {
    throw new Error('hatter-console-handoff-executable-untrusted')
  }
  return Object.freeze({ executable, launchCwd, version: 1, active: true })
}

export function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    let size = 0
    const stream = createReadStream(path, {flags:constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,highWaterMark:65536})
    const timer = setTimeout(() => stream.destroy(new Error('handoff-input-timeout')),10_000)
    stream.on('data', value => {
      size += value.length
      if (size > 1024 ** 3) stream.destroy(new Error('handoff-input-capacity-exceeded'))
      else hash.update(value)
    }).once('error', reject).once('end', () => resolve(`sha256:${hash.digest('hex')}`))
      .once('close',()=>clearTimeout(timer))
  })
}
