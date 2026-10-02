// Linux test-owned process barriers. No production delay or fault-control port.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function until(check){
 const end=performance.now()+1500
 for(;;){if(check())return;assert(performance.now()<end,'owned process barrier timeout');await pause(10)}
}
export async function slowOwner(input,environment,write,request,mode){
 const pid=input.providerPid
 assert(Number.isSafeInteger(pid)&&pid>1)
 assert.equal(fs.realpathSync('/proc/'+pid+'/exe'),fs.realpathSync(environment.HATTER_R1_PROVIDER_BINARY))
 let frozen=false,timer=null
 const signals=[],kill=write.child.kill.bind(write.child)
 write.child.kill=signal=>{signals.push(signal);return kill(signal)}
 try{
  const graph=path.join(input.home,'digital-twin/v1.redb'),before=fs.readFileSync(graph)
  process.kill(pid,'SIGSTOP');frozen=true
  await until(()=>/^State:\s+T/m.test(fs.readFileSync('/proc/'+pid+'/status','utf8')))
  // Handle the response immediately even while waiting for the independent
  // physical connection barrier; transport closure must not reject unhandled.
  const response=write.channel.request('interaction/execute',request).then(result=>({result}),error=>({error}))
  await until(()=>{
   const sockets=new Set(fs.readdirSync('/proc/'+write.child.pid+'/fd').flatMap(fd=>{
    try{const m=fs.readlinkSync('/proc/'+write.child.pid+'/fd/'+fd).match(/^socket:\[(\d+)\]$/);return m?[m[1]]:[]}catch{return []}
   }))
   return fs.readFileSync('/proc/net/unix','utf8').split('\n').some(line=>{const fields=line.trim().split(/\s+/);return fields[5]==='03'&&sockets.has(fields[6])})
  })
  // Actual source-provider connection exists, but the stopped provider cannot
  // return input. Therefore canonical Structural Apply cannot have begun.
  assert.deepEqual(fs.readFileSync(graph),before,'before canonical write barrier must not mutate Graph')
  if(mode==='forced-kill'){
   kill('SIGSTOP')
   await until(()=>/^State:\s+T/m.test(fs.readFileSync('/proc/'+write.child.pid+'/status','utf8')))
  }
  if(mode==='slow-eof')timer=setTimeout(()=>{process.kill(pid,'SIGCONT');frozen=false},250)
  const started=performance.now()
  const expectedSignal=mode==='forced-kill'?'SIGKILL':mode==='forced-term'?'SIGTERM':null
  const [reply]=await Promise.all([response,write.close({expectedSignal})])
  const elapsedMs=Math.round(performance.now()-started)
  assert.deepEqual(signals,mode==='slow-eof'?[]:mode==='forced-term'?['SIGTERM']:['SIGTERM','SIGKILL'])
  if(expectedSignal){
   assert.equal(reply.error?.rpc?.phase,'PossiblyDispatched');assert.equal(reply.error.rpc.requestRef,2)
   assert(elapsedMs>=1900,'must not signal before configured drain grace')
   return {result:null,uncertain:reply.error.rpc,barrier:{providerPid:pid,connected:true,signals,elapsedMs,expectedSignal}}
  }
  assert.equal(reply.error,undefined);assert(reply.result?.commit)
  return {result:reply.result,uncertain:null,barrier:{providerPid:pid,connected:true,signals,elapsedMs,expectedSignal}}
 }finally{
  clearTimeout(timer)
  if(frozen)process.kill(pid,'SIGCONT')
  if(write.child.exitCode===null&&write.child.signalCode===null){kill('SIGCONT');await write.close()}
 }
}
