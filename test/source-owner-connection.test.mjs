// Hatter 2026: finite projection intake on the shared Management connection.
import assert from 'node:assert/strict'
import test from 'node:test'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'

test('source requests share connection custody, refuse excess intake, drain observers and preserve exact uncertainty without retry',async()=>{
  let sends=0,starts=0,closed=false
  const pending=[]
  const channel={request(method,params,timeout,observe){
    assert.equal(method,'source/execute');assert.ok(timeout>0&&timeout<=5000)
    sends++;observe({phase:'PossiblyDispatched',requestRef:sends})
    return new Promise((resolve,reject)=>pending.push({resolve,reject,observe,id:sends,params}))
  }}
  const connection={async start(){starts++;return channel},async close(){closed=true}}
  const observations=[],source=new SourceOwnerClient({connection,onObservation:v=>observations.push(v)})
  const abort=new AbortController()
  const first=source.call({operation:'targets',maximumItems:16},{signal:abort.signal})
  const second=source.call({operation:'targets',maximumItems:32})
  const cancelled=assert.rejects(first,error=>{assert.equal(error.code,'ProjectionCancelled');assert.deepEqual(error.rpc,{phase:'OwnerResponded',requestRef:1});return true})
  const uncertain=assert.rejects(second,error=>{assert.deepEqual(error.rpc,{phase:'PossiblyDispatched',requestRef:2});return true})
  await assert.rejects(source.call({operation:'targets',maximumItems:64}),{code:'ProjectionQueueFull'})
  assert.equal(sends,2);assert.equal(starts,2)
  abort.abort()
  let drained=false
  const closing=source.close().then(()=>{drained=true})
  await Promise.resolve();assert.equal(drained,false)
  pending[0].observe({phase:'OwnerResponded',requestRef:1});pending[0].resolve({targets:['original']})
  pending[1].reject(Object.assign(Error('lost reply'),{code:'SourceUnavailable'}))
  await Promise.all([cancelled,uncertain,closing])
  assert.equal(closed,false,'projection client never owns physical connection shutdown')
  assert.equal(sends,2,'no acquire, release or source request is retried')
  assert.equal(observations.length,2)
  assert.ok(observations.every(value=>!value.stages.some(stage=>/Handoff|Drain/u.test(stage.stage))))
  await assert.rejects(source.call({operation:'targets'}),{code:'ProjectionRuntimeClosed'})
  const unopened=new SourceOwnerClient({connection})
  const alreadyAborted=new AbortController();alreadyAborted.abort()
  await assert.rejects(unopened.call({operation:'targets'},{signal:alreadyAborted.signal}),error=>error.rpc.phase==='NotDispatched')
  assert.equal(starts,2);await unopened.close()
})
