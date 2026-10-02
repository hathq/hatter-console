// Hatter downstream 2026: site policy only. PP owns projection truth, source
// owners own readiness/setup, Crowsi owns transport, delivery owns no semantics.
import {createHash} from 'node:crypto'
import {memoryTimeline} from '../shared/memory-timeline.mjs'
import {readScene,sceneFailure} from '../server/runtime/scene-input.mjs'
import {submitInteraction,ownerCommandFailure} from '../server/runtime/product-interactions.mjs'
import {HatterRuntime} from '../server/runtime/hatter-runtime.mjs'
import {projectionIdentity} from '@hathq/projection-client'
import {readiness,inputAction,validateSubmission} from '@hathq/delivery-contracts'
import {observeCatalog} from '@hathq/ihat-store-source'
import {createStore,packageReference} from '@hathq/ihat-store-core'
import {storeScene} from '@hathq/ihat-store-scenes'
import {catalogActions,submitCatalogSettings} from './catalog-settings.mjs'
import {semanticInspection} from './semantic-inspection.mjs'
import {conversationViews} from './role-conversation.mjs'
import {gardenReader} from './garden-roster.mjs'
import {inferenceObservation} from './inference-observation.mjs'
import {feedbackPreparation} from './role-preparation.mjs'
const bad=()=>{throw Object.assign(Error('InvalidInput'),{code:'InvalidInput'})}
const object=(value,keys)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(k=>!keys.includes(k)))bad()}
// The browser selects a registered World by opaque id; the host-local
// HATTER_HOME path is an owner detail, not a presentation or authority token.
export function worldChoices(index){
 return {schema:index.schema,active:index.active,mounted:index.mounted,receiptRef:index.receiptRef,
  worlds:index.worlds.map(({id,name})=>({id,name})),availability:index.availability}
}
const storageSetup=[
 {id:'hatter:storage:control',owner:'hatter/control',label:'Prepare control storage'},
 {id:'hatter:storage:admission',owner:'hatter/admission',label:'Prepare HAT storage'},
 {id:'hatter:storage:semantic',owner:'sem-lang',label:'Prepare semantic storage'}
]
// Share only in-flight equal observations. Never cache success/failure or merge
// an explicit external catalog verification into a passive local observation.
export function documentReadKey(url,live=false){return (url.pathname==='/store'&&!live?'verify:':'observe:')+url.pathname+url.search}
export function shareDocumentRead(reads,key,produce){
 const current=reads.get(key);if(current)return current
 if(reads.size>=8)return Promise.reject(Object.assign(Error('ProjectionQueueFull'),{code:'ProjectionQueueFull'}))
 const pending=Promise.resolve().then(produce).finally(()=>{if(reads.get(key)===pending)reads.delete(key)})
 reads.set(key,pending);return pending
}
export function requirement(owner,operation,error,setup=null){
 const ref='hatter:'+operation,original=error?.failure
 // Rust's bounded parameters are JSON strings, not nested JS objects. Only an
 // exact missing-owner fact may expose explicit setup; never infer from text.
 let missing=false
 try{const record=JSON.parse(original?.parameters?.sourceRecord)
  missing=record!==null&&typeof record==='object'&&!Array.isArray(record)
   &&Object.keys(record).length===1&&record.Io==='NotFound'
 }catch{}
 if(original?.parameters?.ownerFailure){
  const single=(value,key)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
   &&Object.keys(value).length===1&&Object.hasOwn(value,key)
  try{const record=JSON.parse(original.parameters.ownerFailure)
   missing=single(record,'Unavailable')&&record.Unavailable==='Missing'
    ||single(record,'Source')&&single(record.Source,'Storage')&&record.Source.Storage==='NotFound'
   if(setup&&single(record,'Unavailable')&&record.Unavailable==='Missing'){
    const target=storageSetup.find(s=>s.owner===(original.parameters.sourceOwner??owner))
    setup=target?{id:target.id,owner:target.owner,operation:'initialize'}:null
   }
  }catch{missing=false}
 }
 return {ref,owner,state:error?(missing&&setup?'SetupRequired':'Unavailable'):'Ready',
  failure:error?{owner,operation,code:original?.code??error.code??'SourceUnavailable',requirementRef:ref,detail:original??null}:null,
  setup:error&&missing?setup:null}
}
export async function createHatterSite(environment,siteIdentity,options={}){
 const runtime=new HatterRuntime({environment,...options});let startupFailure=null,assets=[],unwatch=null,closed=false,notify=()=>{},catalogObservation=null
 const storeViews=new Map(),documentReads=new Map(),feedbackInputs=new Map()
 const garden= gardenReader(runtime)
 runtime.startupStage('ProjectionsStart')
 try{await runtime.startProjections();runtime.startupStage('ProjectionsReady')}catch(error){startupFailure=error;runtime.startupStage('ProjectionsFailed')}
 const navigation=[{label:'World',href:'/',symbol:'person'},{label:'Saved views',href:'/scenes',symbol:'nodes'},{label:'Add capabilities',href:'/store',symbol:'package'},{label:'Inference',href:'/models',symbol:'chip'},{label:'System',href:'/system',symbol:'activity'},{label:'Semantic structure',href:'/system/semantic',symbol:'nodes'}]
 const setup={id:'hatter:source:provision',owner:'hatter/control',operation:'provision'}
 async function document(url,options={}){
  if(options.assets)assets=options.assets
  if(!navigation.some(n=>n.href===url.pathname))throw Object.assign(Error('NotFound'),{code:'NotFound'})
  let snapshot=null,input=null,entries=[],subjects=[],data,actions=[],observations=[],world=null,worlds=null,inspection=null,registryRevision=null,speaker=null,inference=null
  const page={title:navigation.find(link=>link.href===url.pathname).label,description:''}
  if(url.pathname==='/system/semantic'){
   page.description='Read-only sem-lang structure. Lines show document containment, not inferred semantic equivalence. Each component preserves its exact owner reference and revision.'
   inspection={roles:[],selected:null,documents:[]}
   try{
    const value=await semanticInspection(runtime,url.searchParams.get('role'))
    const {failures,...view}=value;inspection=view
    observations.push(requirement('hatter/control','inference/role/list',null))
    for(const failure of failures)observations.push(requirement('sem-lang',failure.method,failure.error))
   }catch(error){observations.push(requirement('sem-lang','structure/read',error))}
  }else if(url.pathname==='/store'){
   page.dataLabel='Distribution source details'
   page.description='Browse signed HAT packages from an external distribution source. Register a trusted HTTPS address or local directory, or choose an existing source. Source configuration does not install a HAT.'
   // Source settings remain observable when the distribution is unreachable.
   // This is an independent original-owner read, never an empty catalog fallback.
   try{const registry=await runtime.catalogSources();registryRevision=registry.revision;data={distribution:registry};actions=catalogActions(registry);observations.push(requirement('hatter/admission','hat/catalog-source/list',null))}
   catch(error){observations.push(requirement('hatter/admission','hat/catalog-source/list',error,setup))}
   try{
    // Realtime observes local configuration. External verification runs on an explicit read or a changed source revision, never on every tick.
    if(!options.live||!catalogObservation||catalogObservation.revision!==registryRevision){
     try{catalogObservation={revision:registryRevision,store:createStore(await observeCatalog((method,params)=>runtime.rpc(method,params))),error:null}}
     catch(error){catalogObservation={revision:registryRevision,store:null,error}}
    }
    if(catalogObservation.error)throw catalogObservation.error
    const store=catalogObservation.store
    const query={text:url.searchParams.get('q')??'',categoryId:url.searchParams.get('category')??null,cursor:url.searchParams.get('cursor')??null}
    const view=storeScene(store,query);snapshot=view.snapshot;input={key:snapshot.key,revision:snapshot.revision}
    storeViews.delete(snapshot.key);storeViews.set(snapshot.key,{store,view,query});if(storeViews.size>8)storeViews.delete(storeViews.keys().next().value)
    data={...data,placement:'External distribution source',page:view.page,source:store.source};observations.push(requirement('hatter/catalog','catalog/list',null))
   }catch(error){observations.push(requirement('hatter/catalog','catalog/list',error));page.emptyMessage='The catalog could not be loaded. Check the selected distribution source, then use Read current state. No packages have been installed by this view.'}
  }else if(url.pathname==='/models'){
   page.description='Inspect the configured inference providers and their model catalogs. Refresh is an explicit provider operation.'
   page.dataLabel='Inference provider details'
   try{
    const providers=await runtime.modelProviders(),providerId=url.searchParams.get('providerId')??providers.providers.find(p=>p.active)?.id
    if(!providers.providers.some(p=>p.id===providerId))bad()
    data={providers,...await runtime.models({providerId,cursor:url.searchParams.get('cursor')??null})}
    actions=[{id:'model:refresh:'+providerId,label:'Refresh '+providers.providers.find(p=>p.id===providerId).name}]
    observations.push(requirement('hatter/models','model/list',null))
   }catch(error){observations.push(requirement('hatter/models','model/list',error))}
  }else if(url.pathname==='/system'){
   page.description='Observe the running owners and explicitly prepare their storage. Storage readiness is separate from definition adoption, model installation and HAT activation.'
   page.dataLabel='Runtime and owner observations'
   try{data={projection:runtime.projections.inspect(),publication:runtime.publication.inspect(),diagnostics:runtime.diagnosticsStore.list()};observations.push(requirement('hatter/projection','inspect',null))}
   catch(error){observations.push(requirement('hatter/projection','inspect',error))}
   // Present the original owner observations; configured models or a reachable
   // Node process cannot prove canonical-owner readiness or process ownership.
   try{data={...data,runtime:await runtime.overview()};observations.push(requirement('hatter/management','status/read',null))}
   catch(error){observations.push(requirement('hatter/management','status/read',error))}
   // Observe the same Work/driver contract as CLI, independent of model/account
   // readiness. These are original diagnostics, not inferred execution state.
   try{data={...data,work:await runtime.workObservation()};observations.push(requirement('hatter/control','inference/execute',null))}
   catch(error){observations.push(requirement('hatter/control','inference/execute',error))}
   // This is the existing owner command, not a read-time initialization.
   actions=[...storageSetup.map(({id,label})=>({id,label})),{id:setup.id,label:'Provision source retention registries'}]
   if(data.work?.driver?.workerFinished===true)actions.push({id:'hatter:work:recover',label:'Recover stopped work dispatcher'})
   for(const stream of runtime.publication?.inspect().streams??[])if(stream.status?.state==='FailedTyped')
    actions.push({id:'publication:recover:'+stream.key,label:'Retry publication '+stream.key})
  }else{
   page.description='Your adopted definitions and roles provide the subjects and scenes shown here. Storage setup is available in System; it does not create personal information or permissions.'
   try{
    if(startupFailure&&!runtime.projections)throw startupFailure
    const query=Object.fromEntries(url.searchParams)
    const value=readScene(runtime.projections,query);snapshot=value.snapshot;input=value.input;entries=value.entries
    observations.push(requirement('hatter/projection','read',null))
   }catch(error){
    observations.push(requirement('hatter/projection','read',error))
    const key=url.searchParams.get('key')
    // A durable selected producer may precede its first snapshot. Its exact
    // locator may be observed through STATE, never invented from a URL alone.
    if(error.code==='SceneUnavailable'&&url.searchParams.get('current')==='true'
      &&runtime.publication?.inspect().streams.some(stream=>stream.key===key))input={key,revision:null,requirementRef:observations.at(-1).ref}
   }
   if(!snapshot){
    try{subjects=await garden.candidates();observations.push(requirement('hatter/control','targets',null))}
    catch(error){observations.push(requirement('hatter/control','targets',error))}
   }
   if(startupFailure)observations.push(requirement('hatter/control','startup',startupFailure,setup))
   data={publication:runtime.publication?.inspect()??null}
   if(!snapshot&&!subjects.length&&!entries.length)page.emptyMessage='No subject is available to display. Initial definition-package selection and core-role configuration are not complete.'
  }
  // One garden, with a current bounded roster on every focused document. Reuse
  // original owner references; this is not a cache of previously visible people.
  try{
   const candidates=subjects.length?subjects:await garden.candidates()
   world=await garden.labels(candidates)
   const stream=runtime.publication?.inspect().streams.find(s=>s.key===input?.key)
   const actor=world.objects.find(o=>o.id===stream?.roleId&&o.status==='Available')
   if(snapshot&&actor)speaker={id:actor.id,title:actor.title,roleRef:actor.roleRef,activities:conversationViews(runtime.publication.inspect().streams,actor.id,input.key)}
   observations.push(requirement('hatter/control','worldLabels',null))
  }catch(error){observations.push(requirement('hatter/control','worldLabels',error))}
  try{worlds=worldChoices(await runtime.worlds());observations.push(requirement('hatter/world','world/list',null))}
  catch(error){observations.push(requirement('hatter/world','world/list',error))}
  if(speaker&&streamIsCurrent()){
   try{
    // The owner declares the exact input and revision basis. This bounded map
    // retains only published descriptors, never memory, inputs or permissions.
    const d=await runtime.rpc('interaction/execute',{operation:'feedbackDescribe',roleRef:speaker.roleRef})
    speaker.preparation=feedbackPreparation(d.context)
    const id='feedback:'+createHash('sha256').update(JSON.stringify(d)).digest('hex')
    feedbackInputs.delete(id);feedbackInputs.set(id,d)
    if(feedbackInputs.size>8)feedbackInputs.delete(feedbackInputs.keys().next().value)
    actions.push({id,label:'Provide an observation',input:d.input,
     description:'Share one thing you noticed, heard, or experienced with this person. It stays an observation for review, not a confirmed fact or an instruction.',
     example:'For example: “I booked a dental visit today.” Enter its language tag (ja or en) and choose retention; leave the evaluation instant empty unless your adopted knowledge defines it.'})
    observations.push(requirement('hatter/control','feedback/input',null))
   }catch(error){observations.push(requirement('hatter/control','feedback/input',error))}
  }
  function streamIsCurrent(){return !url.searchParams.has('revision')&&snapshot?.data.purpose==='subject'}
  if(speaker&&streamIsCurrent()){
   try{
    const memory=await runtime.roleMemory(speaker.roleRef)
    if(!['schema','id','revision','digest_sha256'].every(k=>memory.roleRef?.[k]===speaker.roleRef[k])||!Array.isArray(memory.shortTerm))throw Error('MemorySourceMismatch')
    // The ordinary received-information view shows the latest original entries
    // first. Only a separately validated reference proposal changes that view.
    speaker.observations=memory.shortTerm.slice(-16).reverse()
    speaker.memoryTimeline=memoryTimeline(memory)
    const person=world?.objects.find(item=>item.id===speaker.id)
    if(person)person.memoryPerspective={
     shortTerm:speaker.memoryTimeline.entries.filter(item=>item.memory==='short-term').length,
     longTerm:speaker.memoryTimeline.entries.filter(item=>item.memory==='long-term').length,
     unclassified:speaker.memoryTimeline.unclassifiedCount,
     channels:speaker.memoryTimeline.channels.map(({id,label,symbol,entries})=>({id,label,symbol,count:entries.length}))
    }
    speaker.reviewPriority=memory.reviewPriority??{state:'SourceOrder',order:[]}
    if(speaker.reviewPriority.state==='Proposed'){
     try{
      const process=await runtime.localRuntimeRegistry({operation:'process',command:{operation:'inspect'}})
      if(process.observation?.process?.state!=='ready')speaker.reviewPriority={state:'SourceOrder',order:[]}
     }catch(error){speaker.reviewPriority={state:'SourceOrder',order:[]};speaker.reviewPriorityFailure=error.failure??{code:error.code??'InferenceUnavailable'}}
    }
    observations.push(requirement('sem-lang','feedback/memory',null))
   }catch(error){observations.push(requirement('sem-lang','feedback/memory',error))}
  }
  const workRequirement=observations.findIndex(r=>r.ref==='hatter:inference/execute')
  try{inference=workRequirement>=0&&observations[workRequirement].failure?{available:false,failure:observations[workRequirement].failure}:inferenceObservation(data?.work??await runtime.workObservation())}
  catch(error){const failed=requirement('hatter/control','inference/execute',error);inference={available:false,failure:failed.failure};if(workRequirement>=0)observations[workRequirement]=failed;else observations.push(failed)}
  const required=readiness(observations.map(r=>r.ref),observations)
  const result={envelope:{contract:'hatter/delivery/1',site:siteIdentity,initial:snapshot?projectionIdentity(snapshot):null,snapshot,readiness:required,assets,transport:{path:'/api/projection-live',classes:['STATE']}},
   bootstrap:{presentation:'garden',inference,navigation,page,input,entries,subjects,actions,
    ...(worlds?{worlds}:{}),
    ...(speaker?{speaker}:{}),...(inspection?{inspection}:{}),...(world?{world}:{}),...(data===undefined?{}:{data})}}
  // Semantic inspection is an explicit read of exact owner references, not an idle polling workload.
  if(!inspection&&!url.searchParams.has('revision'))result.bootstrap.liveDocument={key:'document:'+url.pathname+url.search,revision:'document:'+createHash('sha256').update(JSON.stringify(result)).digest('hex')}
  return result
 }
 function readDocument(url,options={}){
  if(closed)return Promise.reject(Object.assign(Error('ProjectionRuntimeClosed'),{code:'ProjectionRuntimeClosed'}))
  if(options.assets)assets=options.assets
  return shareDocumentRead(documentReads,documentReadKey(url,options.live),()=>document(url,options))
 }
 return {document:readDocument,
  onOutcome(value){runtime.diagnosticsStore.recordObservation(value)},
  async read(url,{signal}){
   if(url.pathname==='/api/document'){
    const path=url.searchParams.get('path'),query=url.searchParams.get('query')??''
    if(!navigation.some(n=>n.href===path))bad()
    return readDocument(new URL(path+'?'+query,url.origin),{signal})
   }
   if(url.pathname==='/api/projections')return readScene(runtime.projections,Object.fromEntries(url.searchParams))
   if(url.pathname==='/api/catalog')return observeCatalog((method,params)=>runtime.rpc(method,params))
   if(url.pathname==='/api/status')return {publication:runtime.publication?.inspect()??null,projections:runtime.projections?.inspect()??null}
   if(url.pathname==='/api/worlds')return worldChoices(await runtime.worlds())
   throw Object.assign(Error('NotFound'),{code:'NotFound'})
  },
  async command(url,value,{signal,observe:diagnostic=()=>{},requestRef}){
   return runtime.diagnosticsStore.withOperation(requestRef,async()=>{
   const mark=stage=>{try{runtime.diagnosticsStore.recordStage(stage)}catch{}}
   mark('RequestAccepted')
   let current={owner:'hatter/control',operation:'interaction/execute'}
   const observe=value=>{current=value;try{diagnostic(value)}catch{}}
   try{
   observe({stage:'NOT_DISPATCHED',owner:'hatter/control',operation:'interaction/execute'})
   if(closed||signal.aborted)throw Object.assign(Error('ProjectionCancelled'),{code:'ProjectionCancelled'})
   if(url.pathname==='/api/worlds'){
    object(value,value?.operation==='create'?['operation','name','directory']:value?.operation==='select'?['operation','id']:[])
    if(!['create','select'].includes(value.operation))bad()
    observe({stage:'OUTCOME_UNCERTAIN',owner:'hatter/world',operation:'world/'+value.operation})
    const result=await runtime.worlds(value.operation,value.operation==='create'?{name:value.name,directory:value.directory}:{id:value.id})
    observe({stage:'OWNER_COMMITTED',owner:'hatter/world',operation:'world/'+value.operation,receiptRef:result.receiptRef})
    return worldChoices(result)
   }
   if(url.pathname==='/api/subjects'){
    observe({stage:'NOT_DISPATCHED',owner:'hatter/projection',operation:'projection/select'})
    object(value,['roleRef']);mark('SelectionStart')
    const result=await runtime.publication.select(value.roleRef)
    mark('SelectionReady');return result
   }
   if(url.pathname==='/api/interactions'){
    mark('SceneActionValidationStart')
    validateSubmission(value)
    const retained=storeViews.get(value.projectionKey)
    if(retained){
     const action=inputAction(retained.view.snapshot,value)
     if(action.targetOwner==='ihat'&&action.commandRef==='ihat/store/query')return {presentation:{href:'/store?'+new URLSearchParams({q:value.values.query})}}
     if(action.targetOwner!=='hatter'||action.commandRef!=='hat/catalog/install')bad()
     const candidate=retained.store.catalog.candidates.find(p=>action.contextRefs.includes(p.repositoryId)&&action.id==='install:'+p.packageSha256)
     if(!candidate)bad()
     const request=retained.store.installation(packageReference(candidate))
     observe({stage:'OUTCOME_UNCERTAIN',owner:'hatter/catalog',operation:'hat/catalog/install'})
     const result=await runtime.rpc(request.method,request.params)
     storeViews.delete(value.projectionKey)
     return {installation:result.installation,presentation:{href:'/store'}}
    }
    // Existing canonical-receipt reconciliation drives PP independently. Never
    // spend the HTTP response budget waiting for the derived producer or STATE.
    return await submitInteraction(runtime.projections,async(...args)=>{
     mark('SceneActionValidationReady');mark('OwnerOperationStart')
     try{return await runtime.rpc(...args)}finally{mark('OwnerOperationSettled')}
    },value,async()=>({state:'Pending'}),observe,context=>runtime.diagnosticsStore.recordObservation(context))
   }
   if(url.pathname==='/api/setup'||url.pathname==='/api/site-actions'){
    object(value,['id','values'])
    if(url.pathname==='/api/site-actions'&&typeof value.id==='string'&&value.id.startsWith('feedback:')){
     const d=feedbackInputs.get(value.id)
     if(!d)throw Object.assign(Error('StaleSceneAction'),{code:'StaleSceneAction'})
     observe({stage:'OUTCOME_UNCERTAIN',owner:'hatter/control',operation:'inference/role/observe'})
     const published=await runtime.rpc('interaction/execute',{operation:'feedbackSubmit',target:d.interactionRef,
      generation:d.generation,inputContractRef:d.inputContractRef,values:value.values})
     const receiptRef=published.receipt?.commit?.commit_ref
     if(receiptRef)observe({stage:'OWNER_COMMITTED',owner:'hatter/control',operation:'inference/role/observe',receiptRef})
     return published
    }
    if(url.pathname==='/api/site-actions'&&typeof value.id==='string'&&value.id.startsWith('catalog:')){
     observe({stage:'OUTCOME_UNCERTAIN',owner:'hatter/admission',operation:'hat/catalog-source/'+(value.id.startsWith('catalog:select:')?'select':'write')})
     return await submitCatalogSettings(runtime,value.id,value.values)
    }
    if(value.values&&Object.keys(value.values).length)bad()
    if(value.id==='hatter:work:recover'){
     observe({stage:'OUTCOME_UNCERTAIN',owner:'hatter/control',operation:'inference/execute'})
     return await runtime.rpc('inference/execute',{operation:'recoverScheduler'})
    }
    if(url.pathname==='/api/site-actions'&&typeof value.id==='string'&&value.id.startsWith('publication:recover:')){
     const key=value.id.slice('publication:recover:'.length)
     observe({stage:'NOT_DISPATCHED',owner:'hatter/projection',operation:'projection/recover'})
     return await runtime.publication.recover(key)
    }
    if(value.id===setup.id){observe({stage:'OUTCOME_UNCERTAIN',owner:'hatter/control',operation:'source/execute'});await runtime.projections.provisionSourceOwners({signal});await runtime.startProjections();startupFailure=null;return {state:'Ready',owner:setup.owner,operation:setup.operation}}
    const storage=storageSetup.find(s=>s.id===value.id)
    if(storage){
     observe({stage:'OUTCOME_UNCERTAIN',owner:storage.owner,operation:'storage/execute'})
     const result=await runtime.rpc('storage/execute',{operation:'initialize',owner:storage.owner})
     // Storage creation is not semantic setup or projection readiness. Observe
     // the next prerequisite without discarding a successful owner result.
     try{await runtime.startProjections();startupFailure=null}catch(error){startupFailure=error}
     return result
    }
    if(url.pathname==='/api/site-actions'&&typeof value.id==='string'&&value.id.startsWith('model:refresh:')){
     const providerId=value.id.slice('model:refresh:'.length),providers=await runtime.modelProviders()
     if(!providers.providers.some(p=>p.id===providerId))bad()
     observe({stage:'OUTCOME_UNCERTAIN',owner:'hatter/models',operation:'model/refresh'})
     return runtime.refreshModels({providerId})
    }
   }
   bad()
   }catch(error){throw ownerCommandFailure(error,current.owner,current.operation)}
   })
  },
  async live(request){try{
   if(request.locator.startsWith('document:')){
    const location=request.locator.slice(9),url=new URL(location,'http://localhost')
    if(location.length>2048||!location.startsWith('/')||url.origin!=='http://localhost'||request.key!==request.locator||!navigation.some(n=>n.href===url.pathname)||url.searchParams.has('revision'))bad()
    const value=await readDocument(url,{live:true}),revision=value.bootstrap.liveDocument.revision
    return request.revision===revision?{kind:'NoChange',revision}:{kind:'Snapshot',revision,payload:Buffer.from(JSON.stringify(value))}
   }
   const {snapshot}=storeViews.get(request.locator)?.view??readScene(runtime.projections,{key:request.locator,current:'true'})
   if(snapshot.key!==request.key)bad()
   return request.revision===snapshot.revision?{kind:'NoChange',revision:request.revision}:{kind:'Snapshot',revision:snapshot.revision,payload:Buffer.from(JSON.stringify(snapshot))}
  }catch(error){return {kind:'RecoveryUnavailable',detail:sceneFailure(error)}}},
  watch(callback){notify=callback;if(runtime.publication)runtime.publication.onObservation=notify;unwatch?.();try{if(runtime.projections)unwatch=runtime.projections.watch(notify)}catch(error){startupFailure=error}},
  async close(){closed=true;if(runtime.publication)runtime.publication.onObservation=null;unwatch?.();storeViews.clear();feedbackInputs.clear();catalogObservation=null;await runtime.close()}}
}
