// Hatter presentation policy over PP1 snapshots only. No source/owner reads.
import {scene,validateSnapshot,canonical} from '@hathq/projection-contracts'

// A bounded display preview, never a rewrite of the original typed field.
function bubbleValue(value){
 const text=String(value).toWellFormed().replace(/[\x00-\x1f\x7f]/gu,' ')
 if(!text.length)return '(empty)'
 if(Buffer.byteLength(text)<=1024)return text
 let preview='',bytes=0
 for(const character of text){const size=Buffer.byteLength(character);if(bytes+size>1021)break;preview+=character;bytes+=size}
 return preview+'…'
}

export function sceneInput(snapshot){
  validateSnapshot(snapshot)
  if(snapshot.kind==='Scene')return snapshot
  const operation=snapshot.lineage.request.purpose==='operation'
    ?snapshot.lineage.sources.find(s=>s.owner==='hatter/execution'):null
  // Exact InvocationTiming wire field, not a generic date/name heuristic.
  const temporal=operation?{label:'Requested time',items:snapshot.data.items.filter(item=>item.visibility==='visible'&&item.sourceRefs.some(source=>source.owner==='hatter/execution'))
    .map(item=>({itemId:item.id,valuePath:['timing','requested_at_unix_ms'],format:'unixMilliseconds'}))}:null
  return scene(snapshot,{key:operation?'operation:'+operation.ref:snapshot.key,focus:snapshot.lineage.request.focus,
    purpose:snapshot.lineage.request.purpose,regions:[
      {id:'primary',role:'Primary',itemIds:snapshot.data.items.filter(i=>i.semanticRef!==null).map(i=>i.id)},
      {id:'context',role:'Context',itemIds:snapshot.data.items.filter(i=>i.semanticRef===null).map(i=>i.id)},
      {id:'resolution',role:'Resolution',itemIds:snapshot.data.unresolved.map(i=>i.id)}
    ].filter(r=>r.itemIds.length),actions:[],presentation:snapshot.data.items.filter(i=>i.visibility==='visible').map(i=>{
      const fields=[]
      let title=i.sourceRefs[0].owner==='sem-lang'?'Value not available':i.semanticRef?'Recorded information':'Context'
      // Decode only sem-lang's explicit typed scalar arguments, never names/locators as semantics.
      if(i.sourceRefs[0].owner==='sem-lang'&&Array.isArray(i.value?.arguments))for(const [n,a]of i.value.arguments.entries()){
        if(!a.value||Object.keys(a.value).length!==1)continue
        const type=Object.keys(a.value)[0],value=a.value[type]
        if(['Text','Integer','Number','Boolean'].includes(type)&&['string','number','boolean'].includes(typeof value)){
          fields.push({label:'Value '+(n+1),valuePath:['arguments',String(n),'value',type]})
          if(n===1)title=bubbleValue(value)
        }
      }
      return {itemId:i.id,title,symbol:i.semanticRef?'info':'person',fields:fields.slice(0,16)}
    }),...(temporal?{temporal}:{})})
}
const errors=new Set(['ProjectionUnavailable','ProjectionStoreCorrupt','ProjectionStoreBusy',
  'ProjectionLimitExceeded','InvalidProjection','SceneUnavailable','SourceUnavailable','SourceNotRetained',
  'SourceRevisionMismatch','ProjectionRuntimeClosed','ProjectionAccessRequired',
  'ProjectionQueueFull','ProjectionCancelled','ProjectionPending','RecoveryUnavailable'])
export function sceneFailure(error){
  return {code:errors.has(error?.code)?error.code:'ProjectionUnavailable',
    // Already redacted/validated by the existing management boundary.
    ownerFailure:error?.failure??null}
}
export function readScene(product,query){
  if(!product)throw Object.assign(Error('ProjectionUnavailable'),{code:'ProjectionUnavailable'})
  if(Object.keys(query).some(k=>!['key','revision','current','related'].includes(k))||
    Object.values(query).some(v=>typeof v!=='string'||v.length>512))
    throw Object.assign(Error('InvalidProjection'),{code:'InvalidProjection'})
  if(!query.key){
    if(Object.keys(query).length)throw Object.assign(Error('InvalidProjection'),{code:'InvalidProjection'})
    return {entries:product.inspect().store.keys.map(({key,current})=>({key,revision:current})),snapshot:null,input:null}
  }
  if((query.current==='true')===Boolean(query.revision)||query.current&&query.current!=='true')
    throw Object.assign(Error('InvalidProjection'),{code:'InvalidProjection'})
  const snapshot=product.read(query.key,query.revision??null)
  if(!snapshot)throw Object.assign(Error('SceneUnavailable'),{code:'SceneUnavailable'})
  if(query.related){
    const unresolved=snapshot.data.unresolved.find(i=>i.id===query.related)
    if(!unresolved)throw Object.assign(Error('SceneUnavailable'),{code:'SceneUnavailable'})
    const continuations=snapshot.data.items.filter(i=>i.sourceRefs.some(s=>s.owner==='hatter/control')
      &&i.value?.kind==='continuation'&&unresolved.contextRefs.includes(i.value.reference.id)).map(i=>canonical(i.value.reference))
    const entries=[]
    for(const {key,current} of product.inspect().store.keys){
      const candidate=product.read(key,current)
      if(candidate?.kind==='Scene'&&candidate.data.purpose==='resolution'&&candidate.data.items.some(i=>
        i.sourceRefs.some(s=>s.owner==='hatter/control')&&i.value?.kind==='confirmation'
        &&continuations.includes(canonical(i.value.value.continuationRef))))entries.push({key,revision:current})
    }
    return {entries,snapshot:null,input:null}
  }
  return {entries:[],input:{key:snapshot.key,revision:snapshot.revision},snapshot:sceneInput(snapshot)}
}

let relatedWaiters=0
// A related Scene can legitimately publish after its Subject. Wait only on the
// existing PP store notification; no source read, producer call or polling loop.
/** @param {{signal?: AbortSignal, timeoutMs?: number}} [options] */
export async function waitRelatedScene(product,query,options={}){
  const {signal,timeoutMs=10000}=options
  const initial=readScene(product,query)
  if(!query.related||initial.entries.length)return initial
  if(relatedWaiters>=8)throw Object.assign(Error('ProjectionQueueFull'),{code:'ProjectionQueueFull'})
  relatedWaiters++
  return new Promise((resolve,reject)=>{
    let unwatch,timer,done=false
    const finish=(value,error)=>{
      if(done)return;done=true;clearTimeout(timer);unwatch?.();signal?.removeEventListener('abort',abort);relatedWaiters--
      if(error)reject(error);else resolve(value)
    }
    const abort=()=>finish(null,Object.assign(Error('ProjectionCancelled'),{code:'ProjectionCancelled'}))
    const check=()=>{try{const value=readScene(product,query);if(value.entries.length)finish(value)}catch(e){finish(null,e)}}
    try{
      unwatch=product.watch(check)
      // A store may synchronously deliver its current notification while the
      // subscription is being installed. Do not leak that subscription/timer.
      if(done){unwatch?.();return}
      signal?.addEventListener('abort',abort,{once:true})
      timer=setTimeout(()=>finish({...initial,error:{code:'ProjectionPending',ownerFailure:null}}),timeoutMs)
      if(signal?.aborted)abort();else check()
    }catch(e){finish(null,e)}
  })
}
