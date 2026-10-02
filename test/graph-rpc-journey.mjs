// Hatter 2026: actual installed source HAT and canonical Graph, not a fake RPC peer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnParentBound} from '@crowsi/transport-foundation/process'
import {JsonlChannel} from '../server/lib/jsonl-channel.mjs'
import {stopProcessGroup} from './owner-process-fixture.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
import {slowOwner} from './graph-slow-owner.mjs'

export async function graphRpcJourney(input,environment,mode){
 assert.ok(['eof-write','after-send-cut','commit-response-cut','slow-eof','forced-term','forced-kill'].includes(mode))
 const slow=['slow-eof','forced-term','forced-kill'].includes(mode),forced=mode.startsWith('forced-')
 const processes=[],owner=new SourceOwnerClient(environment)
 const start=async()=>{
  const child=spawnParentBound(input.binary,['app-server','--stdio'],{cwd:input.home,env:environment,stdio:['pipe','pipe','pipe']})
  let stderr='';child.stderr.on('data',b=>{stderr+=b;if(stderr.length>65536)child.kill()})
  const channel=new JsonlChannel(child.stdout,child.stdin,{timeoutMs:5000,maxLineBytes:524288,maxPendingMessages:2})
  const close=async({outputCut=false,expectedSignal=null}={})=>{
   try{await stopProcessGroup(child,2000,false)}finally{channel.fail('test-owner-closed')}
   processes.push({pid:child.pid,exitCode:child.exitCode,signal:child.signalCode,stderr})
   assert.equal(child.exitCode,expectedSignal?null:outputCut?1:0,JSON.stringify(processes.at(-1)));assert.equal(child.signalCode,expectedSignal)
   assert.equal(stderr,outputCut?'Error: ConnectionFailed\n':'')
  }
  try{await channel.request('initialize',{clientInfo:{name:'hatter_management_console',title:'Hatter Console',version:'0.10.0'},capabilities:{experimentalApi:false}})}catch(error){await close();throw error}
  return {child,channel,close}
 }
 const rows=[]
 try{
  const initial=await owner.call({operation:'targets',maximumItems:32})
  const graphPath=path.join(input.home,'digital-twin/v1.redb')
  const beforeBytes=fs.readFileSync(graphPath)
  const idle=await start();await idle.close()
  assert.deepEqual(fs.readFileSync(graphPath),beforeBytes)
  rows.push({case:'A',state:'PASS',canonicalMutation:0})
  const read=await start()
  try{
   const response=read.channel.request('source/execute',{operation:'targets',maximumItems:32})
   // EOF is queued after the actual request bytes, before the owner reply.
   const [value]=await Promise.all([response,read.close()])
   assert.deepEqual(value.head,initial.head)
   assert.deepEqual(fs.readFileSync(graphPath),beforeBytes)
   rows.push({case:'G',state:'PASS',canonicalMutation:0})
  }finally{if(read.child.exitCode===null&&read.child.signalCode===null)await read.close()}
  const description=await owner.call({operation:'sourceDescribe',roleRef:input.roleRef},{method:'interaction/execute'})
  const request={operation:'sourceSubmit',providerId:description.interactionRef,generation:description.generation,
   inputContractRef:description.inputContractRef,values:{editable:input.value}}
  const refused=await start();await refused.close()
  await assert.rejects(refused.channel.request('interaction/execute',request),e=>e.rpc?.phase==='NotDispatched'&&e.rpc.requestRef===null)
  assert.deepEqual((await owner.call({operation:'targets',maximumItems:32})).head,initial.head)
  assert.deepEqual(fs.readFileSync(graphPath),beforeBytes)
  rows.push({case:'RPC_NOT_DISPATCHED',state:'PASS',canonicalMutation:0,receipt:null})
  const write=await start();let observed=null,cut=false,buffer='',result,uncertain=null,captureError=null,barrier=null
  if(!slow&&mode!=='eof-write')write.child.stdout.prependListener('data',bytes=>{
   // Test-owned physical response boundary only. The real owner's complete
   // committed response is evidence, but is deliberately withheld from RPC.
   try{
    buffer+=bytes.toString();assert.ok(Buffer.byteLength(buffer)<=524288)
    const newline=buffer.indexOf('\n');if(newline<0)return
    const response=JSON.parse(buffer.slice(0,newline));buffer=buffer.slice(newline+1)
    if(response.id!==2)return
    assert.match(response.result?.commit?.commit_ref??'',/^[a-f0-9]{64}$/)
    observed=response.result
    if(mode==='commit-response-cut'){cut=true;write.channel.fail('test-response-cut')}
   }catch(error){captureError=error;write.channel.fail(error)}
  })
  try{
   if(slow){({result,uncertain,barrier}=await slowOwner(input,environment,write,request,mode))}else{
   const response=write.channel.request('interaction/execute',request)
   if(mode==='eof-write'){
    ;[result]=await Promise.all([response,write.close()])
   }else{
    if(mode==='after-send-cut'){
     // The request has entered the real transport. No owner response is yet
     // observed by this client; no inference about whether commit occurred.
     assert.equal(observed,null);cut=true;write.channel.fail('test-after-send-cut')
    }
    try{await response;assert.fail('cut reply unexpectedly completed RPC')}catch(error){
     assert.equal(error.rpc?.phase,'PossiblyDispatched');assert.equal(error.rpc.requestRef,2)
     uncertain={phase:error.rpc.phase,requestRef:error.rpc.requestRef}
    }
    assert.equal(cut,true);await write.close({outputCut:mode==='after-send-cut'});assert.equal(captureError,null);result=observed
    if(mode!=='after-send-cut')assert.ok(result,'real owner result must exist after drain; never synthesize a receipt')
   }
   }
  }finally{if(write.child.exitCode===null&&write.child.signalCode===null)await write.close()}
  const canonical=await owner.call({operation:'targets',maximumItems:32})
  assert.equal(canonical.head.sequence,initial.head.sequence+(forced?0:1))
  if(forced)assert.deepEqual(canonical.head,initial.head)
  if(result)assert.equal(canonical.head.commit,result.commit.commit_ref)
  const target=canonical.targets.find(t=>t.kind==='subject'&&(forced?JSON.stringify(t.roleRef)===JSON.stringify(input.roleRef):t.receiptRef===canonical.head.commit))
  assert.ok(target)
  const exactSource=await owner.call({operation:'describe',owner:'hatter/control',reference:target.receiptRef})
  assert.equal(exactSource.ref,target.receiptRef)
  const stable=fs.readFileSync(graphPath)
  assert.deepEqual((await owner.call({operation:'targets',maximumItems:32})).head,canonical.head)
  assert.deepEqual(fs.readFileSync(graphPath),stable)
  rows.push({case:({ 'eof-write':'H','slow-eof':'I','forced-term':'J','forced-kill':'K','after-send-cut':'RPC_AFTER_SEND_CUT','commit-response-cut':'RPC_COMMIT_RESPONSE_CUT'})[mode],state:'PASS',before:initial.head,after:canonical.head,
   receipt:result?.commit??null,receiptRef:forced?null:canonical.head.commit,exactSource,canonicalMutation:forced?0:1,automaticResend:0,uncertain,barrier,postReapRead:'PASS'})
  fs.writeFileSync(path.join(input.evidence,'graph-rpc.json'),JSON.stringify({mode,status:'PASS',rows,processes,canonical,result},null,2)+'\n',{flag:'wx'})
  return {status:'PASS',roleRef:target.roleRef,committed:!forced}
 }catch(error){
  await owner.close()
  const home=fs.realpathSync(input.home),graph=path.join(home,'digital-twin/v1.redb')
  assert.equal(path.dirname(home),fs.realpathSync(os.tmpdir()))
  if(fs.existsSync(graph)){
   const stat=fs.lstatSync(graph);assert.ok(stat.isFile()&&stat.uid===process.getuid()&&stat.size<=16777216)
   fs.copyFileSync(graph,path.join(input.evidence,'failed-fixture-graph.redb'),fs.constants.COPYFILE_EXCL)
  }
  fs.writeFileSync(path.join(input.evidence,'graph-rpc-failure.json'),JSON.stringify({mode,message:error.message,ownerFailure:error.failure??null,rows,processes},null,2)+'\n',{flag:'wx'})
  throw error
 }finally{await owner.close()}
}
