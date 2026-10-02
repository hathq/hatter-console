import test from 'node:test'
import assert from 'node:assert/strict'
import {shareDocumentRead,documentReadKey} from '../delivery/site.mjs'
test('HTTP and STATE share one equal in-flight observation; verification, queries, failure and capacity remain separate',async()=>{
 const reads=new Map(),home=new URL('http://localhost/'),catalog=new URL('http://localhost/store'),key=documentReadKey(home)
 assert.equal(key,documentReadKey(home,true));assert.notEqual(documentReadKey(catalog),documentReadKey(catalog,true));assert.notEqual(documentReadKey(new URL('http://localhost/scenes?key=a')),documentReadKey(new URL('http://localhost/scenes?key=b')))
 let finish,calls=0;const produce=()=>{calls++;return new Promise(resolve=>finish=resolve)}
 const one=shareDocumentRead(reads,key,produce),two=shareDocumentRead(reads,documentReadKey(home,true),produce)
 assert.equal(one,two);await Promise.resolve();assert.equal(calls,1);const value={world:{objects:[{id:'exact-role'}]},revision:'exact:1'};finish(value)
 assert.equal(await one,value);assert.equal(await two,value);assert.equal(reads.size,0)
 const failure=Error('OriginalOwnerFailure');await assert.rejects(shareDocumentRead(reads,key,()=>{throw failure}),error=>error===failure);assert.equal(reads.size,0)
 assert.equal(await shareDocumentRead(reads,key,()=>42),42)
 let release;const waiting=new Promise(resolve=>release=resolve),pending=[]
 for(let i=0;i<8;i++)pending.push(shareDocumentRead(reads,'key:'+i,()=>waiting))
 await assert.rejects(shareDocumentRead(reads,'ninth',()=>{throw Error('MustNotRun')}),{code:'ProjectionQueueFull'})
 assert.equal(reads.size,8);release('done');await Promise.all(pending);assert.equal(reads.size,0)
})
