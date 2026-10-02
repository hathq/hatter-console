// Hatter 2026: owner startup observations are part of current runtime status.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { ManagementConnection } from '../server/lib/management-connection.mjs'
import { JsonlChannel } from '../server/lib/jsonl-channel.mjs'
import { HatterRuntime } from '../server/runtime/hatter-runtime.mjs'

test('concurrent System observers share only the in-flight read and leave bounded capacity for an operation', async t=>{
  const runtime=new HatterRuntime({environment:{}}),input=new PassThrough(),output=new PassThrough(),sent=[]
  const channel=new JsonlChannel(output,input)
  input.on('data',bytes=>sent.push(JSON.parse(bytes)))
  runtime.management.start=async()=>channel
  t.after(async()=>{channel.fail('done');await runtime.close()})
  // Two admitted projection reads, one System observation, one operation fit
  // the original four-frame reservation. More observers must not multiply RPCs.
  const sources=[runtime.rpc('source/execute',{operation:'targets'}),runtime.rpc('source/execute',{operation:'operations'})]
  const observers=Array.from({length:8},()=>runtime.overview())
  const operation=runtime.rpc('storage/execute',{operation:'initialize',owner:'sem-lang'})
  const all=Promise.allSettled([...sources,...observers,operation])
  await new Promise(resolve=>setImmediate(resolve))
  try{
    assert.deepEqual(sent.map(x=>x.method),['source/execute','source/execute','hatter/status/read','storage/execute'])
    assert.equal(channel.requests.usage.messages,4)
    for(const request of sent)output.write(JSON.stringify({id:request.id,result:request.method==='hatter/status/read'?status('current',false):{original:request.id}})+'\n')
    const results=await all
    assert.ok(results.every(x=>x.status==='fulfilled'))
    assert.equal(new Set(results.slice(2,10).map(x=>JSON.stringify(x.value))).size,1)
    assert.deepEqual(results.at(-1).value,{original:4})
    assert.equal(channel.requests.usage.messages,0)
    const fresh=runtime.overview();await new Promise(resolve=>setImmediate(resolve))
    assert.equal(sent.length,5,'completed observations are not cached')
    output.write(JSON.stringify({id:5,result:status('fresh',false)})+'\n');await fresh
    const failed=runtime.overview(),joined=runtime.overview()
    const failures=Promise.allSettled([failed,joined]);await new Promise(resolve=>setImmediate(resolve))
    assert.equal(sent.length,6);output.emit('end')
    assert.ok((await failures).every(x=>x.status==='rejected'))
    assert.equal(runtime.statusRead,null,'failure releases the shared observation')
  }finally{channel.fail('done');await all}
})

test('coalesces projection startup and waits for it before closing owned resources', async t => {
  const setup = await fixtureEnvironment(t)
  const runtime = new HatterRuntime({ environment: setup.environment })
  const events = []
  let release
  runtime.projections = {
    startup: async () => { events.push('start'); await new Promise(resolve => { release = resolve }); events.push('ready'); return 'ready' },
    maintain: async () => { events.push('maintain'); return [] },
    targets: async () => { events.push('targets'); return {head:{commit:null},targets:[]} },
    close: async () => { events.push('close') }
  }
  const first = runtime.startProjections(), second = runtime.startProjections()
  const closing = runtime.close()
  assert.deepEqual(events, ['start'])
  release()
  assert.deepEqual(await Promise.all([first, second]), ['ready', 'ready'])
  await closing
  assert.deepEqual(events, ['start', 'ready', 'maintain', 'targets', 'close'])
  assert.deepEqual(runtime.publication.inspect().streams, [])
  await assert.rejects(runtime.publication.reconcile(), {code:'ProjectionRuntimeClosed'})
  assert.equal(runtime.projectionStartup, null)
})

test('runtime disposal fences new intake and releases management before waiting on dependent startup', {timeout:5000},async()=>{
  const runtime=new HatterRuntime({environment:{}}),events=[]
  let release
  runtime.projectionStartup=new Promise(resolve=>{release=resolve})
  runtime.management={
    start:async()=>{events.push('unexpected-start');throw Error('closed owner restarted')},
    close:async()=>{events.push('management-close');release()}
  }
  runtime.publication={close:async()=>events.push('publication-close')}
  runtime.projections={close:async()=>events.push('projection-close')}
  const close=runtime.close(),again=runtime.close()
  // Always release in teardown so a fail-first test cannot strand its fixture.
  try{
    await assert.rejects(runtime.rpc('model/list'),{code:'ProjectionRuntimeClosed'})
    await assert.rejects(runtime.startProjections(),{code:'ProjectionRuntimeClosed'})
    assert.equal(close,again)
    await close
    assert.deepEqual(events,['management-close','publication-close','projection-close'])
  }finally{release();await Promise.allSettled([close,again])}
})

test('allows one bounded inference request to outlive the short control-plane timeout', async () => {
  const child = new EventTarget()
  child.stdout = new PassThrough()
  child.stdin = new PassThrough()
  child.once = (name, listener) => child.addEventListener(name, listener, { once: true })
  child.stdin.on('data', chunk => {
    const request = JSON.parse(String(chunk))
    setTimeout(() => child.stdout.write(`${JSON.stringify({
      id: request.id, result: { completed: true }
    })}\n`), 20)
  })
  const channel = new JsonlChannel(child.stdout, child.stdin, { timeoutMs: 5 })
  assert.deepEqual(await channel.request('inference/status/read', {}, 50),
    { completed: true })
  await assert.rejects(channel.request('hatter/status/read', {}, 120_001),
    /hatter-app-server-timeout-invalid/u)
})

test('transport failures reach the runtime diagnostics as typed owner data without semantic reclassification', async t => {
  const setup = await fixtureEnvironment(t)
  const runtime = new HatterRuntime({ environment: setup.environment })
  t.after(() => runtime.close())
  const child = new EventTarget()
  child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stdin.resume()
  child.once = (name, listener) => child.addEventListener(name, listener, { once: true })
  const channel = new JsonlChannel(child.stdout, child.stdin)
  t.after(() => channel.fail('done'))
  runtime.management.start = async () => channel
  await assert.rejects(runtime.rpc('inference/role/list', {}, 5), error => {
    assert.equal(error.message, 'hatter-console-management-transport-failed')
    assert.deepEqual(error.failure.parameters, { transport: 'Timeout', component: 'crowsi' })
    assert.equal(error.failure.class, 'timeout'); return true
  })
  const diagnostic = runtime.diagnostics().diagnostics[0]
  assert.equal(diagnostic.code, 'hatter-console-management-transport-failed')
  assert.deepEqual(diagnostic.parameters, { transport: 'Timeout', component: 'crowsi' })
})

test('keeps unavailable diagnostics distinct from an empty successful observation', async t => {
  const setup = await fixtureEnvironment(t)
  const runtime = new HatterRuntime({ environment: setup.environment })
  t.after(() => runtime.close())
  runtime.rpc = async () => { throw new Error('hatter-console-runtime-unavailable') }
  await assert.rejects(runtime.codexTrace(), /hatter-console-runtime-unavailable/u)
})

test('login and status share the same exact borrowed Management connection', async t => {
  const setup = await fixtureEnvironment(t)
  const supervisor = new ManagementConnection({ environment: setup.environment })
  t.after(() => supervisor.close())
  const login = await supervisor.request('account/login/start', { type: 'chatgpt' })
  const status = await supervisor.request('hatter/status/read')
  assert.equal(login.processMarker, status.processMarker)
  await supervisor.close()
  assert.equal(setup.server.listening,true,'observer closure does not stop the Management owner')
})

test('status, model, and HAT projection journal complete through the typed runtime', async t => {
  const setup = await fixtureEnvironment(t)
  const runtime = new HatterRuntime({ environment: setup.environment })
  t.after(() => runtime.close())
  assert.equal((await runtime.beginLogin('browser')).flow, 'browser')
  assert.equal((await runtime.overview()).runtime.version, '0.10.0')
  const status = await runtime.overview()
  assert.ok(status.owners.length > 0)
  assert.equal(typeof runtime.runtimeTopology, 'undefined', 'no second synthetic topology authority')
  assert.equal((await runtime.models({ providerId: 'openai' })).models.length, 1)
  const inference = await runtime.inferenceEngineStatus()
  assert.equal(inference.configurationState, 'ready')
  assert.equal(inference.activityState, 'idle')
  assert.equal(inference.execution.hatRequired, false)
  assert.equal(inference.execution.reachability, 'not-tested')
  const journal = await runtime.hatProjectionJournal({ contextPartitionId: 'contextPartition-1',
    packageId: 'hat/example', fromRevision: 0, limit: 32 })
  assert.equal(journal.projectionJournal.toRevision, 1)
})

test('retains one browser ceremony across account reads and clears it explicitly', async t => {
  const setup = await fixtureEnvironment(t, { authenticateOnLogin: false })
  const runtime = new HatterRuntime({ environment: setup.environment })
  t.after(() => runtime.close())
  const login = await runtime.beginLogin('browser')
  assert.deepEqual((await runtime.account()).login, login)
  assert.deepEqual(await runtime.beginLogin('browser'), login)
  await assert.rejects(runtime.beginLogin('device'), /login-in-progress/)
  await runtime.cancelLogin(login.handle)
  assert.equal((await runtime.account()).login, null)
})

test('clears a pending browser ceremony on completion notification', async t => {
  const setup = await fixtureEnvironment(t, { authenticateOnLogin: false })
  const runtime = new HatterRuntime({ environment: setup.environment })
  t.after(() => runtime.close())
  await runtime.beginLogin('browser')
  runtime.notification({ method: 'account/login/completed' })
  assert.equal((await runtime.account()).login, null)
})

test('does not report a rejected HAT operation as a stopped runtime', async t => {
  const setup = await fixtureEnvironment(t)
  const runtime = new HatterRuntime({ environment: setup.environment })
  t.after(() => runtime.close())
  await assert.rejects(runtime.hatPackage({ repositoryId: 'not-installed' }),
    /hatter-console-operation-rejected/u)
  assert.equal(runtime.management.running, true)
  assert.equal((await runtime.overview()).runtime.version, '0.10.0')
  assert.equal(runtime.diagnostics().diagnostics[0].code,
    'hatter-app-server-request-rejected')
})

test('preserves an allow-listed HAT rejection reason without provider detail', async t => {
  const setup = await fixtureEnvironment(t)
  const runtime = new HatterRuntime({ environment: setup.environment })
  t.after(() => runtime.close())
  await assert.rejects(runtime.installOfficialHat({ repositoryId: 'hat-unavailable' }),
    /hatter-console-hat-catalog-unavailable/u)
  assert.equal(runtime.management.running, true)
  assert.equal(runtime.diagnostics().diagnostics[0].code,
    'hatter-console-hat-catalog-unavailable')
  assert.equal(runtime.diagnostics().diagnostics[0].reasonId,
    'hathq://vocabulary/reason/dependency-unavailable/v1')
  assert.equal(runtime.diagnostics().diagnostics[0].responsibility, 'external-service')
})

test('keeps catalog and package verification failures distinct', async t => {
  const setup = await fixtureEnvironment(t)
  const runtime = new HatterRuntime({ environment: setup.environment })
  t.after(() => runtime.close())
  await assert.rejects(runtime.installOfficialHat({ repositoryId: 'hat-bad-catalog' }),
    /hatter-console-hat-catalog-verification-failed/u)
  await assert.rejects(runtime.installOfficialHat({ repositoryId: 'hat-bad-package' }),
    /hatter-console-hat-package-verification-failed/u)
  assert.equal(runtime.management.running, true)
})

async function fixtureEnvironment(t, { authenticateOnLogin = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hatter-console-runtime-'))
  const path=join(root,'management.sock'),marker=randomUUID()
  const reference={owner_ref:'hatter/management',incarnation:Array(32).fill(1),protocol_generation:Array(32).fill(2),executable_identity:Array(32).fill(3)}
  let authenticated=false
  const sockets=new Set()
  const server=createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket))
    let buffer='',hello=false
    socket.on('data',chunk=>{
      buffer+=chunk;assert.ok(buffer.length<=65536)
      while(buffer.includes('\n')){
        const boundary=buffer.indexOf('\n'),value=JSON.parse(buffer.slice(0,boundary));buffer=buffer.slice(boundary+1)
        if(!hello){
          assert.deepEqual(value,{expected:reference,owner_type:'Management'});hello=true
          socket.write(JSON.stringify({process:reference,owner_type:'Management',availability:{process_alive:true,transport_available:true,owner_ready:'Ready',domain_dispatch_available:true}})+'\n')
        }else receive(value,socket)
      }
    })
  })
  server.listen(path);await once(server,'listening')
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})})
  return {root,server,environment:{HOME:root,HATTER_HOME:root,HATTER_CONSOLE_NODE_EXECUTABLE:process.execPath,
    HATTER_MANAGEMENT_ENDPOINT:JSON.stringify({path,process:reference})}}
function receive(value, socket) {
  if (!('id' in value)) return
  if (value.method === 'initialize'
    && value.params.clientInfo.name !== 'hatter_management_console') assert.fail('invalid initialize client')
  if (value.method === 'hat/package/read'
    && value.params.repositoryId === 'not-installed') {
    socket.write(JSON.stringify({ id: value.id,
      error: { code: -32000, message: 'private fixture detail' } }) + '\n')
    return
  }
  if (value.method === 'hat/catalog/install') {
    const reason = value.params.repositoryId === 'hat-bad-catalog'
      ? 'hat-catalog-verification-failed'
      : value.params.repositoryId === 'hat-bad-package'
        ? 'hat-package-verification-failed'
        : 'hat-catalog-unavailable'
    socket.write(JSON.stringify({ id: value.id,
      error: failure(reason, 'hat/catalog/install') }) + '\n')
    return
  }
  let result = {}
  if (value.method === 'account/read') result = authenticated
    ? { account: { type: 'chatgpt', planType: 'plus' },
      provider: { id: 'openai', name: 'OpenAI', requiresAccount: true } }
    : { account: null, provider: { id: 'openai', name: 'OpenAI', requiresAccount: true } }
  if (value.method === 'account/login/start') {
    if (authenticateOnLogin) authenticated = true
    result = value.params.type === 'chatgptDeviceCode'
      ? { type: 'chatgptDeviceCode', loginId: 'device-login',
        verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-EFGH' }
      : { type: 'chatgpt', loginId: 'login',
        authUrl: 'https://auth.openai.com/', processMarker: marker }
  }
  if (value.method === 'hatter/status/read') result = status(marker, authenticated)
  if (value.method === 'inference/status/read') result = {
    schema: 'hathq://hatter/inference-engine-status/v1', observedAtUnixMs: 2,
    configurationState: authenticated ? 'ready' : 'authentication-required',
    activityState: 'idle', execution: { kind: 'external-provider',
      activation: 'on-demand', hatRequired: false, reachability: 'not-tested' },
    provider: { id: 'openai', name: 'OpenAI', requiresAccount: true },
    authentication: { state: authenticated ? 'authenticated' : 'required',
      mode: authenticated ? 'chatgpt' : null },
    modelCatalog: { catalog: { source: 'configured', freshness: 'unknown', refresh: 'notAttempted', failure: null, refreshedAtMs: null, observedAtMs: null, sourceRevision: null }, count: 1, defaultModel: 'gpt-test', defaultReasoning: 'low',
      defaultServiceTier: 'default' }, observability: { recording: true, traceCount: 0,
      activeInferenceCount: 0, measuredInferenceCount: 0, lastActivityAtUnixMs: null,
      containsRawContent: false }, containsSecretValues: false }
  if (value.method === 'model/list') result = { authentication: {
    request: { primary: null, fallback: null }, resolvedMode: null,
    state: 'notResolved', fallback: 'notAttempted', providerConfigRef: 'a'.repeat(64),
    accountRef: null, sessionRef: null, authGeneration: 0, credentialSource: 'none',
    primaryFailure: null, fallbackFailure: null }, provider: { id: 'openai', name: 'OpenAI',
    requiresAccount: true }, catalog: { source: 'configured', freshness: 'unknown', refresh: 'notAttempted', failure: null, refreshedAtMs: null, observedAtMs: null, sourceRevision: null }, nextCursor: null, data: [{ id: 'gpt-test',
    displayName: 'GPT Test', isDefault: true, supportedReasoningEfforts: [],
    serviceTiers: [], defaultReasoningEffort: null, defaultServiceTier: null }] }
  if (value.method === 'model/provider/list') result = { providers: [{ id: 'openai',
    name: 'OpenAI', requiresAccount: true, active: true }] }
  if (value.method === 'hat/projection-journal/read') result = { projectionJournalJson: JSON.stringify({
    schema: 'hathq://hat/projection-journal/v1', context_partition_id: 'contextPartition-1',
    package_id: 'hat/example', from_revision: 0, to_revision: 1, events: [{
      schema: 'hathq://hat/projection-event/v1', event_id: 'event-1',
      event_type: 'core.event.action.completed',
      occurred_time: { start_epoch_ms: 1_700_000_000_001, end_epoch_ms: null },
      observed_at_epoch_ms: 1_700_000_000_001,
      correlation_id: 'invoke-1', causation_id: null, invocation_id: 'invoke-1',
      context_partition_id: 'contextPartition-1', operation_id: 'hathq://vocabulary/action/example/v1',
      previous_revision: 0, next_revision: 1, evidence_refs: [] }] }) }
  socket.write(JSON.stringify({ id: value.id, result }) + '\n')
}
function failure(code, operation) {
  const verification = code.endsWith('-verification-failed')
  return { code: -32000, message: code, data: {
    schema: 'hathq://hatter/management-failure/v1', code,
    reasonId: verification
      ? 'hathq://vocabulary/reason/verification-failed/v1'
      : 'hathq://vocabulary/reason/dependency-unavailable/v1',
    class: verification ? 'precondition' : 'dependency',
    recovery: verification ? 'owner-action' : 'external-change',
    responsibility: verification ? 'owner' : 'external-service', operation,
    parameters: {}, nextActionId: verification
      ? 'hathq://vocabulary/action/review-configuration/v1' : null } }
}
}
function status(marker, authenticated) { return {
  schemaId: 'hathq://hatter/runtime-status/v1', observedAtUnixMs: 1, version: '0.10.0',
  platformFamily: 'unix', platformOs: 'linux', processMarker: marker,
  semanticContract: { status: 'semantic-foundation-integrated-runtime-assembly-pending',
    digest: 'sha256:' + '1'.repeat(64) },
  installedHatCount: 0,
  owners: ['hatter/control', 'hatter/admission', 'sem-lang'].map(owner => ({owner, failure:null,
    observation:{owner_type:owner==='sem-lang'?'Semantic':'Graph',
      process:{owner_ref:owner,incarnation:Array(32).fill(1),protocol_generation:Array(32).fill(2),executable_identity:Array(32).fill(3)},
      availability:{process_alive:true,transport_available:true,owner_ready:'Ready',domain_dispatch_available:true}}})),
  hatBinding: { status: 'available', reason: null, failure: null,
    contextPartitionId: null, activeActionCount: 0 },
  account: { authMode: authenticated ? 'chatgpt' : null },
  modelCatalog: { catalog: { source: 'configured', freshness: 'unknown', refresh: 'notAttempted', failure: null, refreshedAtMs: null, observedAtMs: null, sourceRevision: null }, count: 1, defaultModel: 'gpt-test', defaultReasoning: 'low',
    defaultServiceTier: 'default' }, threads: { loadedCount: 0, runningCount: 0,
    statusCounts: { waitingOnApproval: 0, waitingOnUserInput: 0 } },
  rateLimits: { status: 'unavailable', reason: 'rate-limit-unavailable' },
  containsSecretValues: false } }
