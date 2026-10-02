// Hatter 2026: explicit local developer sample composition, not a model fallback.
// One external Zixcel service and one Hatter root; both drained on exit.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomBytes} from 'node:crypto'
import {setTimeout as pause} from 'node:timers/promises'
const execute=promisify(execFile),[home,hatter,runtimeBinary]=process.argv.slice(2)
assert([home,hatter,runtimeBinary].every(p=>p&&path.isAbsolute(p)))
const raw=await fs.readFile(path.join(home,'feedback-assistance.json'));assert(raw.length<=131072)
const profiles=JSON.parse(raw);assert(profiles.length>0&&profiles.length<=32)
const runtimes=new Set(profiles.map(p=>p.runtime_ref));assert.equal(runtimes.size,1,'sample session requires one explicitly selected runtime')
const runtimeRef=[...runtimes][0];assert.match(runtimeRef,/^[0-9a-f]{64}$/)
const root=path.join(home,'local-inference/admission')
await fs.access(path.join(root,'admission.redb'))
let stopping=false
const children=[],spawnOwned=(binary,args,env)=>{
 const child=spawn(binary,args,{env,stdio:['ignore','pipe','pipe']});children.push(child)
 child.finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}))})
 child.finished.catch(()=>{})
 let bytes=0
 for(const [stream,output]of [[child.stdout,process.stdout],[child.stderr,process.stderr]])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576){child.kill('SIGTERM');return}output.write(chunk)})
 return child
}
const registry=async command=>{
 const {stdout}=await execute(hatter,['inference','registry','--request-json',JSON.stringify({operation:'process',command})],{env:{...process.env,HATTER_HOME:home},timeout:10000,maxBuffer:1048576})
 return JSON.parse(stdout).observation
}
let runtime,product
const stop=()=>{stopping=true;product?.kill('SIGTERM')}
process.on('SIGINT',stop);process.on('SIGTERM',stop)
try{
 // Never attach to or shut down somebody else's service.
 let present=false;try{await registry({operation:'inspect'});present=true}catch{}
 assert.equal(present,false,'an existing runtime service must be stopped by its owner first')
 runtime=spawnOwned(runtimeBinary,['runtime-serve','--state',root],{PATH:process.env.PATH,LANG:'C'})
 const deadline=Date.now()+30000
 while(true){
  assert(!stopping&&runtime.exitCode===null&&Date.now()<deadline,'local runtime service failed to start')
  try{await registry({operation:'inspect'});break}catch{await pause(100)}
 }
 // This invocation is a new explicit process start, not replay of the retired
 // start from an earlier session. Never retry an uncertain start with a new ID.
 const start=await registry({operation:'start',runtimeRef,requestRef:randomBytes(32).toString('hex')});assert.equal(start.rejection,null,JSON.stringify(start))
 while(true){
  assert(!stopping&&runtime.exitCode===null&&Date.now()<deadline,'local model did not become ready')
  const current=await registry({operation:'inspect'})
  if(current.process?.state==='ready'){assert.equal(current.process.runtimeRef,runtimeRef);break}
  assert(!['failed','stopped'].includes(current.process?.state),JSON.stringify(current));await pause(100)
 }
 console.log('Local review runtime ready. Starting Hatter; observations remain unadopted.')
 product=spawnOwned(hatter,[],{...process.env,HATTER_HOME:home})
 const outcome=await Promise.race([product.finished.then(r=>({owner:'hatter',...r})),runtime.finished.then(r=>({owner:'runtime',...r}))])
 if(!stopping)assert(outcome.owner==='hatter'&&outcome.code===0,JSON.stringify(outcome))
}finally{
 // Stop product first: its bounded active review may still need the runtime.
 if(product&&product.exitCode===null&&!product.signalCode)product.kill('SIGTERM')
 const drain=async child=>{
  if(!child)return
  let timer
  try{await Promise.race([child.finished,new Promise((_,reject)=>timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owned process did not drain: '+child.pid))},35000))])}
  finally{clearTimeout(timer)}
 }
 try{await drain(product)}finally{
  if(runtime&&runtime.exitCode===null&&!runtime.signalCode){try{await registry({operation:'shutdown'})}catch{runtime.kill('SIGTERM')}}
  await drain(runtime)
 }
 process.off('SIGINT',stop);process.off('SIGTERM',stop)
}
