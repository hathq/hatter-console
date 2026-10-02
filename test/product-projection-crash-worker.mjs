// Fault observation around the real product path, never a synthetic source owner.
import fs from 'node:fs'
import {createRequire,syncBuiltinESMExports} from 'node:module'
import {fileURLToPath} from 'node:url'
import {ProductProjections} from '../server/runtime/product-projections.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
import {FileProjectionStore} from '@hathq/projection-runtime/store'
const input=JSON.parse(fs.readFileSync(0,'utf8')),acquired=[]
const crash=()=>{fs.writeSync(1,JSON.stringify({phase:input.phase,acquired})+'\n');process.exit(77)}
const original=SourceOwnerClient.prototype.call
SourceOwnerClient.prototype.call=async function(request,options){
  // Fault experiments use a supported shorter physical lease, not a memory TTL
  // or an increased job deadline. The actual source owner enforces this value.
  if(request.operation==='acquire'&&['after-publication','during-cleanup'].includes(input.phase))request={...request,durationMs:3000}
  if(input.phase==='during-cleanup'&&request.operation==='release'){crash();await new Promise(()=>{})}
  const result=await original.call(this,request,options)
  if(request.operation==='acquire'){
    acquired.push({source:request.source,holder:request.holder,generation:result.generation,acquiredAt:Date.now()})
    if((['after-first-acquire','repair-takeover'].includes(input.phase)&&acquired.length===1)
      ||input.phase==='after-all-acquire'&&acquired.length===input.sources.length){crash();await new Promise(()=>{})}
  }
  if(input.phase==='after-exact-read'&&request.operation==='read'){crash();await new Promise(()=>{})}
  return result
}
const publish=FileProjectionStore.prototype.publish
FileProjectionStore.prototype.publish=function(...args){
  if(input.phase==='before-publication'){crash();return new Promise(()=>{})}
  if(input.phase==='during-publication')fs.writeSync(1,JSON.stringify({phase:input.phase,acquired})+'\n')
  const result=publish.apply(this,args)
  if(input.phase==='after-publication'){crash();return new Promise(()=>{})}
  return result
}
if(input.phase==='during-producer'){
  const wt=createRequire(import.meta.url)('node:worker_threads'),Original=wt.Worker
  wt.Worker=class extends Original{constructor(...args){super(...args);this.once('online',crash)}}
  syncBuiltinESMExports()
}
if(input.phase==='during-publication')process.env.NODE_OPTIONS='--import '+fileURLToPath(new URL('./product-publication-crash-preload.mjs',import.meta.url))
const product=new ProductProjections(input.environment)
try{
  if(input.phase==='repair-takeover')await product.retry(input.id)
  else await product.submit('subject',{key:input.key,sources:input.sources,focus:'owner',id:input.id})
  throw Error('fault did not interrupt product')
}catch(error){
  if(input.phase==='during-publication'&&error.code==='ProjectionUnavailable')throw error
  else{process.stderr.write(String(error.stack));process.exitCode=1;await product.close()}
}
