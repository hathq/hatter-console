import assert from 'node:assert/strict'
import test from 'node:test'
import {gardenRoster,gardenReader} from '../delivery/garden-roster.mjs'
import {rolePreparation} from '../delivery/role-preparation.mjs'

test('concurrent garden readers share only exact in-flight reads, release failure and never reuse a completed roster',async()=>{
 let finish,reads=0,labels=0
 const candidate={roleRef:{id:'role',revision:'r1'},availability:'Available'}
 const runtime={publication:{candidates:()=>{reads++;return new Promise(resolve=>{finish=resolve})},inspect:()=>({streams:[]})},
  rpc:async()=>{labels++;return {roles:[]}},operationalRecords:async()=>({records:[]})}
 const reader=gardenReader(runtime),requests=Array.from({length:8},()=>reader.candidates())
 await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);finish([candidate])
 const subjects=await Promise.all(requests)
 const worlds=await Promise.all(subjects.map(s=>reader.labels(s)))
 assert.equal(labels,1);assert(worlds.every(w=>w===worlds[0]))
 await reader.labels([candidate]);assert.equal(labels,2,'success is not cached')
 runtime.rpc=async()=>{labels++;throw Error('Backpressure')}
 assert((await Promise.allSettled([reader.labels([candidate]),reader.labels([candidate])])).every(r=>r.status==='rejected'))
 assert.equal(labels,3)
 runtime.rpc=async()=>{labels++;return {roles:[]}}
 await reader.labels([{...candidate,roleRef:{...candidate.roleRef,revision:'r2'}}]);assert.equal(labels,4)
 const fresh=reader.candidates();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);finish([]);assert.deepEqual(await fresh,[])
})

test('garden roster reads only necessary owners and never joins a stale identity or fabricates a person',async()=>{
 const calls=[],roleRef={id:'role',revision:'r1',digest_sha256:'digest',schema:'schema'},candidate={roleRef,availability:'Available'}
 const roles={roles:[{roleRef,identityRef:{id:'representative-role:person',revision:2}}]}
 const records={records:[{instance_id:'person',revision:2,display_name:'Person',description:'Description',hat_binding_refs:['binding']}]}
 const runtime={rpc:async(...args)=>{calls.push(args);return roles},operationalRecords:async(...args)=>{calls.push(args);return records},publication:{inspect:()=>({streams:[]})}}
 assert.deepEqual(await gardenRoster(runtime,[]),{title:'Your world',objects:[]});assert.equal(calls.length,0,'empty gardens must not consume two unnecessary response reservations')
 const world=await gardenRoster(runtime,[candidate]);assert.deepEqual(calls,[['inference/role/list',{maximumItems:32}],['representative-role',32]])
 assert.deepEqual(world.objects[0],{id:'role',title:'Person',summary:'Description',symbol:'person',status:'Available',roleRef,preparation:rolePreparation(roles.roles[0],records.records[0]),hatBindings:['binding'],activities:[]})
 records.records[0].revision=1
 assert.equal((await gardenRoster(runtime,[candidate])).objects[0].title,'Display name unavailable')
 roles.roles[0].roleRef={...roleRef,revision:'r2'}
 assert.equal((await gardenRoster(runtime,[candidate])).objects[0].status,'Updating')
 runtime.rpc=async()=>{throw Error('OwnerUnavailable')}
 await assert.rejects(gardenRoster(runtime,[candidate]),/OwnerUnavailable/)
})
