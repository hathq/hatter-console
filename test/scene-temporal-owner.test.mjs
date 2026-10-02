// Hatter 2026: production mapping with the exact InvocationTiming wire shape.
// This is a projection boundary test, not evidence of an executed HAT effect.
import test from 'node:test'
import assert from 'node:assert/strict'
import {produce} from '@hathq/projection-contracts'
import {sourceProjection} from '../server/runtime/product-projections.mjs'
import {sceneInput} from '../server/runtime/scene-input.mjs'

test('execution time comes from the exact owner field; missing, malformed or unrelated source time is never guessed',()=>{
 const source={owner:'hatter/execution',ref:'invocation:one',revision:'exact:1',kind:'operation'}
 const request={key:'execution:one',producer:{id:'operation',version:'0.10.0',contract:'operation',configuration:'exact'},
  sources:[source],focus:source.ref,purpose:'operation',visibilityRef:'local-owner',limits:{}}
 const body={invocationRef:source.ref,status:'pending',timing:{requested_at_unix_ms:1789549200000},result:null}
 const data=produce(request,[sourceProjection(source,body)]),view=sceneInput(data)
 assert.deepEqual(view.data.temporal,{label:'Requested time',items:[{itemId:data.data.items[0].id,at:'2026-09-16T09:00:00.000Z'}]})
 assert.deepEqual(view.data.items,data.data.items)
 assert.deepEqual(sceneInput(view),view)
 for(const timing of [{}, {requested_at_unix_ms:'1789558800000'}, {requested_at_unix_ms:-1}]){
  const invalid=produce(request,[sourceProjection(source,{...body,timing})])
  assert.throws(()=>sceneInput(invalid),{code:'InvalidProjection'})
 }
 const unrelated=produce({...request,purpose:'activity'},[sourceProjection(source,body)])
 assert.equal(sceneInput(unrelated).data.temporal,undefined)
})
