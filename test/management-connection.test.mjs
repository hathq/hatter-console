// Hatter 2026: bounded physical handshake and borrowed connection custody.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { ManagementConnection } from '../server/lib/management-connection.mjs'

test('exact owner admission, coalesced notification, reconnect, invalid identity and connection disposal never own a process', async t=>{
  const root=await mkdtemp(join(tmpdir(),'hatter-management-peer-'))
  const path=join(root,'m.sock')
  const reference={owner_ref:'hatter/management',incarnation:Array(32).fill(1),protocol_generation:Array(32).fill(2),executable_identity:Array(32).fill(3)}
  let mode='valid',hellos=0,requests=0
  const sockets=new Set()
  const server=createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket))
    let pending='',hello=false
    socket.on('data',chunk=>{
      pending+=chunk
      while(pending.includes('\n')){
        const at=pending.indexOf('\n'),value=JSON.parse(pending.slice(0,at));pending=pending.slice(at+1)
        if(!hello){
          hello=true;hellos++;assert.deepEqual(value,{expected:reference,owner_type:'Management'})
          if(mode==='hold')continue
          if(mode==='oversize'){socket.write('x'.repeat(8192));continue}
          const process=mode==='stale'?{...reference,incarnation:Array(32).fill(9)}:reference
          socket.write(JSON.stringify({process,owner_type:'Management',availability:{process_alive:true,transport_available:true,owner_ready:'Ready',domain_dispatch_available:true}})+'\n'
            +JSON.stringify({method:'large-notice',params:{value:'x'.repeat(8192)}})+'\n')
        }else if(value.id){requests++;socket.write(JSON.stringify({id:value.id,result:{method:value.method,params:value.params}})+'\n')}
      }
    })
  })
  server.listen(path);await once(server,'listening')
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})})
  const environment={HATTER_MANAGEMENT_ENDPOINT:JSON.stringify({path,process:reference})}
  for(let repeat=0;repeat<2;repeat++){
    const notifications=[]
    const connection=new ManagementConnection({environment,onNotification:value=>notifications.push(value)})
    const [first,second]=await Promise.all([connection.start(),connection.start()])
    assert.equal(first,second,'coalesced start has one exact transport')
    assert.deepEqual(notifications,[{method:'large-notice',params:{value:'x'.repeat(8192)}}])
    assert.deepEqual(await connection.request('inference/role/list',{maximumItems:16}),{method:'inference/role/list',params:{maximumItems:16}})
    await connection.close();assert.equal(connection.running,false);assert.equal(first.closed,true)
    await assert.rejects(connection.start(),error=>error.failure.parameters.transport==='ConnectionClosed')
    assert.equal(server.listening,true,'closing an observer never stops its owner')
  }
  assert.equal(hellos,2);assert.equal(requests,4)
  for(mode of ['stale','oversize']){
    const connection=new ManagementConnection({environment})
    await assert.rejects(connection.start());await connection.close()
    assert.equal(requests,4,'failed physical handshake cannot send initialize or another RPC')
  }
  const invalid=new ManagementConnection({environment:{HATTER_MANAGEMENT_ENDPOINT:JSON.stringify({path,process:{...reference,extra:true}})}})
  await assert.rejects(invalid.start());await invalid.close();assert.equal(hellos,4)
})
