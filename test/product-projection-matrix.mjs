// Each scenario combines identity, data, lease and process lifecycle assertions.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {stopProcess} from '@crowsi/transport-foundation/process'
import {ProductProjections} from '../server/runtime/product-projections.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
import {stateJourney} from './product-projection-state.mjs'
const input=JSON.parse(fs.readFileSync(0,'utf8'))
const environment={...process.env,HATTER_HOME:input.home,HATTER_CONSOLE_HANDOFF_VERSION:'1',
  HATTER_CONSOLE_HANDOFF_ACTIVE:'1',HATTER_CLI_EXECUTABLE:input.binary,HATTER_LAUNCH_CWD:input.home,
  HATTER_CLI_EXECUTABLE_SHA256:'sha256:'+createHash('sha256').update(fs.readFileSync(input.binary)).digest('hex')}
const product=new ProductProjections(environment),owner=new SourceOwnerClient(environment),children=[],results=[]
const key='matrix-acceptance'
function start(options){
  const child=spawn(process.execPath,[new URL('./product-projection-matrix-worker.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe','ipc']})
  children.push(child);let out='',err=''
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b)
  const ready=new Promise(resolve=>child.once('message',resolve))
  const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{
    try{assert.equal(code,0,err);assert.equal(err,'');const report=JSON.parse(out);results.push(report);resolve(report)}catch(e){reject(e)}
  })});finished.catch(()=>{})
  const timer=setTimeout(()=>void stopProcess(child,{timeoutMs:100}),10000)
  finished.finally(()=>clearTimeout(timer)).catch(()=>{})
  child.stdin.end(JSON.stringify({environment,key,...options}))
  return {child,ready,finished,resume:()=>child.send('continue')}
}
async function released(leases){
  for(const {source,holder,generation} of leases)await assert.rejects(owner.call({operation:'read',source,holder,generation}),error=>{
    const p=error.failure?.parameters
    assert.ok(p?.sourceRetention==='"Unavailable"'||p?.controlSource==='LeaseUnavailable',JSON.stringify(p));return true
  })
}
try{
  await product.startup()
  const sources=await Promise.all(['sem-lang','hatter/control'].map(o=>product.describe(o,input.receipt.commit_ref)))
  if(input.scenario==='fence-cas'){
    const a=start({sources,id:'fence-a',mode:'pause'});await a.ready
    const competing=await start({sources,id:'fence-a'}).finished
    assert.equal(competing.result.error,'ProjectionStoreBusy');assert.equal(competing.leases.length,0)
    a.resume();const one=await a.finished;assert.ok(one.result.snapshot)
    const stale=start({sources,id:'cas-old',mode:'pause',focus:'older'});await stale.ready
    const newer=await start({sources,id:'cas-new',focus:'newer'}).finished;assert.ok(newer.result.snapshot)
    stale.resume();assert.equal((await stale.finished).result.error,'StaleProjectionPublication')
    assert.deepEqual(product.read(key),newer.result.snapshot)
    for(const result of results)await released(result.leases)
  }else if(input.scenario==='repair'){
    const failed=await start({sources,id:'repair-old',mode:'fail',focus:'older'}).finished
    assert.equal(failed.result.error,'ProjectionUnavailable');assert.equal(product.inspect().store.repairs[0].attempts,1)
    const newer=await start({sources,id:'repair-new',focus:'newer'}).finished;assert.ok(newer.result.snapshot)
    const repaired=await start({sources,id:'repair-old',retry:true}).finished
    assert.equal(repaired.result.error,'StaleProjectionPublication');assert.deepEqual(product.read(key),newer.result.snapshot)
    for(let attempt=1;attempt<=3;attempt++){
      const r=await start({sources,id:'exhaust',mode:'fail',retry:attempt>1}).finished
      assert.equal(r.result.error,'ProjectionUnavailable')
      const pending=product.inspect().store.repairs.find(r=>r.id==='exhaust')
      if(attempt<3)assert.equal(pending.attempts,attempt);else assert.equal(pending,undefined)
    }
    assert.deepEqual(product.read(key),newer.result.snapshot)
    for(const result of results)await released(result.leases)
  }else if(input.scenario==='contention'){
    const timed=start({sources,id:'timeout-owner',mode:'timeout'});await timed.ready
    // The concurrent workload validates the installed artifact and runs a real
    // second publication; deadline remains 5 s, including the actual source IO.
    const archive=spawn(process.execPath,['--input-type=module','-e',"import {ProducerRegistry} from '@hathq/projection-runtime';for(let n=0;n<64;n++){new ProducerRegistry().register({id:'check',kind:'data'})}"],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe']})
    children.push(archive);let diagnostics='';archive.stderr.on('data',b=>diagnostics+=b)
    const archiveDone=new Promise(resolve=>archive.once('close',resolve))
    const normal=await start({sources,id:'concurrent-normal',focus:'concurrent'}).finished
    assert.ok(normal.result.snapshot);assert.equal(await archiveDone,0,diagnostics);assert.equal(diagnostics,'')
    const timeout=await timed.finished;assert.equal(timeout.result.error,'ProjectionExecutionTimeout')
    assert.ok(timeout.elapsedMs>=5000&&timeout.elapsedMs<9000,JSON.stringify(timeout))
    assert.equal(product.inspect().store.repairs.length,0)
    assert.deepEqual(product.read(key),normal.result.snapshot)
    await released(timeout.leases);await released(normal.leases)
    // No post-cancellation writer may recreate a hold after cleanup.
    await new Promise(r=>setTimeout(r,100));await released(timeout.leases)
  }else if(input.scenario==='reclaimed'){
    const failed=await start({sources,id:'reclaimed',mode:'expire'}).finished
    assert.equal(failed.result.error,'ProjectionUnavailable')
    await new Promise(r=>setTimeout(r,Math.max(0,Math.max(...failed.leases.map(l=>l.acquiredAt))+2550-Date.now())))
    await owner.call({operation:'reconcile'})
    const semantic=sources.find(s=>s.owner==='sem-lang')
    assert.equal((await owner.call({operation:'retire',source:semantic})).retired,true)
    await owner.call({operation:'reclaim'})
    const raw=spawnSync(input.binary,['source','--request-json',JSON.stringify({operation:'acquire',source:semantic,holder:'missing-probe',durationMs:1000})],{env:environment,encoding:'utf8',timeout:5000})
    assert.notEqual(raw.status,0)
    const cliFailure=JSON.parse(raw.stderr.slice(raw.stderr.indexOf('{')).trim())
    delete cliFailure.schema
    await assert.rejects(owner.call({operation:'acquire',source:semantic,holder:'missing-probe',durationMs:1000}),error=>{
      assert.deepEqual(error.failure,cliFailure)
      results.push({ownerFailure:cliFailure,cliRpcServerEqual:true})
      return true
    })
    const current=product.read(key)
    const retry=await start({sources,id:'reclaimed',retry:true}).finished
    assert.equal(retry.result.error,'SourceNotRetained',JSON.stringify({retry,raw:raw.stderr}));assert.equal(product.inspect().store.repairs.length,0)
    assert.deepEqual(product.read(key),current)
    await released(failed.leases)
  }else if(input.scenario==='state'){
    const result=await product.submit('subject',{sources,key,focus:'state',id:'state-current'})
    const state=await stateJourney(product,key,result.snapshot)
    results.push(state)
  }else assert.fail('unknown scenario')
  assert.equal(product.inspect().active,0);assert.equal(product.inspect().queued,0)
  process.stdout.write(JSON.stringify({status:'PASS',scenario:input.scenario,sources,results})+'\n')
}finally{for(const child of children)await stopProcess(child,{timeoutMs:100});await product.close();await owner.close()}
