// Hatter product relevance/trigger metadata only. Canonical receipts recover
// missed triggers; PP retains exclusive ownership of accepted publication repair.
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {canonical} from '@hathq/projection-contracts'
import {validateInputDeclaration} from '@zixcel/interaction/input'
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex')
const fail=code=>{throw Object.assign(Error(code),{code})}
const equal=(a,b)=>canonical(a)===canonical(b)
export const publicationBounds=Object.freeze({keys:8,pending:8,perKey:1,concurrent:1,batch:1,scanMs:5000,attemptMs:5000,cycleMs:10000,intervalMs:1000,metadataBytes:131072})
const shape=(v,required,optional=[])=>v!==null&&typeof v==='object'&&!Array.isArray(v)
  &&Object.getPrototypeOf(v)===Object.prototype&&required.every(k=>Object.hasOwn(v,k))
  &&Object.keys(v).every(k=>required.includes(k)||optional.includes(k))
const ref=v=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=512&&v.isWellFormed()&&!/[\x00-\x1f\x7f]/u.test(v)
function validMetadata(state){
  if(!shape(state,['selected','streams'])||!Array.isArray(state.streams)||state.streams.length>publicationBounds.keys
    ||new Set(state.streams.map(s=>s?.key)).size!==state.streams.length)return false
  if(state.selected!==null&&(!shape(state.selected,['roleId','subjectRef'])||!ref(state.selected.roleId)
    ||!shape(state.selected.subjectRef,['id','class'])||!ref(state.selected.subjectRef.id)||!ref(state.selected.subjectRef.class)))return false
  return state.streams.every(s=>{
    if(!shape(s,['key','view','target','roleId','intent','status'])||!['subject','resolution','operation','activity'].includes(s.view)
      ||!ref(s.target)||(s.view==='activity'?s.roleId!==null:!ref(s.roleId))||s.key!=='product:'+hash({view:s.view,target:s.target}))return false
    if(s.intent===null)return s.status===null
    const i=s.intent
    if(!shape(i,['view','key','sources','focus','interaction','canonicalReceipt','id'])||i.view!==s.view||i.key!==s.key
      ||i.focus!==s.target||!ref(i.canonicalReceipt)||!Array.isArray(i.sources)||i.sources.length<1||i.sources.length>4
      ||i.sources.some(source=>!shape(source,['owner','ref','revision','kind'])||Object.values(source).some(v=>!ref(v))
        ||!['sem-lang','hatter/control','hatter/admission','hatter/execution'].includes(source.owner)))return false
    if(i.interaction!==null){
      const d=i.interaction
      if(!['resolution','subject'].includes(s.view)||!shape(d,['ref','generation','inputContractRef','input'])||!ref(d.ref)||!ref(d.generation)
        ||!ref(d.inputContractRef)||validateInputDeclaration(d.input).length||d.inputContractRef!==d.input.action.contract_revision
        ||s.view==='resolution'&&d.input.action.operation_id!=='inference/role/decide')return false
    }
    const {id,...specification}=i
    if(id!=='trigger:'+hash(specification))return false
    const status=s.status
    return shape(status,['state'],['code','revision','canonicalReceipt'])
      &&['Published','Pending','FailedTyped'].includes(status.state)
      &&Object.entries(status).every(([k,v])=>k==='state'||ref(v))
      &&(status.state!=='Published'||ref(status.revision)&&status.canonicalReceipt===i.canonicalReceipt)
  })
}
function readMetadata(file){
  let fd
  try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
    const stat=fs.fstatSync(fd)
    if(!stat.isFile()||stat.size>publicationBounds.metadataBytes)fail('ProjectionStoreCorrupt')
    // Read one extra byte so a concurrent extension is bounded and rejected.
    const bytes=Buffer.alloc(publicationBounds.metadataBytes+1),size=fs.readSync(fd,bytes,0,bytes.length,0)
    if(size>publicationBounds.metadataBytes)fail('ProjectionStoreCorrupt')
    const state=JSON.parse(bytes.subarray(0,size).toString('utf8'))
    if(!validMetadata(state))fail('ProjectionStoreCorrupt')
    return state
  }catch(error){if(error.code==='ENOENT')return null;fail('ProjectionStoreCorrupt')}
  finally{if(fd!==undefined)fs.closeSync(fd)}
}

export class ProductPublication {
  #product;#file;#state={selected:null,streams:[]};#diskHash=null;#inventory=null;#head=null;#running=null;#timer=null;#closed=false;#selecting=false;#lastAttempt=null
  #ownerFailures=new Map()
  // Cancels disposable reads/projection attempts only, never canonical Work.
  #lifetime=new AbortController()
  constructor(product,home){
    this.#product=product;this.#file=path.join(home,'derived','product-publication.json')
    const state=readMetadata(this.#file)
    if(state!==null){
      this.#state=state
      this.#diskHash=hash(this.#state)
    }
    product.resolveProducer=id=>{
      const stream=this.#state.streams.find(s=>s.intent?.id===id)
      if(!stream)fail('ProjectionProducerUnavailable')
      return {interaction:stream.intent.interaction}
    }
  }
  async #save(){return this.#product.withPublicationMetadata(()=>{
    // Reuse PP's existing kernel-backed exclusion for this short metadata CAS,
    // never hold it across a PP attempt or owner call. Multiple Console processes
    // cannot silently overwrite a live producer definition or selection.
    const actual=readMetadata(this.#file)
    const actualHash=actual===null?null:hash(actual)
    if(actualHash!==this.#diskHash){this.#state=actual??{selected:null,streams:[]};this.#diskHash=actualHash;fail('ProjectionStoreBusy')}
    if(!validMetadata(this.#state))fail('ProjectionStoreCorrupt')
    const bytes=canonical(this.#state,publicationBounds.metadataBytes),temporary=this.#file+'.'+randomUUID()+'.tmp'
    let fd
    try{
      fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined
      fs.renameSync(temporary,this.#file)
      const directory=fs.openSync(path.dirname(this.#file),'r');try{fs.fsyncSync(directory)}finally{fs.closeSync(directory)}
      this.#diskHash=hash(this.#state)
    }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
  })}
  async #targets(deadline){
    const value=await this.#product.targets(this.#inventory?this.#head:null,{deadline,signal:this.#lifetime.signal})
    if(value.targets!==null){this.#inventory=value.targets;this.#head=value.head.commit}
    if(!this.#inventory)fail('SourceUnavailable')
    return this.#inventory
  }
  async candidates(){return (await this.#product.targets()).targets.filter(t=>t.kind==='subject').map(t=>({roleRef:t.roleRef,subjectRef:t.subjectRef,
    availability:t.receiptRef?'Available':'SourceUnavailable'}))}
  async select(reference){
    if(this.#closed)fail('ProjectionRuntimeClosed')
    if(this.#selecting)fail('ProjectionQueueFull')
    this.#selecting=true
    try{
      if(this.#running)await this.#running
      const targets=await this.#product.targets(),target=targets.targets.find(t=>t.kind==='subject'&&equal(t.roleRef,reference))
      if(!target)fail('StaleSceneAction')
      if(!target.receiptRef)fail('SourceUnavailable')
      this.#inventory=targets.targets;this.#head=targets.head.commit
      const previous=this.#state.selected
      this.#state.selected={roleId:target.roleRef.id,subjectRef:target.subjectRef}
      // Capacity failure is a rejected selection, not a secretly persisted new
      // subject. Allocate its bounded metadata slot before the selection CAS.
      try{this.#stream('subject',target.roleRef.id,target.roleRef.id)}
      catch(error){this.#state.selected=previous;throw error}
      // Selection is durable BEFORE any command is made available in its Scene.
      // A canonical commit-before-trigger crash can therefore reconcile it.
      await this.#save()
      // Selection is persisted; HTTP acknowledges that exact selection without
      // waiting for a disposable projection producer. The existing bounded
      // reconciliation loop reads this intent, including after restart.
      return {key:this.#key('subject',target.roleRef.id),projection:{state:'Pending'}}
    }finally{this.#selecting=false}
  }
  #key(view,target){return 'product:'+hash({view,target})}
  #stream(view,target,roleId){
    const key=this.#key(view,target)
    let stream=this.#state.streams.find(s=>s.key===key)
    if(!stream){
      if(this.#state.streams.length>=publicationBounds.keys){
        const repairs=this.#product.inspect().store.repairs
        const retired=this.#state.streams.findIndex(s=>s.status?.state==='Published'
          &&s.view!=='activity'&&(s.roleId!==this.#state.selected?.roleId||s.view==='resolution'&&s.intent?.interaction===null)
          &&!repairs.some(r=>r.id===s.intent.id))
        if(retired<0)fail('ProjectionLimitExceeded')
        // Drop only redundant trigger metadata for a closed, fully published
        // confirmation. Historical snapshots and retention stay owned by PP.
        this.#state.streams.splice(retired,1)
      }
      stream={key,view,target,roleId,intent:null,status:null};this.#state.streams.push(stream)
    }
    return stream
  }
  async #optional(owner,operation,read,deadline){
    const requirementRef='hatter:'+operation
    try{
      const value=await read({deadline:Math.min(deadline,Date.now()+750),signal:this.#lifetime.signal})
      this.#ownerFailures.delete(requirementRef)
      return {available:true,value}
    }catch(error){
      if(this.#lifetime.signal.aborted)throw this.#lifetime.signal.reason
      // An unavailable owner is not an empty successful inventory. Preserve the
      // bounded owner response for readiness while unrelated streams progress.
      this.#ownerFailures.set(requirementRef,{owner,operation,requirementRef,
        code:error.code??'SourceUnavailable',failure:error.failure??null})
      return {available:false}
    }
  }
  async #plan(deadline){
    const targets=await this.#targets(deadline),selected=this.#state.selected
    const subject=selected?targets.find(t=>t.kind==='subject'&&t.roleRef.id===selected.roleId&&equal(t.subjectRef,selected.subjectRef)):null
    if(selected&&!subject?.receiptRef)fail('SourceUnavailable')
    const current=selected?targets.filter(t=>t.kind==='resolution'&&t.roleRef.id===selected.roleId&&equal(t.subjectRef,selected.subjectRef)):[]
    const execution=selected?await this.#optional('hatter/execution','operations',options=>this.#product.operations(options),deadline):{available:false}
    const operations=execution.available?execution.value.targets.filter(t=>t.roleRef.id===selected.roleId):[]
    const selectedStreams=selected?[this.#stream('subject',selected.roleId,selected.roleId),...current.map(t=>this.#stream('resolution',t.confirmationRef.id,selected.roleId))]:[]
    selectedStreams.push(...operations.map(t=>this.#stream('operation',t.invocationRef,selected.roleId)))
    // Activity is the exact shared scheduler image, not another Role, queue or
    // result store. Its entries retain their actual accepted Role/Scope refs.
    const activity=targets.find(t=>t.kind==='activity')
    if(activity){if(!activity.receiptRef)fail('SourceUnavailable');selectedStreams.push(this.#stream('activity','scheduler',null))}
    // Previously visible confirmations are closed using the updated exact Role
    // source. Their old input never remains enabled after a canonical decision.
    for(const stream of this.#state.streams.filter(s=>s.view==='resolution'&&s.roleId===selected?.roleId))if(!selectedStreams.includes(stream))selectedStreams.push(stream)
    const planned=[]
    for(const stream of selectedStreams){
      this.#lifetime.signal.throwIfAborted()
      if(Date.now()>=deadline)break
      const confirmation=current.find(t=>t.confirmationRef.id===stream.target)
      const operation=operations.find(t=>t.invocationRef===stream.target)
      const target=stream.view==='activity'?activity:confirmation??subject
      const sources=operation?[...operation.sources]:[]
      if(!operation)for(const owner of confirmation||stream.view==='activity'?['hatter/control']:['sem-lang','hatter/control'])sources.push(await this.#product.describe(owner,target.receiptRef,{deadline,signal:this.#lifetime.signal}))
      let interaction=null
      if(confirmation){
        const d=await this.#product.interaction(confirmation.confirmationRef,{deadline,signal:this.#lifetime.signal})
        interaction={ref:canonical(d.interactionRef),generation:d.generation,inputContractRef:d.inputContractRef,input:d.input}
      }
      if(stream.view==='subject'){
        const observed=await this.#optional('hatter/input','sourceDescribe',options=>this.#product.sourceInteraction(subject.roleRef,options),deadline)
        const d=observed.available?observed.value:null
        if(d)interaction={ref:d.interactionRef,generation:d.generation,inputContractRef:d.inputContractRef,input:d.input}
      }
      const specification={view:stream.view,key:stream.key,sources,focus:stream.target,interaction,canonicalReceipt:operation?.invocationRef??target.receiptRef}
      const id='trigger:'+hash(specification)
      const existing=this.#product.read(stream.key)
      if(stream.intent?.id===id&&existing&&equal(existing.lineage.sources.map(s=>canonical(s)).sort(),sources.map(s=>canonical(s)).sort())&&stream.status?.state==='Published')continue
      if(stream.intent?.id===id&&stream.status?.state==='FailedTyped')continue
      if(stream.intent?.id!==id){
        // Never overwrite a repair's producer definition. PP completes/expires
        // the old attempt before a newer exact stream request is installed.
        if(stream.intent&&this.#product.inspect().store.repairs.some(r=>r.id===stream.intent.id))continue
        stream.intent={...specification,id};stream.status={state:'Pending'};await this.#save()
      }
      planned.push(stream)
    }
    return planned
  }
  reconcile(){
    if(this.#closed)return Promise.reject(Object.assign(Error('ProjectionRuntimeClosed'),{code:'ProjectionRuntimeClosed'}))
    return this.#running??=(async()=>{
      const started=Date.now(),deadline=started+publicationBounds.scanMs,cycleDeadline=started+publicationBounds.cycleMs
      await this.#product.maintain({signal:this.#lifetime.signal})
      this.#lifetime.signal.throwIfAborted()
      const streams=await this.#plan(deadline),results=[]
      // A repeatedly unavailable key must not starve independent projections.
      // The cursor is scheduling only, never persisted semantic/repair authority.
      const ordered=[...streams].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)
      const next=this.#lastAttempt?(ordered.find(s=>s.key>this.#lastAttempt)??ordered[0]):streams[0]
      for(const stream of next?[next]:[]){
        this.#lifetime.signal.throwIfAborted()
        if(Date.now()>=deadline){results.push({key:stream.key,state:'Pending'});continue}
        this.#lastAttempt=stream.key
        try{
          const intent=stream.intent
          const value=await this.#product.submit(intent.view,{...intent,signal:AbortSignal.any([this.#lifetime.signal,AbortSignal.timeout(Math.max(1,Math.min(publicationBounds.attemptMs,cycleDeadline-Date.now())))])})
          stream.status={state:'Published',revision:value.snapshot.revision,canonicalReceipt:intent.canonicalReceipt}
        }catch(error){
          const retry=['ProjectionExecutionTimeout','ProjectionCancelled','ProjectionStoreBusy','ProjectionQueueFull'].includes(error.code)
          stream.status={state:retry||this.#product.inspect().store.repairs.some(r=>r.id===stream.intent.id)?'Pending':'FailedTyped',code:error.code??'ProjectionUnavailable'}
        }
        await this.#save();results.push({key:stream.key,...stream.status})
      }
      const statuses=this.#state.streams.filter(s=>s.view==='activity'||s.roleId===this.#state.selected?.roleId).map(s=>({key:s.key,state:'Pending',...s.status}))
      return {state:statuses.some(r=>r.state==='FailedTyped')?'FailedTyped':Date.now()>=cycleDeadline||statuses.some(r=>r.state==='Pending')?'Pending':'Published',streams:statuses}
    })().finally(()=>{this.#running=null})
  }
  async afterCanonical(){
    // An in-flight scan may have read the head BEFORE the command committed.
    // Join it, then require a fresh owner read; never replay the owner command.
    if(this.#running)await this.#running.catch(()=>{})
    return this.reconcile()
  }
  async recover(key){
    // Explicit derived-state maintenance only. The client cannot supply sources,
    // producer configuration or canonical commands. Reuse PP's existing repair.
    if(this.#closed)fail('ProjectionRuntimeClosed')
    if(!this.#state.streams.some(s=>s.key===key&&(s.view==='activity'||s.roleId===this.#state.selected?.roleId)))fail('SceneUnavailable')
    if(this.#running)await this.#running.catch(()=>{})
    const stream=this.#state.streams.find(s=>s.key===key&&(s.view==='activity'||s.roleId===this.#state.selected?.roleId))
    if(!stream)fail('SceneUnavailable')
    if(stream.status?.state==='FailedTyped'){
      // Explicit derived retry changes only trigger status. Keep the original
      // producer input; PP still owns any existing repair and canonical owners
      // are never re-invoked. Background reconciliation survives HTTP loss.
      stream.status={state:'Pending'};await this.#save()
    }
    return {key,projection:{state:'Pending'}}
  }
  onObservation=null
  start(onFailure){
    const tick=async()=>{
      if(this.#closed)return
      try{await this.reconcile()}catch(error){if(!this.#closed)onFailure(error)}
      if(!this.#closed){try{this.onObservation?.()}catch{};this.#timer=setTimeout(tick,publicationBounds.intervalMs);this.#timer.unref?.()}
    }
    if(!this.#timer&&!this.#closed){this.#timer=setTimeout(tick,publicationBounds.intervalMs);this.#timer.unref?.()}
  }
  // Expose only the declared role/view relationship, never private producer intents.
  inspect(){return {selected:this.#state.selected,streams:this.#state.streams.map(({key,view,roleId,status})=>({key,view,roleId,status})),ownerFailures:[...this.#ownerFailures.values()],running:Boolean(this.#running),bounds:publicationBounds}}
  async close(){
    this.#closed=true;clearTimeout(this.#timer)
    this.#lifetime.abort(Object.assign(Error('ProjectionCancelled'),{code:'ProjectionCancelled'}))
    if(this.#running)await this.#running.catch(()=>{})
  }
}
