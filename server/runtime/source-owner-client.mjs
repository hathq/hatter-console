// Hatter 2026: source projection borrows the same Management connection as UI
// operations. No child process, private scheduler, canonical reader or retry.
import {rpcFailure} from '../lib/jsonl-channel.mjs'
import {performance} from 'node:perf_hooks'
import {randomUUID} from 'node:crypto'

const failure=code=>Object.assign(new Error(code),{code})
export class SourceOwnerClient {
  #connection; #active=new Set(); #closed=false; #observe
  constructor({connection,onObservation=()=>{}}={}){
    this.#connection=connection;this.#observe=onObservation
  }
  async call(request,{deadline=Date.now()+5000,signal,method='source/execute'}={}){
    if(!['source/execute','interaction/execute'].includes(method))throw failure('InvalidSourceRequest')
    if(this.#closed)throw failure('ProjectionRuntimeClosed')
    if(this.#active.size>=2)throw failure('ProjectionQueueFull')
    if(Buffer.byteLength(JSON.stringify(request))>65536)throw failure('ProjectionLimitExceeded')
    let finish
    const operation={done:new Promise(resolve=>{finish=resolve})};this.#active.add(operation)
    const started=performance.now(),stages=[],callRef=randomUUID()
    let outcome='Ready',rpc={phase:'NotDispatched',requestRef:null},at='RequestAccepted',failedAt=null,cancelled
    const mark=stage=>{at=stage;if(stages.length<24)stages.push({stage,elapsedMs:performance.now()-started})}
    const operationName=['targets','operations','describe','sourceDescribe','sourceSubmit','acquire','read','release','provision','reconcile'].includes(request.operation)?request.operation:null
    const abort=()=>{cancelled??=failure(signal?.reason?.code==='ProjectionExecutionTimeout'?'ProjectionExecutionTimeout':'ProjectionCancelled')}
    const remaining=()=>{const value=deadline-Date.now();if(value<=0)throw failure('ProjectionExecutionTimeout');return Math.min(5000,value)}
    mark('RequestAccepted')
    try{
      if(signal?.aborted)abort()
      if(cancelled)throw cancelled
      remaining()
      if(!this.#connection)throw failure('SourceUnavailable')
      signal?.addEventListener('abort',abort,{once:true})
      mark('OwnerInitializationStart')
      const channel=await this.#connection.start()
      mark('OwnerInitializationReady')
      if(cancelled||this.#closed)throw cancelled??failure('ProjectionCancelled')
      mark('RpcDispatchStart')
      const result=await channel.request(method,request,remaining(),value=>{
        rpc=value
        if(value.phase==='PossiblyDispatched')mark('RpcTransportEntered')
        if(value.phase==='OwnerResponded')mark('OwnerResponseReady')
      })
      if(cancelled)throw cancelled
      return result
    }catch(error){
      const exact=cancelled??error
      if(!exact.code)exact.code=sourceOutcome(exact.failure)
      outcome=exact.code;failedAt=at
      const observed=rpcFailure(exact,rpc)
      Object.defineProperty(observed,'sourceObservation',{value:{callRef,method,operation:operationName,failedAt:at}})
      throw observed
    }finally{
      signal?.removeEventListener('abort',abort)
      // Waited for the original request observation, not a second stop/kill.
      // PossiblyDispatched remains uncertain; no acquire/release is replayed.
      this.#active.delete(operation);finish()
      try{this.#observe(Object.freeze({callRef,method,operation:operationName,outcome,failedAt,rpc:Object.freeze({...rpc}),stages:Object.freeze(stages.map(Object.freeze))}))}catch{}
    }
  }
  async close(){this.#closed=true;await Promise.all([...this.#active].map(operation=>operation.done))}
}
function sourceOutcome(value){
  const exact=value?.parameters?.source
  if(['SourceNotRetained','SourceRevisionMismatch','SourceCorrupt','VisibilityDenied'].includes(exact))return exact
  if(value?.class==='authority')return 'VisibilityDenied'
  if(value?.class==='limit')return 'ProjectionLimitExceeded'
  return 'SourceUnavailable'
}
