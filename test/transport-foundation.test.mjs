// Hatter CR: real packaged transport, exact failure projection and application correlation.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { JsonlChannel } from '../server/lib/jsonl-channel.mjs'
import { projectManagementFailure } from '../server/lib/management-failure.mjs'
function fixture(options) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough()
  child.stdin.resume()
  return { child, channel: new JsonlChannel(child.stdout, child.stdin, options) }
}
test('batched/split responses correlate without aggregate-chunk rejection; pending bound drains', async () => {
  const {child,channel}=fixture({maxLineBytes:128,maxPendingMessages:2})
  const first=channel.request('one',{}), second=channel.request('two',{})
  await assert.rejects(channel.request('three',{}),e=>e.failure.parameters.transport==='Backpressure')
  const firstBytes=Buffer.from(JSON.stringify({id:1,result:'日'.repeat(20)})+'\n')
  const secondBytes=Buffer.from(JSON.stringify({id:2,result:'本'.repeat(20)})+'\n')
  child.stdout.write(Buffer.concat([firstBytes,secondBytes]))
  assert.equal(await first,'日'.repeat(20));assert.equal(await second,'本'.repeat(20))
  assert.deepEqual(channel.requests.usage,{messages:0,bytes:0})
  const third=channel.request('three',{});const bytes=Buffer.from('{"id":3,"result":"日本"}\n')
  for (const byte of bytes) child.stdout.write(Buffer.from([byte]))
  assert.equal(await third,'日本');channel.fail('done')
})
test('refusal before serialization, malformed/oversize priority, exact failures and no request leak', async () => {
  const {child,channel}=fixture({maxLineBytes:128})
  await assert.rejects(channel.request('large',{value:'x'.repeat(8192)}),e=>e.failure.parameters.transport==='InputTooLarge')
  assert.equal(channel.pending.size,0);assert.deepEqual(channel.requests.usage,{messages:0,bytes:0})
  const pending=channel.request('one',{});const failed=assert.rejects(pending,e=>e.failure.parameters.transport==='InputTooLarge')
  child.stdout.write(Buffer.alloc(8*1024*1024,120));await failed
  assert.equal(channel.transport.decoder.metrics.highWater,128)
  assert.equal(channel.transport.decoder.metrics.bytesConsumed,129)
  assert.equal(channel.pending.size,0)
  for (const input of [Buffer.from('not-json\n'),Buffer.from([123,34,120,34,58,34,255,34,125,10])]) {
    const {child,channel}=fixture();const p=channel.request('test',{});const failed=assert.rejects(p,e=>{
      assert.equal(e.failure.parameters.transport,'MalformedFrame');assert.equal(e.failure.class,'input')
      assert.equal(e.failure.responsibility,'hatter');return true
    })
    child.stdout.write(input);await failed;assert.equal(channel.pending.size,0)
  }
  const data={schema:'hathq://hatter/management-failure/v1',code:'management-transport-failed',
    reasonId:'hathq://vocabulary/reason/operation-rejected/v1',class:'limit',recovery:'none',
    responsibility:'external-service',operation:'management/request',parameters:{transport:'InputTooLarge',component:'crowsi'},nextActionId:null}
  assert.equal(projectManagementFailure({code:-32000,message:data.code,data}).parameters.transport,'InputTooLarge')
  assert.equal(projectManagementFailure({code:-32000,message:data.code,data:{...data,parameters:{transport:'invented'}}}),null)
})
test('request timeout does not resend, late result does not complete another request, IDs exhaust', async () => {
  const {child,channel}=fixture({timeoutMs:5});let writes=0;child.stdin.on('data',()=>writes++)
  await assert.rejects(channel.request('effect',{}),e=>e.failure.parameters.transport==='Timeout')
  assert.equal(writes,1);assert.equal(channel.pending.size,0)
  child.stdout.write('{"id":1,"result":"late"}\n')
  const next=channel.request('explicit',{},100);child.stdout.write('{"id":2,"result":"current"}\n')
  assert.equal(await next,'current');assert.equal(writes,2)
  channel.nextId=Number.MAX_SAFE_INTEGER+1
  await assert.rejects(channel.request('no',{}),e=>e.failure.parameters.transport==='SequenceExhausted')
  assert.equal(writes,2);assert.deepEqual(channel.requests.usage,{messages:0,bytes:0});channel.fail('done')
  for (const [event,outcome] of [['exit','ConnectionClosed'],['error','ConnectionFailed'],['stop','ConnectionClosed']]) {
    const {child,channel}=fixture();const request=channel.request('pending',{})
    const failed=assert.rejects(request,e=>e.failure.parameters.transport===outcome)
    if(event==='stop')channel.fail('hatter-app-server-stopped');else child.stdout.emit(event==='exit'?'end':event)
    await failed;assert.equal(channel.pending.size,0);assert.deepEqual(channel.requests.usage,{messages:0,bytes:0})
    await assert.rejects(channel.request('after-close',{}),e=>e.failure.parameters.transport==='ConnectionClosed')
    assert.throws(()=>channel.notify('after-close',{}),e=>e.failure.parameters.transport==='ConnectionClosed')
  }
})
test('RPC observations distinguish never-dispatched from lost outcomes and retain exact per-request IDs without changing diagnostics or resending', async()=>{
  const {child,channel}=fixture({timeoutMs:10});let writes=0
  child.stdin.on('data',()=>writes++)
  const observed=[]
  await assert.rejects(channel.request('effect',{},10,value=>observed.push(value)),error=>{
    assert.deepEqual(error.rpc,{phase:'PossiblyDispatched',requestRef:1});return true
  })
  assert.equal(writes,1)
  assert.deepEqual(observed,[{phase:'NotDispatched',requestRef:null},{phase:'PossiblyDispatched',requestRef:1}])
  const one=channel.request('one',{}),two=channel.request('two',{})
  const checked=[assert.rejects(one,error=>error.rpc.requestRef===2&&error.rpc.phase==='PossiblyDispatched'),
    assert.rejects(two,error=>error.rpc.requestRef===3&&error.rpc.phase==='PossiblyDispatched')]
  child.stdout.emit('end');await Promise.all(checked)
  await assert.rejects(channel.request('closed',{}),error=>{
    assert.deepEqual(error.rpc,{phase:'NotDispatched',requestRef:null});return true
  })
  assert.equal(writes,3);assert.equal(channel.pending.size,0)
  const next=fixture();const result=next.channel.request('read',{},100,()=>{throw Error('diagnostic sink failed')})
  next.child.stdout.write('{"id":1,"result":"original"}\n')
  assert.equal(await result,'original');next.channel.fail('done')
})
