// Hatter 2026: exact command handoff and pre-listen setup refusal.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  validateLaunchDirectory, validateLauncherHandoff
} from '../bin/hatter-console.mjs'

test('R1 actual wrapper applies only a process-local descriptor ceiling',async t=>{
 const root=await mkdtemp(join(tmpdir(),'hatter-descriptor-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const wrapper=join(root,'hatter-console')
 await copyFile(new URL('../bin/hatter-console',import.meta.url),wrapper);await chmod(wrapper,0o700)
 await writeFile(join(root,'hatter-console.mjs'),`import fs from 'node:fs';process.stdout.write(fs.readFileSync('/proc/self/limits','utf8').split('\\n').find(l=>l.startsWith('Max open files')))`)
 const result=spawnSync(wrapper,[],{env:{...process.env,HATTER_CONSOLE_NODE_EXECUTABLE:process.execPath},encoding:'utf8',timeout:5000})
 assert.equal(result.status,0,result.stderr)
 assert(Number(result.stdout.trim().split(/\s+/u)[3])<=1024)
})

test('actual delivery wrapper forwards only the exact Management route and excludes unrelated credentials',async t=>{
  const root=await mkdtemp(join(tmpdir(),'hatter-wrapper-route-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const wrapper=join(root,'hatter-console')
  await copyFile(new URL('../bin/hatter-console',import.meta.url),wrapper);await chmod(wrapper,0o700)
  await writeFile(join(root,'hatter-console.mjs'),`import assert from 'node:assert/strict';assert.equal(process.env.HATTER_MANAGEMENT_ENDPOINT,'exact-test-route');assert.equal(process.env.UNRELATED_PROVIDER_SECRET,undefined);process.stdout.write('verified')`)
  const result=spawnSync(wrapper,[],{env:{...process.env,HOME:root,HATTER_HOME:root,HATTER_CONSOLE_NODE_EXECUTABLE:process.execPath,
    HATTER_MANAGEMENT_ENDPOINT:'exact-test-route',UNRELATED_PROVIDER_SECRET:'must-not-cross'},encoding:'utf8',timeout:5000})
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'verified')
})

test('launcher pins owner executable digest and rejects recursion', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-launcher-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = join(root, 'hatter')
  await writeFile(executable, '#!/bin/sh\nexit 0\n'); await chmod(executable, 0o700)
  const digest = `sha256:${createHash('sha256').update(await readFile(executable)).digest('hex')}`
  const environment = { HATTER_CLI_EXECUTABLE: executable,
    HATTER_CLI_EXECUTABLE_SHA256: digest,
    HATTER_CONSOLE_HANDOFF_VERSION: '1', HATTER_CONSOLE_HANDOFF_ACTIVE: '1' }
  assert.equal(await validateLauncherHandoff(environment), executable)
  assert.equal(await validateLaunchDirectory(root), root)
  await assert.rejects(validateLaunchDirectory('relative'), /launch-cwd-invalid/)
  await assert.rejects(validateLaunchDirectory(join(root, 'missing')), /ENOENT/)
  await assert.rejects(validateLauncherHandoff(environment, [executable]), /untrusted/)
  await assert.rejects(validateLauncherHandoff({ ...environment,
    HATTER_CLI_EXECUTABLE_SHA256: `sha256:${'0'.repeat(64)}` }), /untrusted/)
})

test('wrapper rejects relative and writable Node paths before startup', async t => {
  const wrapper = new URL('../bin/hatter-console', import.meta.url).pathname
  const relative = spawnSync(wrapper, [], { env: {
    ...process.env, HATTER_CONSOLE_NODE_EXECUTABLE: 'node' } })
  assert.equal(relative.status, 78)
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-node-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const writable = join(root, 'node')
  await writeFile(writable, '#!/bin/sh\nexit 0\n'); await chmod(writable, 0o722)
  const rejected = spawnSync(wrapper, [], { env: {
    ...process.env, HATTER_CONSOLE_NODE_EXECUTABLE: writable } })
  assert.equal(rejected.status, 78)
})

test('wrapper clears Node injection variables before invoking the pinned executable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-node-options-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const marker = join(root, 'injected'); const preload = join(root, 'preload.cjs')
  await writeFile(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')\n`)
  const wrapper = new URL('../bin/hatter-console', import.meta.url).pathname
  spawnSync(wrapper, [], { env: { ...process.env, HOME: root, HATTER_HOME: root,
    HATTER_CONSOLE_NODE_EXECUTABLE: process.execPath,
    NODE_OPTIONS: `--require=${preload}`, NODE_PATH: root } })
  await assert.rejects(access(marker))
})

test('wrapper supplies the Hatter default home when HATTER_HOME is unset', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-default-home-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const marker = join(root, 'observed-home'); const node = join(root, 'node')
  await writeFile(node, `#!/bin/sh
if [ "\${1:-}" = '-p' ]; then printf '%s\\n' '24.15.0'; exit 0; fi
printf '%s' "\${HATTER_HOME:-}" > ${JSON.stringify(marker)}
`)
  await chmod(node, 0o700)
  const wrapper = new URL('../bin/hatter-console', import.meta.url).pathname
  await mkdir(join(root,'.hatter/agent'),{recursive:true})
  const environment = { ...process.env, HOME: root,
    HATTER_CONSOLE_NODE_EXECUTABLE: node }
  delete environment.HATTER_HOME
  const result = spawnSync(wrapper, [], { env: environment })
  assert.equal(result.status, 0)
  assert.equal(await readFile(marker, 'utf8'), join(root, '.hatter/agent'))
})

test('missing home refuses before delivery with explicit setup and no data creation',async t=>{
  const root=await mkdtemp(join(tmpdir(),'hatter-console-uninitialized-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const home=join(root,'absent')
  const result=spawnSync(new URL('../bin/hatter-console',import.meta.url).pathname,[],{
    env:{...process.env,HOME:root,HATTER_HOME:home,HATTER_CONSOLE_NODE_EXECUTABLE:process.execPath},encoding:'utf8',timeout:5000})
  assert.equal(result.status,78)
  assert.equal(result.stdout,'','no URL may imply ready delivery')
  assert.equal(result.stderr,'hatter-console-home-invalid\nRun hatter state initialize with the same HATTER_HOME, then start hatter again.\n')
  await assert.rejects(access(home))
})

test('wrapper forwards only external-account custody without local owner-security configuration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-owner-security-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const marker = join(root, 'observed-owner-security'); const node = join(root, 'node')
  await writeFile(node, `#!/bin/sh
if [ "\${1:-}" = '-p' ]; then printf '%s\\n' '24.15.0'; exit 0; fi
printf '%s|%s|%s|%s|%s|%s' "\${HATTER_GITHUB_OAUTH_CLIENT_ID:-absent}" \
  "\${HATTER_CROWSI_CREDENTIAL_AGENT_AVAILABLE:-}" \
  "\${HATTER_CROWSI_CREDENTIAL_AGENT_EXECUTABLE:-}" \
  "\${HATTER_CROWSI_PA_KEY_AGENT_EXECUTABLE:-}" \
  "\${HATTER_CROWSI_SECURITY_ROOT:-}" \
  "\${HATTER_GITHUB_APP_PRIVATE_KEY:-absent}" > ${JSON.stringify(marker)}
`)
  await chmod(node, 0o700)
  const wrapper = new URL('../bin/hatter-console', import.meta.url).pathname
  const result = spawnSync(wrapper, [], { env: { ...process.env, HOME: root, HATTER_HOME: root,
    HATTER_CONSOLE_NODE_EXECUTABLE: node, HATTER_GITHUB_OAUTH_CLIENT_ID: 'must-not-cross',
    HATTER_GITHUB_APP_CLIENT_ID: 'must-not-cross',
    HATTER_CROWSI_CREDENTIAL_AGENT_AVAILABLE: '1',
    HATTER_CROWSI_CREDENTIAL_AGENT_EXECUTABLE: '/native/credential-agent',
    HATTER_CROWSI_PA_KEY_AGENT_EXECUTABLE: '/native/pa-key-agent',
    HATTER_CROWSI_SECURITY_ROOT: '/state/security',
    HATTER_GITHUB_APP_PRIVATE_KEY: 'must-not-cross' } })
  assert.equal(result.status, 0)
  assert.equal(await readFile(marker, 'utf8'),
    'absent|1|/native/credential-agent|||absent')
})

test('wrapper forwards only the selected profile and bounded owner-local provider token', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-local-provider-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const marker = join(root, 'observed-local-provider'); const node = join(root, 'node')
  await writeFile(node, `#!/bin/sh
if [ "\${1:-}" = '-p' ]; then printf '%s\n' '24.15.0'; exit 0; fi
printf '%s|%s|%s' "\${HATTER_CONSOLE_PROFILE:-}" \
  "\${HATTER_OWNER_LOCAL_PROVIDER_TOKEN:-}" \
  "\${UNRELATED_PROVIDER_SECRET:-absent}" > ${JSON.stringify(marker)}
`)
  await chmod(node, 0o700)
  const wrapper = new URL('../bin/hatter-console', import.meta.url).pathname
  const result = spawnSync(wrapper, [], { env: { ...process.env, HOME: root, HATTER_HOME: root,
    HATTER_CONSOLE_NODE_EXECUTABLE: node, HATTER_CONSOLE_PROFILE: 'local',
    HATTER_OWNER_LOCAL_PROVIDER_TOKEN: 'bounded-token',
    UNRELATED_PROVIDER_SECRET: 'must-not-cross' } })
  assert.equal(result.status, 0)
  assert.equal(await readFile(marker, 'utf8'), 'local|bounded-token|absent')
})
