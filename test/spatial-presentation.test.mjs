// Hatter 2026: public presentation is declared; raw canonical records remain inspectable.
import test from 'node:test'
import assert from 'node:assert/strict'
import {produce} from '@hathq/projection-contracts'
import {sceneInput} from '../server/runtime/scene-input.mjs'
import {sourceProjection} from '../server/runtime/product-projections.mjs'

test('unknown and conflicting observations remain visible without invented choices or adopted facts',()=>{
 const source={owner:'hatter/control',ref:'receipt:feedback',revision:'revision:feedback',kind:'control'}
 const reasons=['UnknownExpression','MissingContext','Ambiguous','ConflictingEvidence','CardinalityViolation','CircularDependency']
 const records=[{kind:'continuation',reference:{id:'continuation:1'},value:{remainingResiduals:reasons.map((reason,n)=>({reference:'residual:'+n,reason,variable:null}))}}]
 const projected=sourceProjection(source,{records})
 assert.deepEqual(projected.unresolved.map(v=>v.reason),reasons)
 assert.ok(projected.unresolved.every(v=>v.actionRefs.length===0))
 assert.deepEqual(projected.items.map(v=>v.value),records)
 const snapshot=produce({key:'feedback',sources:[source],producer:{id:'feedback-test',version:'0.10.0',contract:'test',configuration:'test'},focus:'role',purpose:'subject',visibilityRef:'local-owner',limits:{}},[projected])
 const view=sceneInput(snapshot)
 assert.deepEqual(view.data.unresolved,snapshot.data.unresolved)
 assert.deepEqual(view.data.regions.find(r=>r.role==='Resolution').itemIds,projected.unresolved.map(v=>v.id))
 assert.deepEqual(view.data.actions,[])
})
test('typed semantic values become visible fields without inventing meaning or relationships',()=>{
 const source={owner:'sem-lang',ref:'receipt:1',revision:'revision:1',kind:'semantic'}
 const value={predicate:'term:opaque',arguments:[{role:'role:opaque',value:{Text:'sample@example.test'}}],actor:{Map:{}},id:'claim:1',validity:{valid_from:null,valid_until:null},constraints:[]}
 const data=produce({key:'data:sample',sources:[source],producer:{id:'test',version:'0.10.0',contract:'test',configuration:'test'},focus:'sample',purpose:'subject',visibilityRef:'local-owner',limits:{}},
 [{source,items:[{id:'item:sample',semanticRef:value.predicate,group:{kind:'semantic',ref:value.predicate},value,evidence:[],provenance:[],resolutionRefs:[],visibility:'visible'}],relations:[],unresolved:[],truncated:false}])
 const view=sceneInput(data)
 assert.equal(view.data.presentation[0].title,'Value not available')
 assert.deepEqual(view.data.presentation[0].fields,[{label:'Value 1',value:'sample@example.test'}])
 assert.deepEqual(view.data.items[0].value,value)
 assert.deepEqual(view.data.relations,[])
 assert.deepEqual(view.data.actions,[])
})

test('information bubbles use exactly argument two, preserve original fields and never substitute argument one',()=>{
 const source={owner:'sem-lang',ref:'receipt:2',revision:'revision:2',kind:'semantic'}
 const cases=[
  [{Text:'My visible information'},'My visible information'],[{Integer:0},'0'],[{Boolean:false},'false'],
  [{Text:''},'(empty)'],[{Text:'line one\nline two'},'line one line two'],
  [{Map:{value:'Not a display scalar'}},'Value not available'],[undefined,'Value not available'],
  [{Text:'<img src=x onerror=alert(1)>'},'<img src=x onerror=alert(1)>'],
  [{Text:'日'.repeat(400)},'日'.repeat(340)+'…']
 ]
 const items=cases.map(([second],index)=>({id:'item:'+index,semanticRef:'term:opaque',group:{kind:'semantic',ref:'term:opaque'},value:{arguments:[{value:{Text:'@'}},...(second?[{value:second}]:[])]},evidence:[],provenance:[],resolutionRefs:[],visibility:'visible'}))
 const data=produce({key:'data:bubbles',sources:[source],producer:{id:'test',version:'0.10.0',contract:'test',configuration:'test'},focus:'sample',purpose:'subject',visibilityRef:'local-owner',limits:{}},[{source,items,relations:[],unresolved:[],truncated:false}])
 const view=sceneInput(data)
 assert.deepEqual(view.data.presentation.map(p=>p.title),cases.map(([,expected])=>expected))
 assert.deepEqual(view.data.items,data.data.items)
 for(const item of view.data.presentation){assert.equal(item.fields[0].value,'@');assert.notEqual(item.title,'@')}
 assert.equal(view.data.presentation.at(-1).fields[1].value,'日'.repeat(400))
})
