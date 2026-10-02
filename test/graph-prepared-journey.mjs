// Hatter 2026: real installed source binding and Structural Apply, blocked at
// successful sem-lang checkpoint fsync inside Graph's canonical transaction.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {spawnParentBound} from '@crowsi/transport-foundation/process'
import {JsonlChannel} from '../server/lib/jsonl-channel.mjs'
import {stopProcessGroup} from './owner-process-fixture.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'

export async function preparedJourney(input,environment,mode){
 assert.ok(['prepared-eof','prepared-term','prepared-kill'].includes(mode))
 const observations=[],forced=mode!=='prepared-eof',owner=new SourceOwnerClient(environment,{onObservation:value=>observations.push(value)}),rows=[]
 let phase='initial-targets'
 let child,channel,stderr='',barrier=null,result=null,uncertain=null
 const graph=path.join(input.home,'digital-twin/v1.redb')
 try{
  assert.equal(path.dirname(fs.realpathSync(input.home)),fs.realpathSync(os.tmpdir()))
  const initial=await owner.call({operation:'targets',maximumItems:32})
  phase='initial-description'
  const description=await owner.call({operation:'sourceDescribe',roleRef:input.roleRef},{method:'interaction/execute'})
  const request={operation:'sourceSubmit',providerId:description.interactionRef,generation:description.generation,
   inputContractRef:description.inputContractRef,values:{editable:input.value}}
  const directory=fs.realpathSync(path.join(input.home,'sem-lang/repository/.sem-lang/snapshots'))
  const library=fs.realpathSync(process.env.HATTER_GRAPH_BARRIER_LIBRARY)
  assert.equal(library,path.join(input.evidence,'graph-prepare-barrier.so'))
  child=spawnParentBound(input.binary,['app-server','--stdio'],{cwd:input.home,
   env:{...environment,LD_PRELOAD:library,HATTER_GRAPH_BARRIER_BINARY:fs.realpathSync(input.binary),HATTER_GRAPH_BARRIER_DIRECTORY:directory},
   stdio:['pipe','pipe','pipe','pipe','pipe']})
  child.stderr.on('data',b=>{stderr+=b;if(stderr.length>65536)child.kill('SIGKILL')})
  const signals=[],kill=child.kill.bind(child);child.kill=signal=>{signals.push(signal);return kill(signal)}
  channel=new JsonlChannel(child.stdout,child.stdin,{timeoutMs:5000,maxLineBytes:524288,maxPendingMessages:2})
  await channel.request('initialize',{clientInfo:{name:'hatter_management_console',title:'Hatter Console',version:'0.10.0'},capabilities:{experimentalApi:false}})
  const reached=new Promise((resolve,reject)=>{
   let text='';const timer=setTimeout(()=>reject(Error('canonical preparation barrier not reached')),5000)
   child.stdio[3].on('data',b=>{
    text+=b
    if(text.length>4096){clearTimeout(timer);reject(Error('barrier capacity exceeded'));return}
    if(text.includes('\n')){clearTimeout(timer);resolve(text.trim())}
   })
   child.once('close',()=>{clearTimeout(timer);reject(Error('owner exited before preparation'))})
  })
  let acknowledged=false
  const response=channel.request('interaction/execute',request).then(value=>{acknowledged=true;return value},error=>{
   uncertain={phase:error.rpc?.phase,requestRef:error.rpc?.requestRef};return null
  })
  const file=await reached
  assert.equal(path.dirname(file),directory)
  assert.match(path.basename(file),/^runtime-[a-f0-9]{64}\.tmp-\d+\.json$/)
  const prepared=JSON.parse(fs.readFileSync(file))
  assert.match(prepared.revision,/^runtime-[a-f0-9]{64}$/)
  assert.equal(acknowledged,false)
  const bytes=fs.readFileSync(graph)
  barrier={file:path.basename(file),preparedIdentity:prepared.revision,
   checkpointDigest:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
   graphDigest:createHash('sha256').update(bytes).digest('hex'),
   interaction:request,roleRef:input.roleRef,subjectRef:initial.targets.find(t=>t.kind==='subject'&&t.roleRef.id===input.roleRef.id).subjectRef,
   graphAcknowledged:false,checkpoint:prepared}
  // End the real management input first. No sleep determines the barrier.
  child.stdin.end();await new Promise(resolve=>child.stdin.writableFinished?resolve():child.stdin.once('finish',resolve))
  assert.equal(child.stdin.writableFinished,true)
  if(!forced)child.stdio[4].write('R')
  if(mode==='prepared-kill')kill('SIGSTOP')
  await stopProcessGroup(child,2000,false)
  result=await response
  assert.equal(stderr,'')
  assert.equal(child.signalCode,forced?mode==='prepared-kill'?'SIGKILL':'SIGTERM':null)
  assert.equal(child.exitCode,forced?null:0)
  rows.push({pid:child.pid,exitCode:child.exitCode,signal:child.signalCode,signals,managementEof:true})
  const postReap=fs.readFileSync(graph)
  phase='post-reap-read'
  let canonical,readFailure=null
  try{canonical=await owner.call({operation:'targets',maximumItems:32})}
  catch(error){readFailure=error.failure;if(JSON.stringify(JSON.parse(readFailure?.parameters?.control??'null'))!==JSON.stringify({Graph:{Commit:'RecoveryRequired'}}))throw error}
  assert.deepEqual(fs.readFileSync(graph),postReap,'read cannot repair Graph')
  if(readFailure){assert.ok(forced,'graceful writer must reopen cleanly');phase='explicit-reconciliation';await owner.call({operation:'reconcile'});phase='post-reconciliation-read';canonical=await owner.call({operation:'targets',maximumItems:32})}
  assert.equal(canonical.head.sequence,initial.head.sequence+(forced?0:1))
  if(forced){assert.deepEqual(canonical.head,initial.head);assert.equal(acknowledged,false);assert.equal(uncertain?.phase,'PossiblyDispatched')}
  else{assert.equal(canonical.head.commit,result.commit.commit_ref);assert.equal(uncertain,null)}
  const stable=fs.readFileSync(graph)
  phase='stable-reread'
  assert.deepEqual((await owner.call({operation:'targets',maximumItems:32})).head,canonical.head)
  assert.deepEqual(fs.readFileSync(graph),stable)
  const target=canonical.targets.find(t=>t.kind==='subject'&&t.roleRef.id===input.roleRef.id)
  fs.writeFileSync(path.join(input.evidence,'graph-prepared.json'),JSON.stringify({status:'PASS',mode,phase,observations,initial,barrier,rows,result,uncertain,readFailure,canonical,
   canonicalMutations:forced?0:1,implicitRepair:0,automaticResend:0,postReapRead:'PASS'},null,2)+'\n',{flag:'wx'})
  return {status:'PASS',roleRef:target.roleRef,committed:!forced}
 }catch(error){
  if(child)await stopProcessGroup(child,2000,false)
  await owner.close()
  fs.writeFileSync(path.join(input.evidence,'graph-prepared-failure.json'),JSON.stringify({message:error.message,failure:error.failure??null,sourceObservation:error.sourceObservation??null,phase,observations,mode,barrier,rows,result,uncertain,stderr},null,2)+'\n',{flag:'wx'})
  if(fs.existsSync(graph)){assert.ok(fs.statSync(graph).size<=16777216);fs.copyFileSync(graph,path.join(input.evidence,'failed-fixture-graph.redb'),fs.constants.COPYFILE_EXCL)}
  throw error
 }finally{channel?.fail('test-owner-closed');if(child)await stopProcessGroup(child,2000,false);await owner.close()}
}
