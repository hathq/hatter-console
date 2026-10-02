// Hatter presentation over sem-lang-owned memory. This module never writes,
// promotes, classifies meaning, or invents an observation time/sensory source.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const integerOrNull=value=>value===null||Number.isSafeInteger(value)
const invalid=()=>{throw Object.assign(Error('hatter-console-memory-timeline-invalid'),{code:'hatter-console-memory-timeline-invalid'})}

const sensoryChannels=()=>[
 {id:'vision',label:'Sight',symbol:'◉',entries:[]},
 {id:'hearing',label:'Hearing',symbol:'≋',entries:[]},
 {id:'touch',label:'Touch',symbol:'◇',entries:[]},
 {id:'smell',label:'Smell',symbol:'∿',entries:[]},
 {id:'taste',label:'Taste',symbol:'◌',entries:[]},
 {id:'body',label:'Body',symbol:'◎',entries:[]}
]

export function memoryTimeline(memory){
 if(!object(memory)||!Array.isArray(memory.shortTerm)||!Array.isArray(memory.longTerm)
  ||memory.shortTerm.length>128||memory.longTerm.length>128)invalid()
 const entries=[]
 for(const item of memory.shortTerm){
  if(!object(item)||typeof item.reference!=='string'||typeof item.input_ref!=='string'||!object(item.context)
   ||!integerOrNull(item.context.at)||typeof item.context.semantic_revision!=='string')invalid()
  entries.push({id:'short:'+item.reference,reference:item.reference,memory:'short-term',state:'observed',at:item.context.at,
   label:typeof item.surface==='string'?item.surface:null,predicate:null,revision:item.context.semantic_revision,
   sourceRefs:[item.input_ref],sensoryRefs:[]})
 }
 for(const item of memory.longTerm){
  if(!object(item)||typeof item.id!=='string'||typeof item.kind!=='string'||typeof item.value!=='string'
   ||!object(item.validity)||!integerOrNull(item.validity.valid_from)||!integerOrNull(item.validity.valid_until)
   ||!Array.isArray(item.evidence)||typeof item.promotion_ref!=='string')invalid()
  const sources=[item.promotion_ref,...item.evidence.map(value=>value?.reference)]
   .filter((value,index,values)=>typeof value==='string'&&value&&values.indexOf(value)===index)
  entries.push({id:'long:'+item.id,reference:item.id,memory:'long-term',
   state:item.validity.superseded_by===null?'accepted':'superseded',at:item.validity.valid_from,
   label:item.value,predicate:item.kind,revision:item.revision,sourceRefs:sources,sensoryRefs:[]})
 }
 // Explicit instants sort newest first. Unknown time remains unknown and follows
 // timed entries; array order is only a stable tie-breaker, never a fabricated time.
 entries.sort((left,right)=>right.at===null?left.at===null?0:-1:left.at===null?1:right.at-left.at)
 const channels=sensoryChannels()
 return {roleRef:memory.roleRef,subjectRef:memory.subjectRef,semanticRevision:memory.semanticRevision,
  memoryRevision:memory.memoryRevision,entries,channels,unclassifiedCount:entries.length,
  note:'Sensory channels are presentation positions. An entry stays unclassified until an adopted semantic binding names its sensory source.'}
}
