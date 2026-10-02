// Controlled fault boundaries around installed product code and real owners.
import fs from 'node:fs'
import {once} from 'node:events'
import {ProductProjections} from '../server/runtime/product-projections.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
import {FileProjectionStore} from '@hathq/projection-runtime/store'
const input=JSON.parse(fs.readFileSync(0,'utf8')),leases=[],events=[],start=Date.now()
const call=SourceOwnerClient.prototype.call
let reads=0
SourceOwnerClient.prototype.call=async function(request,options){
  if(request.operation==='acquire'&&input.mode==='expire')request={...request,durationMs:2500}
  const result=await call.call(this,request,options)
  events.push({operation:request.operation,owner:request.source?.owner??request.owner,at:Date.now()-start})
  if(request.operation==='acquire')leases.push({source:request.source,holder:request.holder,generation:result.generation,acquiredAt:Date.now()})
  if(request.operation==='read'&&++reads===input.sources.length&&['pause','timeout'].includes(input.mode)){
    process.send({kind:'ready',leases})
    if(input.mode==='pause')await once(process,'message')
    else await new Promise((resolve,reject)=>{
      if(options.signal.aborted)return reject(options.signal.reason)
      options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})
    })
  }
  return result
}
if(['fail','expire'].includes(input.mode))FileProjectionStore.prototype.publish=function(){
  throw Object.assign(Error('injected store outage before publication'),{code:'ProjectionUnavailable'})
}
const product=new ProductProjections(input.environment)
try{
  let result
  try{result=input.retry?await product.retry(input.id):await product.submit('subject',{
    id:input.id,key:input.key,sources:input.sources,focus:input.focus??'owner'})}
  catch(error){result={error:error.code,failure:error.failure??null}}
  process.stdout.write(JSON.stringify({result,leases,events,elapsedMs:Date.now()-start})+'\n')
}finally{await product.close();if(process.connected)process.disconnect()}
