// Hatter 2026: exact owner refs, independently reported failures, no fallback meanings.
import test from 'node:test'
import assert from 'node:assert/strict'
import {semanticInspection} from '../delivery/semantic-inspection.mjs'
import {semanticOverview} from '../delivery/semantic-overview.mjs'
test('semantic inspection selects exact role, preserves owner data and failures, and cannot initialize',async()=>{
 const ref={schema:'ref',id:'role:a',revision:7,digest_sha256:'a'.repeat(64)},calls=[]
 const values={'profile/dictionary/read':{definitions:[{id:'declared',nested:{value:'exact'}}],bindings:[],restoration:{definitions:'exact-ref'}},'profile/entry/list':{claims:[{id:'claim'}],provenance:[],truncated:true},'inference/role/memory':{shortTerm:[]}}
 const runtime={rpc:async(method,params)=>{calls.push([method,params]);if(method==='inference/role/list')return{roles:[{roleRef:ref}]};assert.deepEqual(params.roleRef,ref);return{roleRef:ref,semanticRevision:'exact-revision',...values[method]}}}
 const view=await semanticInspection(runtime,null)
 assert.equal(view.selected,'role:a');assert.equal(view.documents.length,6);assert.deepEqual(view.documents[0].value,values['profile/dictionary/read'].definitions);assert.equal(view.documents[3].source.truncated,true)
 assert.deepEqual(calls.map(c=>c[0]),['inference/role/list','profile/dictionary/read','profile/entry/list','inference/role/memory'])
 await assert.rejects(semanticInspection(runtime,'missing'),{code:'UnknownSemanticRole'})
 const original=runtime.rpc;runtime.rpc=async(method,params)=>method==='profile/entry/list'?{roleRef:{...ref,revision:8}}:original(method,params)
 const conflict=await semanticInspection(runtime,'role:a');assert.equal(conflict.failures[0].error.code,'SemanticReferenceMismatch');assert(!conflict.documents.some(d=>d.id==='claims'));assert.equal(conflict.documents.length,4)
 assert.deepEqual(await semanticInspection({rpc:async()=>({roles:[]})},null),{roles:[],selected:null,documents:[],failures:[],overview:semanticOverview([])})
})
test('four responsibility views preserve actual counts, unknown ownership and unavailable versus empty',()=>{
 const doc=(id,value,truncated=false)=>({id,value,source:{truncated}})
 const documents=[doc('definitions',[{vocabulary_id:'sem-lang.kernel.sounding-name',version:'0.10.0',dependencies:['base'],terms:[{id:'a'}],lexical_bindings:[{language_tag:'en,ja'},{language_tag:'ja'}]}]),doc('bindings',[]),doc('claims',[{id:'c'}],true),doc('shortTerm',[])]
 const before=structuredClone(documents),view=semanticOverview(documents)
 assert.equal(view.groups[0].state,'Not observed','a module name cannot establish source ownership')
 assert.deepEqual(view.groups[1].values,['en','ja']);assert.deepEqual(view.groups[1].measures.map(m=>m.value),[2,2])
 assert.equal(view.groups[2].measures[0].value,0);assert.equal(view.groups[3].measures[0].partial,true)
 assert.deepEqual(view.groups[3].measures.map(m=>m.value),[1,0]);assert.deepEqual(documents,before)
 const missing=semanticOverview(documents.filter(d=>d.id!=='bindings'&&d.id!=='shortTerm'))
 assert.equal(missing.groups[2].state,'Unavailable');assert.equal(missing.groups[2].measures[0].value,null)
 assert.equal(missing.groups[3].measures[1].value,null);assert.equal(missing.modules[0].terms,1)
 assert(!JSON.stringify(view).includes('Ready'));assert.equal(semanticOverview([]).modulesAvailable,false)
})
