// Hatter 2026: borrow the Supervisor's exact Management endpoint. Never spawn,
// restart, drain or stop a process, and never replay an application request.
import { connect } from 'node:net'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { FrameDecoder, LogicalSession, TransportError, encodeJson, limitsFor } from '@crowsi/transport-foundation'
import { JsonlChannel, transportFailure } from './jsonl-channel.mjs'
import { requireClientMethod } from './rpc-policy.mjs'

const limits = limitsFor(4096, {pendingMessages:1, pendingBytes:4098})
const invalid = () => transportFailure(new TransportError('ProtocolViolation'))
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...names].sort())
function exactEndpoint(text) {
  if(typeof text !== 'string' || Buffer.byteLength(text)>16384)throw invalid()
  const endpoint=JSON.parse(text)
  if(!keys(endpoint,['path','process']) || !isAbsolute(endpoint.path??'')
    || !keys(endpoint.process,['owner_ref','incarnation','protocol_generation','executable_identity']))throw invalid()
  const reference=endpoint.process
  if(typeof reference.owner_ref!=='string' || Buffer.byteLength(reference.owner_ref)>512
    || !reference.owner_ref.length || /[\u0000-\u0020\u007f]/u.test(reference.owner_ref))throw invalid()
  for(const name of ['incarnation','protocol_generation','executable_identity']) {
    const bytes=reference[name]
    if(!Array.isArray(bytes)||bytes.length!==32||!bytes.some(value=>value!==0)
      ||!bytes.every(value=>Number.isInteger(value)&&value>=0&&value<=255))throw invalid()
  }
  return endpoint
}
function verifyHandshake(value, expected) {
  if(!keys(value,['process','owner_type','availability']) || value.owner_type!=='Management'
    || !isDeepStrictEqual(value.process,expected)
    || !keys(value.availability,['process_alive','transport_available','owner_ready','domain_dispatch_available'])
    || value.availability.process_alive!==true || value.availability.transport_available!==true
    || value.availability.owner_ready!=='Ready' || value.availability.domain_dispatch_available!==true)throw invalid()
}

export class ManagementConnection {
  constructor({environment=process.env,onNotification,onServerRequest,onExit=()=>{}}={}) {
    this.environment=environment;this.onNotification=onNotification;this.onServerRequest=onServerRequest;this.onExit=onExit
    this.session=new LogicalSession();this.starting=null;this.channel=null;this.socket=null;this.closed=false
  }
  get running(){return Boolean(this.socket&&!this.socket.destroyed&&!this.channel?.closed)}
  async request(method,params={}){requireClientMethod(method);return(await this.start()).request(method,params)}
  start(){
    if(this.closed)return Promise.reject(transportFailure(new TransportError('ConnectionClosed')))
    if(this.channel&&!this.channel.closed)return Promise.resolve(this.channel)
    this.starting??=this.startOnce().finally(()=>{this.starting=null})
    return this.starting
  }
  async startOnce(){
    const endpoint=exactEndpoint(this.environment.HATTER_MANAGEMENT_ENDPOINT)
    const parent=dirname(endpoint.path)
    const [directory,entry,physical]=await Promise.all([lstat(parent),lstat(endpoint.path),realpath(parent)])
    if(!directory.isDirectory()||directory.isSymbolicLink()||physical!==parent||(directory.mode&0o077)!==0
      ||directory.uid!==process.getuid?.()||!entry.isSocket()||entry.isSymbolicLink()||entry.uid!==directory.uid)throw invalid()
    if(this.closed)throw transportFailure(new TransportError('ConnectionClosed'))
    const socket=connect({path:endpoint.path});this.socket=socket
    socket.once('close',()=>{if(this.socket===socket)this.onExit()})
    try{
      const channel=await new Promise((resolve,reject)=>{
        const decoder=new FrameDecoder(limits)
        let channel=null,settled=false
        const cleanup=()=>{clearTimeout(timer);socket.off('data',data);socket.off('error',failed);socket.off('close',closed)}
        const failed=()=>finish(transportFailure(new TransportError('ConnectionFailed')))
        const closed=()=>finish(transportFailure(new TransportError('ConnectionClosed')))
        const finish=error=>{if(settled)return;settled=true;cleanup();if(error){socket.destroy();reject(error)}else resolve(channel)}
        const timer=setTimeout(()=>finish(transportFailure(new TransportError('Timeout'))),2000)
        const data=chunk=>{
          try{
            const before=decoder.metrics.bytesConsumed
            decoder.feed(chunk,frame=>{
              verifyHandshake(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame.payload)),endpoint.process)
              channel=new JsonlChannel(socket,socket,{session:this.session,onNotification:this.onNotification,
                onServerRequest:request=>{if(this.onServerRequest)this.onServerRequest(request,channel);else channel.reject(request.id)}})
              return false
            })
            if(channel){
              // Crowsi reports exactly how far it consumed. Preserve the tail
              // when hello and an application notification share one OS packet.
              const consumed=decoder.metrics.bytesConsumed-before
              cleanup();channel.consume(chunk.subarray(consumed));finish()
            }
          }catch(error){channel?.fail(error);finish(error instanceof TransportError?transportFailure(error):invalid())}
        }
        socket.on('data',data);socket.once('error',failed);socket.once('close',closed)
        socket.once('connect',()=>{try{socket.write(encodeJson({expected:endpoint.process,owner_type:'Management'},limits))}catch(error){finish(error)}})
      })
      this.channel=channel
      await channel.request('initialize',{clientInfo:{name:'hatter_management_console',title:'Hatter Console',version:'0.10.0'},
        capabilities:{experimentalApi:false}})
      channel.notify('initialized',{})
      return channel
    }catch(error){this.channel?.fail(error);socket.destroy();if(this.socket===socket){this.channel=null;this.socket=null}throw error}
  }
  async close(){
    this.closed=true;this.channel?.fail('hatter-app-server-stopped');this.socket?.destroy()
    await this.starting?.catch(()=>{})
    this.channel=null;this.socket=null
  }
}
