import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryTimeline} from '../shared/memory-timeline.mjs'

const roleRef={schema:'hathq://semantic/reference/v1',id:'runtime-role:guide',revision:2,digest_sha256:'a'.repeat(64)}
const subjectRef={id:'person:owner',class:'person'}
const short=(reference,at,surface)=>({reference,input_ref:'input:'+reference,input_digest:'b'.repeat(64),surface,
 context:{subject:subjectRef,evidence:[],at,locale:'ja',semantic_revision:'c'.repeat(64),context_refs:[],context_scope:'CurrentRequest',observation_evidence:[]},retention:'KeepForSession'})
const retained={id:'default:one',subject:subjectRef,kind:'Location',value:'Tokyo',scope:'PersistentAgentDefault',
 validity:{valid_from:10,valid_until:null,superseded_by:null},evidence:[{reference:'evidence:one',detail:'owner accepted'}],revision:'context:one',promotion_ref:'promotion:one'}
const memory={roleRef,subjectRef,semanticRevision:'c'.repeat(64),memoryRevision:'d'.repeat(64),shortTerm:[short('one',20,'heard something'),short('two',null,'untimed')],longTerm:[retained]}

test('projects sem-lang short and long-term memory without inventing time or a sensory classification',()=>{
 const before=structuredClone(memory),view=memoryTimeline(memory)
 assert.deepEqual(view.entries.map(item=>[item.id,item.memory,item.at]),[['short:one','short-term',20],['long:default:one','long-term',10],['short:two','short-term',null]])
 assert.deepEqual(view.entries[1].sourceRefs,['promotion:one','evidence:one'])
 assert.equal(view.channels.length,6);assert(view.channels.every(channel=>channel.entries.length===0))
 assert.equal(view.unclassifiedCount,3);assert.deepEqual(memory,before)
 assert(!JSON.stringify(view).includes('history'))
})

test('fails closed on invalid explicit times and bounded-input violations',()=>{
 for(const input of [
  {...memory,shortTerm:Array.from({length:129},(_,i)=>short(String(i),i,'x'))},
  {...memory,longTerm:[{...retained,validity:{valid_from:'now',valid_until:null,superseded_by:null}}]},
  {...memory,longTerm:Array.from({length:129},(_,i)=>({...retained,id:String(i)}))}
 ])assert.throws(()=>memoryTimeline(input),{code:'hatter-console-memory-timeline-invalid'})
})
