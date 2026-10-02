// Actual installed Crowsi STATE envelopes over current product PP state.
import assert from 'node:assert/strict'
import {PassThrough,Transform} from 'node:stream'
import {RealtimeEndpoint} from '@crowsi/transport-foundation/realtime'
export async function stateJourney(product,key,snapshot){
  const received=[],bases=[],failures=[];let hold=false,acks=0
  const sender=new RealtimeEndpoint({onMessage:()=>{},onFailure:e=>failures.push(e.outcome)})
  const receiver=new RealtimeEndpoint({onMessage:m=>{assert.equal(m.class,'STATE');received.push(JSON.parse(m.payload))},onFailure:e=>failures.push(e.outcome)})
  function connect(){const forward=new PassThrough(),reverse=new Transform({transform(chunk,encoding,done){
    if(hold&&JSON.parse(chunk).kind==='ACK')acks++;else this.push(chunk);done()
  }});sender.connect(reverse,forward,receiver.capabilities());receiver.connect(forward,reverse,sender.capabilities())}
  const owner=({revision})=>{bases.push(revision);return product.recoverState({key,revision})}
  sender.subscribe(key);receiver.subscribe(key);connect()
  try{
    const first=await sender.recover(key,owner);await first.peer
    assert.deepEqual(received,[snapshot]);assert.equal(bases[0],null)
    assert.equal((await sender.recover(key,owner)).status,'NoChange')
    // A new logical subscription explicitly forgets its transport cursor; it does
    // not alter the application revision, Grant, source or canonical state.
    sender.unsubscribe(key);sender.subscribe(key);hold=true
    const lost=await sender.recover(key,owner);await lost.local
    assert.equal(acks,1);assert.equal(sender.cursor(key).lastConfirmed,null)
    const session=sender.sessionId,connection=sender.transport.connection.id
    sender.disconnect();receiver.disconnect();await assert.rejects(lost.peer,e=>e.outcome==='ConnectionClosed')
    hold=false;connect();assert.equal(sender.sessionId,session);assert.notEqual(sender.transport.connection.id,connection)
    await (await sender.recover(key,owner)).peer
    assert.deepEqual(received,[snapshot,snapshot,snapshot]);assert.equal(sender.cursor(key).lastConfirmed.revision,snapshot.revision)
    const fresh=new RealtimeEndpoint({onMessage:()=>{}}),consumer=new RealtimeEndpoint({onMessage:m=>assert.deepEqual(JSON.parse(m.payload),snapshot)})
    try{
      fresh.subscribe(key);consumer.subscribe(key);assert.notEqual(fresh.sessionId,sender.sessionId)
      const ab=new PassThrough(),ba=new PassThrough();fresh.connect(ba,ab,consumer.capabilities());consumer.connect(ab,ba,fresh.capabilities())
      await (await fresh.recover(key,owner)).peer;assert.equal(bases.at(-1),null)
      assert.equal(fresh.usage.pendingBytes,0)
    }finally{fresh.disconnect();consumer.disconnect()}
    assert.deepEqual(product.read(key),snapshot);assert.equal(sender.usage.pendingBytes,0)
    return {states:['Snapshot','NoChange','Reconnect','FreshSession','LostAck'],revision:snapshot.revision,bases,received:received.length}
  }finally{sender.disconnect();receiver.disconnect()}
}
