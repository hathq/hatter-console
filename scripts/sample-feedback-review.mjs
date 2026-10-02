// Explicit developer sample runner. All inference/control writes use the public
// CLI, not imported Hatter sources or direct canonical-store mutations.
// No network, user-data harvesting, candidate adoption or production defaults.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {setTimeout as pause} from 'node:timers/promises'
const execute=promisify(execFile)
const [home,inputPath,hatter,runtimeBinary,registrySource,outputPath]=process.argv.slice(2)
assert([home,inputPath,hatter,runtimeBinary,registrySource,outputPath].every(p=>p&&path.isAbsolute(p)))
const inputs=JSON.parse(await fs.readFile(inputPath,'utf8'))
assert.equal(inputs.sampleOnly,true);assert.equal(inputs.calls.length,3)
assert.equal(new Set(inputs.calls.map(c=>c.roleRef.id)).size,3)
assert.equal(await fs.stat(outputPath).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e}),false)
const root=path.join(home,'local-inference/admission')
// Clone an explicitly named, already verified immutable sample registry. Share
// content-addressed model bytes by hard link; never duplicate a model download.
if(!await fs.stat(root).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e})){
 const sources=await fs.readdir(path.join(registrySource,'objects'),{withFileTypes:true})
 assert(sources.every(e=>e.isFile()&&/^[0-9a-f]{64}$/.test(e.name)))
 await fs.mkdir(path.join(root,'objects'),{recursive:true})
 await fs.copyFile(path.join(registrySource,'admission.redb'),path.join(root,'admission.redb'),fs.constants.COPYFILE_EXCL)
 const lock=await fs.open(path.join(root,'admission.lock'),'wx');await lock.close()
 for(const entry of sources)await fs.link(path.join(registrySource,'objects',entry.name),path.join(root,'objects',entry.name))
}
const cli=async(command,request)=>{
 const {stdout,stderr}=await execute(hatter,[...command,'--request-json',JSON.stringify(request)],{env:{...process.env,HATTER_HOME:home},timeout:45000,maxBuffer:1048576})
 assert.equal(stderr,'');return JSON.parse(stdout)
}
const registry=command=>cli(['inference','registry'],{operation:'process',command})
const child=spawn(runtimeBinary,['runtime-serve','--state',root],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C'}})
let diagnostics='',outputBytes=0
const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}))})
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{outputBytes+=chunk.length;diagnostics=(diagnostics+chunk.toString()).slice(-4096)})
const results=[]
try{
 const readyUntil=Date.now()+15000
 while(true){try{await registry({operation:'inspect'});break}catch(error){if(Date.now()>=readyUntil||child.exitCode!==null)throw error;await pause(100)}}
 for(const call of inputs.calls){
  const started=await registry({operation:'start',runtimeRef:call.runtimeRef,requestRef:call.runtimeRef})
  assert.equal(started.observation.rejection,null)
  let current
  const until=Date.now()+30000
  do{current=(await registry({operation:'inspect'})).observation.process;assert(Date.now()<until,JSON.stringify(current));if(current?.state!=='ready')await pause(100)}while(current?.state!=='ready')
  assert.equal(current.runtimeRef,call.runtimeRef);call.processRef=current.processRef
  const prepared=await cli(['inference','execute'],{operation:'prepare',call})
  assert.equal(prepared.state,'Prepared')
  const request=prepared.request
  const accepted=await cli(['inference','execute'],{operation:'submit',call,request,prerequisite:null})
  assert.equal(accepted.state,'Accepted')
  const {result}=await cli(['inference','execute'],{operation:'wait',request})
  assert.equal(typeof result.output.output.value.Text,'string')
  const view=await cli(['inference','restore'],{roleRef:call.roleRef})
  const id='sample:result:'+accepted.requestRef
  const feedback={control:{operation_id:id,expected_commit_revision:view.controlCommitRevision},roleRef:call.roleRef,causation:accepted.requestRef,
   contextOperation:{operation_id:id,expected_commit_revision:view.contextCommitRevision,expected_memory_revision:view.memoryRevision,subject_ref:view.subjectRef,scope:'CurrentRequest',
    operation:{Retain:{observation:{input:{reference:result.result_ref,text:result.output.output.value.Text},context:call.context,retention:'KeepForSession'}}}}}
  const review={operation:'observe',call,request,feedback}
  const published=await cli(['inference','execute'],review)
  assert(published.receipt?.commit?.commit_ref);assert.equal(published.modelAccess,'none')
  assert.deepEqual(await cli(['inference','execute'],review),published)
  results.push({roleRef:published.roleRef,requestRef:accepted.requestRef,resultRef:result.result_ref,output:result.output.output.value.Text,published})
  console.log(JSON.stringify({role:call.roleRef.id,requestRef:accepted.requestRef,state:published.outcome.kind,output:result.output.output.value.Text}))
 }
 const output=await fs.open(outputPath,'wx');try{await output.writeFile(JSON.stringify({sampleOnly:true,results},null,2));await output.sync()}finally{await output.close()}
}finally{
 if(child.exitCode===null){try{await registry({operation:'shutdown'})}catch{child.kill('SIGTERM')}}
 let timer
 try{const stopped=await Promise.race([closed,new Promise((_,reject)=>timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Sample runtime did not drain'))},10000))]);assert.equal(stopped.code,0,JSON.stringify({stopped,diagnostics}))}finally{clearTimeout(timer)}
 assert(outputBytes<1048576,'sample runtime diagnostics exceeded bound')
}
