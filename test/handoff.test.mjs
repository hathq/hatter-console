import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readHandoff } from '../server/lib/handoff.mjs'

test('requires the versioned active CLI handoff', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-handoff-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = join(root, 'hatter')
  await writeFile(executable, '#!/bin/sh\nexit 0\n')
  await chmod(executable, 0o700)
  const digest = `sha256:${createHash('sha256').update('#!/bin/sh\nexit 0\n').digest('hex')}`
  const value = await readHandoff({ HATTER_CLI_EXECUTABLE: executable,
    HATTER_CLI_EXECUTABLE_SHA256: digest,
    HATTER_LAUNCH_CWD: root,
    HATTER_CONSOLE_HANDOFF_VERSION: '1', HATTER_CONSOLE_HANDOFF_ACTIVE: '1' })
  assert.equal(value.executable, executable)
  for (const environment of [
    { HATTER_CLI_EXECUTABLE: executable, HATTER_CLI_EXECUTABLE_SHA256: digest,
      HATTER_LAUNCH_CWD: root,
      HATTER_CONSOLE_HANDOFF_VERSION: '2',
      HATTER_CONSOLE_HANDOFF_ACTIVE: '1' },
    { HATTER_CLI_EXECUTABLE: executable, HATTER_CLI_EXECUTABLE_SHA256: digest,
      HATTER_LAUNCH_CWD: root,
      HATTER_CONSOLE_HANDOFF_VERSION: '1',
      HATTER_CONSOLE_HANDOFF_ACTIVE: '0' }
  ]) await assert.rejects(readHandoff(environment), /handoff/)
  await assert.rejects(readHandoff({ HATTER_CLI_EXECUTABLE: executable,
    HATTER_CLI_EXECUTABLE_SHA256: `sha256:${'0'.repeat(64)}`,
    HATTER_LAUNCH_CWD: root,
    HATTER_CONSOLE_HANDOFF_VERSION: '1', HATTER_CONSOLE_HANDOFF_ACTIVE: '1' }),
  /untrusted/)
  await assert.rejects(readHandoff({ HATTER_CLI_EXECUTABLE: executable,
    HATTER_CLI_EXECUTABLE_SHA256: digest, HATTER_LAUNCH_CWD: 'relative',
    HATTER_CONSOLE_HANDOFF_VERSION: '1', HATTER_CONSOLE_HANDOFF_ACTIVE: '1' }),
  /launch-cwd-invalid/)
  await assert.rejects(readHandoff({ HATTER_CLI_EXECUTABLE: executable,
    HATTER_CLI_EXECUTABLE_SHA256: digest, HATTER_LAUNCH_CWD: join(root, 'missing'),
    HATTER_CONSOLE_HANDOFF_VERSION: '1', HATTER_CONSOLE_HANDOFF_ACTIVE: '1' }),
  /launch-cwd-untrusted/)
})
