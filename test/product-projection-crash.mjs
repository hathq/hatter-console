// Risk-selected actual-product crash/recovery acceptance. All children are owned
// by this test; all source requests use installed production adapters.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {stopProcess} from '@crowsi/transport-foundation/process'
import {ProductProjections} from '../server/runtime/product-projections.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
import {stateJourney} from './product-projection-state.mjs'
const input=JSON.parse(fs.readFileSync(0,'utf8'))
const environment={...process.env,HATTER_HOME:input.home,HATTER_CONSOLE_HANDOFF_VERSION:'1',
  HATTER_CONSOLE_HANDOFF_ACTIVE:'1',HATTER_CLI_EXECUTABLE:input.binary,HATTER_LAUNCH_CWD:input.home,
  HATTER_CLI_EXECUTABLE_SHA256:'sha256:'+createHash('sha256').update(fs.readFileSync(input.binary)).digest('hex')}
const product=new ProductProjections(environment),owner=new SourceOwnerClient(environment)
const key='crash-acceptance'
async function worker(phase,sources){
  const child=spawn(process.execPath,[new URL('./product-projection-crash-worker.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']})
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b)
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))})
  const timeout=setTimeout(()=>void stopProcess(child,{timeoutMs:100}),10000)
  try{
    child.stdin.end(JSON.stringify({phase,sources,environment,id:input.phase,key}))
    const status=await closed
    if(phase==='during-publication')assert.equal(status.signal,'SIGKILL',stderr)
    else assert.equal(status.code,77,stderr)
    assert.equal(stderr,'')
    return JSON.parse(stdout)
  }finally{clearTimeout(timeout);await stopProcess(child,{timeoutMs:100})}
}
try{
  await product.startup()
  const sources=await Promise.all(['sem-lang','hatter/control'].map(o=>product.describe(o,input.receipt.commit_ref)))
  let prior=[]
  if(input.phase==='repair-takeover')prior=(await worker('before-publication',sources)).acquired
  const failed=await worker(input.phase,sources)
  assert.ok(failed.acquired.length>0)
  if(input.phase==='repair-takeover')assert.notEqual(prior[0].holder,failed.acquired[0].holder)
  // Real explicit startup/maintenance takes over the actual durable repair.
  await product.startup()
  const current=product.read(key)
  assert.ok(current,JSON.stringify(product.inspect()))
  assert.equal(product.inspect().store.repairs.some(r=>r.id===input.phase),false)
  assert.deepEqual(current.lineage.sources.toSorted((a,b)=>a.owner.localeCompare(b.owner)),sources.toSorted((a,b)=>a.owner.localeCompare(b.owner)))
  if(['after-publication','during-cleanup'].includes(input.phase)){
    // Publication already removed its repair intent; owner expiry is independent
    // of PP survival. No test writes owner lease metadata or advances its clock.
    await new Promise(r=>setTimeout(r,Math.max(0,Math.max(...failed.acquired.map(a=>a.acquiredAt))+3020-Date.now())))
    await owner.call({operation:'reconcile'})
  }
  for(const {source,holder,generation} of [...prior,...failed.acquired])await assert.rejects(
    owner.call({operation:'read',source,holder,generation}),error=>{
      const p=error.failure?.parameters
      assert.ok(p,`missing typed owner failure: ${error}`)
      assert.ok(p.sourceRetention==='"Unavailable"'||p.controlSource==='LeaseUnavailable'||p.source==='LeaseUnavailable',JSON.stringify(p))
      return true
    })
  assert.deepEqual(product.read(key),current)
  const state=input.phase==='repair-takeover'?await stateJourney(product,key,current):null
  process.stdout.write(JSON.stringify({status:'PASS',phase:input.phase,sources,revision:current.revision,holders:[...prior,...failed.acquired].map(a=>a.holder),state})+'\n')
}finally{await product.close();await owner.close()}
