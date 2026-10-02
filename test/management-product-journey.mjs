// Hatter 2026: actual compiled product composition and borrowed Console RPC.
// This is a scoped owner integration, not final installed/browser acceptance.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { once } from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import { spawnParentBound } from '@crowsi/transport-foundation/process'
import { FrameDecoder, limitsFor } from '@crowsi/transport-foundation'
import { ManagementConnection } from '../server/lib/management-connection.mjs'
import { SourceOwnerClient } from '../server/runtime/source-owner-client.mjs'

const directory=process.env.HATTER_TEST_BINARY_DIRECTORY
assert.ok(isAbsolute(directory??''),'exact built binary directory required')
async function artifact(name){
  const executable=join(directory,name),hash=createHash('sha256')
  for await(const bytes of createReadStream(executable))hash.update(bytes)
  return {executable,identity:[...hash.digest()]}
}
const home=await mkdtemp(join(tmpdir(),'hatter-product-console-'))
const artifacts=await Promise.all(['hatter-graph-owner','hatter-admission-owner','hatter-semantic-owner','hatter'].map(artifact))
const root=spawnParentBound(join(directory,'hatter-product-supervisor'),[],{
  stdio:['pipe','pipe','pipe'],env:{LANG:'C.UTF-8'},cwd:home})
let diagnostics='',connection
root.stderr.on('data',bytes=>{if(diagnostics.length<65536)diagnostics+=bytes.toString().slice(0,65536-diagnostics.length)})
const closed=once(root,'close')
const deadline=setTimeout(()=>root.kill('SIGTERM'),60000)
try{
  const ready=new Promise((resolve,reject)=>{
    const decoder=new FrameDecoder(limitsFor(16384))
    root.once('error',reject);root.once('exit',()=>reject(Error(`product exited before route publication: ${diagnostics}`)))
    root.stdout.on('data',bytes=>{try{decoder.feed(bytes,frame=>resolve(JSON.parse(frame.payload)))}catch(error){reject(error)}})
  })
  root.stdin.write(JSON.stringify({home,sockets:home,graph:artifacts[0],admission:artifacts[1],semantic:artifacts[2],management:artifacts[3]})+'\n')
  const routes=await ready
  assert.equal(routes.routes.home,home)
  const children=(await readFile(`/proc/${root.pid}/task/${root.pid}/children`,'utf8')).trim().split(/\s+/u).filter(Boolean)
  assert.equal(children.length,4,'only the four actual Management/Graph/Semantic processes in this launch scope')
  let exactFailure
  for(let repeat=0;repeat<2;repeat++){
    connection=new ManagementConnection({environment:{HATTER_MANAGEMENT_ENDPOINT:JSON.stringify(routes.management)}})
    await assert.rejects(connection.request('inference/role/list',{maximumItems:16}),error=>{
      assert.equal(error.failure.parameters.sourceOwner,'hatter/control')
      assert.deepEqual(JSON.parse(error.failure.parameters.ownerFailure),{Unavailable:'Missing'})
      assert.equal(error.rpc.phase,'OwnerResponded')
      if(exactFailure)assert.deepEqual(error.failure,exactFailure)
      exactFailure=error.failure;return true
    })
    assert.equal(connection.running,true,'typed canonical unavailability does not kill the shared connection')
    const source=new SourceOwnerClient({connection})
    try {
      // The same live process serves projection-source operations. Missing
      // canonical state is not an excuse to launch a private app-server child.
      await assert.rejects(source.call({operation:'targets',maximumItems:16}),error=>{
        assert.equal(error.failure.parameters.sourceOwner,'hatter/control')
        assert.deepEqual(JSON.parse(error.failure.parameters.ownerFailure),{Unavailable:'Missing'})
        assert.equal(error.rpc.phase,'OwnerResponded');return true
      })
    } finally {await source.close()}
    await connection.close();connection=null
    assert.equal(root.exitCode,null,'observer close does not stop the root')
    const current=(await readFile(`/proc/${root.pid}/task/${root.pid}/children`,'utf8')).trim().split(/\s+/u).filter(Boolean)
    assert.deepEqual(current,children,'reconnect does not create a second Management tree')
  }
  root.stdin.end()
  assert.deepEqual(await closed,[0,null],diagnostics)
  for(const pid of children)await assert.rejects(lstat(`/proc/${pid}`),{code:'ENOENT'})
  for(const name of ['control.sock','admission.sock','semantic.sock','management.sock','digital-twin','hats','sem-lang']){
    await assert.rejects(lstat(join(home,name)),{code:'ENOENT'})
  }
  const killed=spawnParentBound(join(directory,'hatter-product-supervisor'),[],{
    stdio:['pipe','pipe','pipe'],env:{LANG:'C.UTF-8'},cwd:home})
  killed.stderr.resume()
  const exited=once(killed,'close')
  try{
    const ready=new Promise((resolve,reject)=>{
      const decoder=new FrameDecoder(limitsFor(16384));killed.once('error',reject)
      killed.once('exit',()=>reject(Error('product exited before failure injection')))
      killed.stdout.on('data',bytes=>{try{decoder.feed(bytes,frame=>resolve(JSON.parse(frame.payload)))}catch(error){reject(error)}})
    })
    killed.stdin.write(JSON.stringify({home,sockets:home,graph:artifacts[0],admission:artifacts[1],semantic:artifacts[2],management:artifacts[3]})+'\n')
    await ready
    const children=(await readFile(`/proc/${killed.pid}/task/${killed.pid}/children`,'utf8')).trim().split(/\s+/u).filter(Boolean)
    assert.equal(children.length,4)
    killed.kill('SIGKILL');await exited
    const until=Date.now()+5000
    const alive=async()=>Promise.all(children.map(async pid=>{
      try{return {pid,stat:await readFile(`/proc/${pid}/stat`,'utf8')}}catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error}
    }))
    let remaining
    do{remaining=(await alive()).filter(Boolean);if(remaining.length)await delay(20)}while(remaining.length&&Date.now()<until)
    assert.deepEqual(remaining,[],'abrupt Supervisor death must release the owned process tree')
  }finally{if(killed.exitCode===null&&killed.signalCode===null)killed.kill('SIGKILL');await exited}
  process.stdout.write(JSON.stringify({status:'PASS',actualOwnerProcesses:4,connections:2,canonicalInitialization:false,childrenReaped:true,supervisorDeathReaped:true})+'\n')
}finally{
  clearTimeout(deadline);await connection?.close()
  root.stdin.end()
  await closed
  await rm(home,{recursive:true,force:true})
}
