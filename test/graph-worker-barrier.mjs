// Hatter 2026: external debugger barrier on the REAL installed PP worker.
// Test launch only, loopback ephemeral endpoint, no evaluation or source hooks.
import assert from 'node:assert/strict'

export async function workerBarrier(url){
 assert.match(url,/^ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+$/)
 const socket=new WebSocket(url),pending=new Map(),workers=[]
 let sequence=0,waiter=null
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.close();reject(Error('inspector connect deadline'))},3000)
  socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true})
  socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('inspector connection failed'))},{once:true})
 })
 socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data)
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer)
   if(message.error)request.reject(Error(JSON.stringify(message.error)));else request.resolve(message.result)
  }else if(message.method==='NodeWorker.attachedToWorker'){
   workers.push(message.params)
   if(waiter){const resolve=waiter;waiter=null;resolve(message.params)}
  }
 })
 const command=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('inspector command deadline: '+method))},3000)
  pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))
 })
 await command('NodeWorker.enable',{waitForDebuggerOnStart:true})
 return {
  async wait(timeout){
   const worker=workers[0]??await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{waiter=null;reject(Error('actual PP worker did not start'))},timeout)
    waiter=value=>{clearTimeout(timer);resolve(value)}
   })
   assert.equal(worker.waitingForDebugger,true)
   assert.match(worker.workerInfo.url,/\/producer-worker\.mjs$/)
   return worker
  },
  async close(){
   for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('inspector closed'))}pending.clear()
   if(socket.readyState===WebSocket.CLOSED)return
   await new Promise(resolve=>{const timer=setTimeout(resolve,1000);socket.addEventListener('close',()=>{clearTimeout(timer);resolve()},{once:true});socket.close()})
  },
 }
}
