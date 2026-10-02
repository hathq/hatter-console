// Hatter downstream 2026: application projections over installed PP artifacts.
// No Graph/semantic retention implementation, renderer, provider execution or body fetching.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {ProjectionRuntime,ProducerRegistry,ExactSourceReader} from '@hathq/projection-runtime'
import {FileProjectionStore} from '@hathq/projection-runtime/store'
import {canonical} from '@hathq/projection-contracts'
import {SourceOwnerClient} from './source-owner-client.mjs'

const owners=['sem-lang','hatter/control','hatter/admission','hatter/execution']
const fail=code=>{throw Object.assign(Error(code),{code})}
const item=(source,id,value,semanticRef=null,provenance=[])=>({id:`${source.owner}:${source.ref}:${id}`,
  semanticRef,group:{kind:semanticRef?'semantic':'structural',ref:semanticRef??source.ref},
  value,evidence:[source.ref],provenance,resolutionRefs:[],visibility:'visible'})

// Hatter presentation mapping consumes sem-lang's resolved predicates. Neither
// field names nor source paths become semantic identities. Conflicts stay plural.
export function sourceProjection(source,body){
  const items=[],unresolved=[]
  if(source.owner==='sem-lang'){
    for(const claim of body.claims){
      const provenance=body.provenance.filter(p=>p.claimIds.includes(claim.id)).map(p=>p.packetId)
      items.push(item(source,claim.id,claim,claim.predicate,provenance))
    }
    for(const value of body.sources){
      items.push(item(source,value.sourceRef,value))
      if(value.resolution.reason!==null)unresolved.push({id:`${source.ref}:${value.sourceRef}:unresolved`,
        reason:value.resolution.reason,evidence:[value.sourceRef],contextRefs:[body.roleRef.id],actionRefs:[]})
    }
  }else if(source.owner==='hatter/control'){
    for(const record of body.records){
      items.push(item(source,record.reference.id??canonical(record.reference),record))
      if(record.kind==='continuation')for(const residual of record.value.remainingResiduals){
        unresolved.push({id:`${source.ref}:${residual.reference}`,reason:residual.reason,
          evidence:[source.ref,residual.reference],contextRefs:[record.reference.id],actionRefs:[]})
      }
      if(record.kind==='confirmation')unresolved.push({id:`${source.ref}:${record.reference.id}:resolution`,
        reason:'NeedsResolution',evidence:[source.ref],contextRefs:[record.reference.id],actionRefs:['inference/role/decide']})
    }
  }else items.push(item(source,body.invocationRef,body))
  return {source,items,relations:[],unresolved,truncated:body.truncated===true}
}

export class ProductProjections {
  #client; #store; #runtime; #registry; #producers; #directory; #sceneUsers=new Map()
  constructor(environment,options={}){
    if(!path.isAbsolute(environment.HATTER_HOME??''))fail('SourceUnavailable')
    this.#directory=path.join(environment.HATTER_HOME,'derived','projections')
    this.#client=new SourceOwnerClient(options)
    this.#store=new FileProjectionStore(this.#directory)
    this.#registry=new ProducerRegistry()
    this.#producers=Object.fromEntries(['subject','historical-subject','operation','activity'].map(id=>[
      id,this.#registry.register({id,kind:'data'})]))
    const reader=new ExactSourceReader(new Map(owners.map(owner=>[owner,{
      acquire:async(source,options)=>{
        if(options.accessRef!=='local-owner')fail('VisibilityDenied')
        return (await this.#client.call({operation:'acquire',source,holder:options.holder,
          durationMs:Math.min(60000,options.until-Date.now())},options)).generation
      },
      read:async(source,generation,options)=>{
        if(options.accessRef!=='local-owner')fail('VisibilityDenied')
        const result=await this.#client.call({operation:'read',source,holder:options.holder,generation},options)
        if(canonical(result.source)!==canonical(source))fail('SourceRevisionMismatch')
        return sourceProjection(source,result.body)
      },
      release:(generation,holder)=>this.#client.call({operation:'release',owner,holder,generation},{deadline:Date.now()+1000}),
      releaseHolder:holder=>this.#client.call({operation:'release',owner,holder},{deadline:Date.now()+1000}),
    }])))
    this.#runtime=new ProjectionRuntime({store:this.#store,registry:this.#registry,reader})
  }
  async startup(){
    // Explicit startup of THIS derived owner only. Canonical owner setup and
    // cross-owner retention reconciliation are not presentation dependencies.
    const parent=path.dirname(this.#directory)
    if(!fs.existsSync(parent))fs.mkdirSync(parent,{mode:0o700})
    if(!fs.lstatSync(parent).isDirectory()||fs.lstatSync(parent).isSymbolicLink())fail('ProjectionStoreCorrupt')
    if(!fs.existsSync(this.#directory))FileProjectionStore.create(this.#directory)
    return this.maintain()
  }
  provisionSourceOwners(options){return this.#client.call({operation:'provision'},options)}
  async maintain(options={}){
    const deadline=Date.now()+5000, results=[]
    for(const repair of this.#store.inspect().repairs){
      options.signal?.throwIfAborted()
      if(Date.now()>=deadline){results.push({id:repair.id,status:'deferred'});continue}
      try{
        if(repair.expiresAt<=Date.now())await this.#runtime.expire(repair.id)
        else await this.retry(repair.id,options)
        results.push({id:repair.id,status:'reconciled'})
      }catch(error){results.push({id:repair.id,status:error.code??'ProjectionUnavailable'})}
    }
    return results
  }
  describe(owner,reference,options){return this.#client.call({operation:'describe',owner,reference},options)}
  targets(knownHead=null,options){return this.#client.call({operation:'targets',maximumItems:32,knownHead},options)}
  operations(options){return this.#client.call({operation:'operations',maximumItems:32},options)}
  withPublicationMetadata(operation){return this.#store.withAttempt('product-publication-metadata',operation)}
  interaction(reference,options){return this.#client.call({operation:'describe',confirmationRef:reference},{...options,method:'interaction/execute'})}
  sourceInteraction(roleRef,options){return this.#client.call({operation:'sourceDescribe',roleRef},{...options,method:'interaction/execute'})}
  resolveProducer=null
  #sceneProducer({key,sources,focus,interaction,view='resolution'}){
    const subject=view==='subject'
    const id=view+':'+createHash('sha256').update(canonical({key,sources,focus,interaction:interaction??null})).digest('hex')
    const actions=interaction===null?[]:[{id:subject?'edit-source':'review-confirmation',targetOwner:'hatter',
      commandRef:subject?'digital-twin/contribution/apply':'inference/role/decide',contextRefs:[focus],sourceRefs:sources,label:subject?'Edit source':'Review confirmation',
      ...(interaction?{interaction}:{})}]
    if(!this.#producers[id])this.#producers[id]=this.#registry.register({id,kind:'scene',configuration:{
      key,focus,purpose:view,regions:[],actions}})
    return this.#producers[id]
  }
  submit(view,{key,sources,focus,signal,id,interaction}){
    if(!['subject','historical-subject','operation','resolution','activity'].includes(view))fail('ProjectionProducerUnavailable')
    const isScene=view==='resolution'||view==='subject'&&interaction!=null
    const producer=isScene?this.#sceneProducer({key,sources,focus,interaction,view}):this.#producers[view]
    const execute=()=>this.#runtime.submit({key,sources,focus,purpose:view,producer,visibilityRef:'local-owner',limits:{}},
      {accessRef:'local-owner',signal,id})
    return isScene?this.#withScene(producer,execute):execute()
  }
  async #withScene(producer,execute){
    this.#sceneUsers.set(producer.id,(this.#sceneUsers.get(producer.id)??0)+1)
    try{return await execute()}finally{
      const count=this.#sceneUsers.get(producer.id)-1
      if(count)this.#sceneUsers.set(producer.id,count)
      else {this.#sceneUsers.delete(producer.id);this.#registry.unregister(producer);delete this.#producers[producer.id]}
    }
  }
  read(key,revision=null){return this.#store.read(key,revision)}
  inspect(){return this.#runtime.inspect()}
  watch(onChange){return this.#store.watch(onChange)}
  retry(id,options={}){
    const repair=this.#store.repair(id)
    const configuration=repair?this.resolveProducer?.(id):null
    return repair&&(repair.request.purpose==='resolution'||repair.request.purpose==='subject'&&configuration?.interaction)
      ?this.#withScene(this.#sceneProducer({...repair.request,view:repair.request.purpose,...configuration}),()=>this.#runtime.retry(id,options))
      :this.#runtime.retry(id,options)
  }
  expire(id){return this.#runtime.expire(id)}
  recoverState(input){return this.#runtime.recoverState(input)}
  async close(){await this.#runtime.close();await this.#client.close()}
}
