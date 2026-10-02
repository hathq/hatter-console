// Hatter 2026: real Chromium HTTP behavior; controlled owner, not Graph acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from '@playwright/test'
import {createDeliveryServer} from '@hathq/delivery-server'

test('Chromium receives uncertain timeout, never retransmits POST, and late owner commit retains original identity', {timeout:15000},async()=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 const origin='http://127.0.0.1:'+port,bytes=Buffer.from('/* trusted fixture */'),received=[],outcomes=[],failures=[]
 const receiptRef='d'.repeat(64);let calls=0,effects=0
 const server=createDeliveryServer({origin,assets:[{path:'/assets/fixture.js',bytes,bytesLength:bytes.length,kind:'script',digest:createHash('sha256').update(bytes).digest('hex')}],
  onFailure:v=>failures.push(v),onOutcome:v=>outcomes.push(v),site:{
   document:async(_url,{assets})=>({envelope:{contract:'hatter/delivery/1',site:{id:'test:site',revision:'a'.repeat(64)},initial:null,snapshot:null,
    readiness:{state:'Ready',requirements:[]},assets,transport:{path:'/api/projection-live',classes:['STATE']}},bootstrap:{}}),
   async command(){calls++;await delay(5200);effects++;return {canonical:{state:'Accepted',receiptRef}}}
  }})
 server.server.on('request',request=>{if(request.url==='/api/action')received.push(request.headers['x-hatter-request-nonce'])})
 await server.listen();const browser=await chromium.launch({headless:true})
 try{
  const page=await browser.newPage();await page.goto(origin)
  const result=await page.evaluate(async()=>{
   const {csrf}=await fetch('/api/connection',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json())
   const nonce=crypto.randomUUID(),response=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json','x-hatter-csrf':csrf,'x-hatter-request-nonce':nonce},body:'{}'})
   return {nonce,status:response.status,value:await response.json()}
  })
  assert.equal(result.status,504)
  assert.equal(result.value.error.code,'DeliveryTimedOut')
  assert.deepEqual(result.value.error.canonical,{state:'Unknown',receiptRef:null})
  for(let n=0;n<200&&server.inspect().activeRequests;n++)await delay(5)
  assert.deepEqual(received,[result.nonce]);assert.equal(calls,1);assert.equal(effects,1)
  const original=outcomes.find(v=>v.requestRef===result.value.error.ownerFailure.requestRef)
  assert.equal(original.stage,'OWNER_COMMITTED');assert.equal(original.receiptRef,receiptRef);assert.equal(original.httpStatus,504)
  assert.deepEqual(failures,[result.value.error])
  console.log(JSON.stringify({status:result.status,received:received.length,calls,effects,original}))
 }finally{await browser.close();await server.close()}
})
