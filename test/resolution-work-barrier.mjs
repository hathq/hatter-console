// Hatter 0.10.0: exact Resolution Work read during durable semantic preparation.
// External test-only fsync barrier; no production fault mode or surrogate result.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {performance} from 'node:perf_hooks'
import {spawnParentBound} from '@crowsi/transport-foundation/process'
import {JsonlChannel} from '../server/lib/jsonl-channel.mjs'
import {stopProcessGroup} from './owner-process-fixture.mjs'

const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
assert.ok(['read','cancel','kill'].includes(input.mode))
const directory=fs.realpathSync(path.join(input.home,'sem-lang/repository/.sem-lang/snapshots'))
const child=spawnParentBound(input.binary,['app-server','--stdio'],{cwd:input.home,
  env:{...process.env,HATTER_HOME:input.home,LD_PRELOAD:input.library,
    HATTER_GRAPH_BARRIER_BINARY:fs.realpathSync(input.binary),HATTER_GRAPH_BARRIER_DIRECTORY:directory},
  stdio:['pipe','pipe','pipe','pipe','pipe']})
let stderr='',released=false,timer
child.stderr.on('data',b=>{stderr+=b;if(stderr.length>65536)child.kill('SIGKILL')})
const channel=new JsonlChannel(child.stdout,child.stdin,{timeoutMs:5000,maxLineBytes:524288,maxPendingMessages:2})
const report={before:input.before,request:input.request,stages:[]}
// Preserve the original bounded management error even if delivery projection
// has no mapping for it. This is test evidence, never a second product channel.
let raw=''
child.stdout.on('data',bytes=>{
  raw+=bytes
  if(raw.length>1048576){child.kill('SIGKILL');return}
})
const start=performance.now(),record=stage=>report.stages.push({stage,elapsedMs:performance.now()-start})
const release=()=>{if(!released){released=true;child.stdio[4].write('R');record('barrier-released')}}
try{
  const reached=new Promise((resolve,reject)=>{
    let text=''
    timer=setTimeout(()=>reject(Error('preparation barrier not reached')),5000)
    child.stdio[3].on('data',b=>{
      text+=b;if(text.length>4096){clearTimeout(timer);reject(Error('barrier overflow'));return}
      if(text.includes('\n')){clearTimeout(timer);resolve(text.trim())}
    })
    child.once('close',()=>{clearTimeout(timer);reject(Error('owner exited before preparation'))})
  })
  report.accepted=await channel.request('interaction/execute',input.request)
  record('work-accepted')
  assert.equal(report.accepted.state,'Accepted')
  const checkpoint=await reached
  record('durable-preparation-paused')
  assert.equal(path.dirname(checkpoint),directory)
  report.preparedRevision=JSON.parse(fs.readFileSync(checkpoint)).revision
  // Keep the owner alive. The request must describe the original Running Work,
  // not wait for this test to release the semantic writer and then show Completed.
  try{
    report.during=await channel.request('interaction/execute',{operation:'inspect',workRef:report.accepted.requestRef})
  }catch(error){report.duringFailure={failure:error.failure??null,rpc:error.rpc??null,message:error.message}}
  record('running-inspection-settled')
  try{report.directRead=await channel.request('source/execute',{operation:'targets',maximumItems:32})}
  catch(error){report.directReadFailure={failure:error.failure??null,rpc:error.rpc??null,message:error.message}}
  record('independent-graph-read-settled')
  if(input.mode==='cancel'){
    report.cancellation=await channel.request('interaction/execute',{operation:'cancel',workRef:report.accepted.requestRef})
    assert.equal(report.cancellation.work.state.Running.cancel_requested,true)
    record('cancellation-recorded-before-publication')
  }
  if(input.mode==='kill'){child.kill('SIGKILL');record('owned-writer-killed')}
  else{release();child.stdin.end()}
  await stopProcessGroup(child,5000,false)
  if(input.mode==='kill')assert.equal(child.signalCode,'SIGKILL')
  else assert.equal(child.exitCode,0,'graceful owner drain')
  assert.equal(stderr,'')
  report.expected='exact original Running Work before barrier release'
  assert.ok(report.during?.work?.state?.Running,JSON.stringify(report.duringFailure??report.during))
  assert.equal(report.during.work.spec.requestRef,report.accepted.requestRef)
  report.status='PASS'
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1}
finally{
  clearTimeout(timer)
  if(child.exitCode===null&&child.signalCode===null){release();child.stdin.end()}
  await stopProcessGroup(child,5000,false)
  channel.fail('test-owner-closed')
  report.exitCode=child.exitCode;report.signal=child.signalCode;report.stderr=stderr
  report.management=raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
  fs.writeFileSync(input.evidence,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
}
