// Hatter downstream 2026: local World selection never projects host storage paths.
import test from 'node:test'
import assert from 'node:assert/strict'
import {worldChoices} from '../delivery/site.mjs'

test('browser World choices retain identity and availability but no HATTER_HOME path',()=>{
 const value=worldChoices({schema:'hathq://hatter/worlds/v1',active:'home',mounted:'home',receiptRef:'a'.repeat(64),
  worlds:[{id:'home',name:'Your world',home:'/private/owner/home'},
   {id:'other',name:'Other',home:'/private/owner/other'}],
  availability:{home:true,other:false}})
 assert.deepEqual(value.worlds,[{id:'home',name:'Your world'},{id:'other',name:'Other'}])
 assert.deepEqual(value.availability,{home:true,other:false})
 assert.equal(value.active,'home')
 assert.equal(value.mounted,'home')
 assert.equal(value.receiptRef,'a'.repeat(64))
 assert.equal(JSON.stringify(value).includes('/private/owner'),false)
})
