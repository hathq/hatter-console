import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {canonical} from '@hathq/projection-contracts'
import {fork} from 'node:child_process'
import {FileProjectionStore} from '@hathq/projection-runtime/store'
import {ProductPublication} from '../server/runtime/product-publication.mjs'
function fixture(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'hatter-product-publication-'));fs.mkdirSync(path.join(home,'derived'))
  let receipt='r:1';const snapshots=new Map(),submissions=[]
  const roleRef={id:'role',revision:1,digest_sha256:'a'.repeat(64)},subjectRef={id:'person',class:'person'}
  const product={
    sourceInteraction:async()=>null,
    withPublicationMetadata:async operation=>operation(),
    operations:async()=>({targets:[]}),
    targets:async known=>({head:{commit:receipt},targets:known===receipt?null:[{kind:'subject',roleRef:{...roleRef,revision:receipt==='r:1'?1:2},subjectRef,receiptRef:receipt}]}),
    describe:async(owner,ref)=>({owner,ref,revision:ref,kind:owner==='sem-lang'?'semantic':'control'}),
    maintain:async()=>[],inspect:()=>({store:{repairs:[]}}),read:key=>snapshots.get(key)??null,
    submit:async(view,intent)=>{const {signal,...persisted}=intent;assert.ok(signal instanceof AbortSignal);submissions.push(structuredClone(persisted));const snapshot={revision:'pp:'+intent.canonicalReceipt,
      lineage:{sources:[...intent.sources].reverse()}};snapshots.set(intent.key,snapshot);return {snapshot}},
  }
  return {home,product,submissions,roleRef,advance:()=>{receipt='r:2'},cleanup:()=>fs.rmSync(home,{recursive:true,force:true})}
}
test('shutdown cancels a blocked derived scan or producer, joins it and never resends canonical work',{timeout:1000},async()=>{
 for(const stage of ['targets','submit']){
  const f=fixture();let publisher,entered
  const blocked=new Promise(resolve=>{entered=resolve})
  let calls=0,aborted=false
  try{
   publisher=new ProductPublication(f.product,f.home)
   await publisher.select(f.roleRef)
   const declared=publisher.inspect().streams[0]
   assert.equal(declared.roleId,f.roleRef.id);assert.equal(declared.view,'subject')
   assert.deepEqual(Object.keys(declared).sort(),['key','roleId','status','view'],'presentation receives identity, not a private producer plan')
   const wait=signal=>new Promise((resolve,reject)=>{
    calls++;entered()
    assert.ok(signal instanceof AbortSignal)
    signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason)},{once:true})
   })
   if(stage==='targets')f.product.targets=async(_head,options)=>wait(options.signal)
   else f.product.submit=async(_view,intent)=>wait(intent.signal)
   const cycle=publisher.reconcile();const settled=cycle.catch(error=>error)
   await blocked
   await publisher.close();await settled
   assert.equal(aborted,true);assert.equal(calls,1)
   assert.equal(publisher.inspect().running,false)
   await assert.rejects(publisher.reconcile(),{code:'ProjectionRuntimeClosed'})
   assert.equal(calls,1)
   if(stage==='submit'){
    const state=JSON.parse(fs.readFileSync(path.join(f.home,'derived/product-publication.json')))
    assert.equal(state.streams[0].intent.canonicalReceipt,'r:1')
    assert.equal(state.streams[0].status.state,'Pending')
   }
  }finally{await publisher?.close();f.cleanup()}
 }
})
test('Activity follows exact scheduler receipts without selecting or inventing a Role and survives publisher restart',async()=>{
 const f=fixture();let publisher,receipt='schedule:1'
 try{
  f.product.targets=async known=>({head:{commit:receipt},targets:known===receipt?null:[{kind:'activity',receiptRef:receipt}]})
  publisher=new ProductPublication(f.product,f.home)
  await publisher.reconcile()
  assert.equal(f.submissions.length,1)
  assert.equal(f.submissions[0].view,'activity')
  assert.equal(f.submissions[0].interaction,null)
  assert.deepEqual(f.submissions[0].sources,[{owner:'hatter/control',ref:receipt,revision:receipt,kind:'control'}])
  assert.equal(publisher.inspect().selected,null)
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.home,'derived','product-publication.json'))).streams[0].roleId,null)
  await publisher.reconcile();assert.equal(f.submissions.length,1)
  receipt='schedule:2';await publisher.close();publisher=new ProductPublication(f.product,f.home)
  await publisher.reconcile();assert.equal(f.submissions.length,2)
  assert.equal(f.submissions[1].key,f.submissions[0].key)
  assert.equal(f.submissions[1].canonicalReceipt,receipt)
  assert.equal(publisher.inspect().streams.length,1)
 }finally{await publisher?.close();f.cleanup()}
})
test('optional execution and input owners cannot suppress Subject publication; exact failures remain inspectable and recover independently',async()=>{
 const f=fixture();let publisher
 const failure={owner:'hatter/execution',operation:'operations',code:'hat-state-unavailable',requirementRef:'hatter:execution',detail:{sourceRecord:{Io:'NotFound'}}}
 try{
  f.product.operations=async()=>{throw Object.assign(Error('missing execution owner'),{code:'SourceUnavailable',failure})}
  f.product.sourceInteraction=async()=>{throw Object.assign(Error('missing input provider'),{code:'SourceUnavailable',failure:{...failure,owner:'hatter/input',operation:'sourceDescribe'}})}
  publisher=new ProductPublication(f.product,f.home)
  const selected=await publisher.select(f.roleRef)
  assert.equal(selected.projection.state,'Pending');assert.equal(f.submissions.length,0)
  const published=await publisher.reconcile()
  assert.equal(published.streams[0].state,'Published');assert.equal(f.submissions.length,1)
  assert.equal(f.submissions[0].interaction,null)
  assert.deepEqual(publisher.inspect().ownerFailures.map(v=>v.failure.code),['hat-state-unavailable','hat-state-unavailable'])
  await publisher.reconcile();assert.equal(f.submissions.length,1,'missing optional state cannot cause republishing')
  f.product.operations=async()=>({targets:[]});f.product.sourceInteraction=async()=>null
  await publisher.reconcile();assert.deepEqual(publisher.inspect().ownerFailures,[])
 }finally{await publisher?.close();f.cleanup()}
})
test('explicit selection persists before publication, canonical advance recovers before trigger persistence after restart, and unchanged receipt cannot cause a publication storm',async()=>{
  const f=fixture();let publisher
  try{
    publisher=new ProductPublication(f.product,f.home)
    await publisher.reconcile();assert.equal(f.submissions.length,0)
    await assert.rejects(publisher.select({...f.roleRef,revision:9}));assert.equal(f.submissions.length,0)
    const selected=await publisher.select(f.roleRef);assert.notEqual(selected.key,f.roleRef.id);assert.equal(f.submissions.length,0)
    assert.equal(selected.projection.state,'Pending')
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.home,'derived','product-publication.json'))).selected.roleId,f.roleRef.id)
    await publisher.reconcile();assert.equal(f.submissions.length,1)
    await assert.rejects(publisher.recover('unregistered'),{code:'SceneUnavailable'})
    assert.equal(f.submissions.length,1,'unregistered recovery cannot invent a producer')
    await publisher.recover(selected.key)
    assert.equal(f.submissions.length,1,'explicit recovery keeps a valid current publication')
    // Canonical change precedes the next trigger; restart only sees canonical
    // owner state + previously durable product selection, not browser history.
    f.advance();await publisher.close();publisher=new ProductPublication(f.product,f.home)
    await publisher.reconcile();assert.equal(f.submissions.length,2)
    assert.equal(f.submissions[1].key,selected.key);assert.equal(f.submissions[1].canonicalReceipt,'r:2')
    assert.ok(f.submissions[1].sources.every(s=>s.ref==='r:2'))
    await Promise.all([publisher.reconcile(),publisher.reconcile()]);assert.equal(f.submissions.length,2)
    assert.equal(publisher.inspect().bounds.concurrent,1)
  }finally{await publisher?.close();f.cleanup()}
})
test('failed derived publication requires explicit recovery, retains exact canonical source and never repeats its canonical mutation',async()=>{
 const f=fixture();let publisher,attempts=0
 const publish=f.product.submit
 f.product.submit=async(...args)=>{attempts++;if(attempts===1)throw Object.assign(Error('derived store refused'),{code:'ProjectionStoreCorrupt'});return publish(...args)}
 try{
  publisher=new ProductPublication(f.product,f.home);const {key}=await publisher.select(f.roleRef)
  await publisher.reconcile();assert.equal(publisher.inspect().streams[0].status.state,'FailedTyped')
  await publisher.reconcile();assert.equal(attempts,1,'no automatic retry of a terminal derived failure')
  await publisher.recover(key);assert.equal(attempts,1,'acknowledge retry intent without awaiting derived execution')
  await publisher.reconcile();assert.equal(attempts,2)
  assert.equal(publisher.inspect().streams[0].status.state,'Published')
  assert.equal(f.submissions[0].canonicalReceipt,'r:1')
  await publisher.recover(key);await publisher.reconcile();assert.equal(attempts,2,'valid current state does not republish')
 }finally{await publisher?.close();f.cleanup()}
})
test('stale publishers cannot overwrite durable selection, metadata reads are bounded, and a post-command scan cannot join a pre-command head',async()=>{
  const f=fixture();let first,second
  try{
    first=new ProductPublication(f.product,f.home);second=new ProductPublication(f.product,f.home)
    await first.select(f.roleRef)
    await first.reconcile()
    await assert.rejects(second.select(f.roleRef),{code:'ProjectionStoreBusy'})
    assert.equal(f.submissions.length,1)
    await second.reconcile();assert.equal(f.submissions.length,1)
    // Capture an old owner response, commit while that scan is in flight, then
    // ask publication to correlate the newly accepted command with a fresh read.
    const targets=f.product.targets;let entered,release
    const reading=new Promise(r=>entered=r),pause=new Promise(r=>release=r)
    let once=true
    f.product.targets=async known=>{const value=await targets(known);if(once){once=false;entered();await pause}return value}
    const old=first.reconcile();await reading;f.advance()
    const after=first.afterCanonical();release();await old;await after
    assert.equal(f.submissions.length,2);assert.equal(f.submissions[1].canonicalReceipt,'r:2')
    const file=path.join(f.home,'derived','product-publication.json')
    fs.writeFileSync(file,' '.repeat(131073))
    assert.throws(()=>new ProductPublication(f.product,f.home),{code:'ProjectionStoreCorrupt'})
    fs.unlinkSync(file);fs.symlinkSync('/dev/null',file)
    assert.throws(()=>new ProductPublication(f.product,f.home),{code:'ProjectionStoreCorrupt'})
  }finally{await first?.close();await second?.close();f.cleanup()}
})
test('closed published confirmation trigger metadata can yield a bounded slot, but a PP repair remains exclusively protected',async()=>{
  const f=fixture();let publisher
  try{
    const hash=value=>createHash('sha256').update(canonical(value)).digest('hex')
    const streams=Array.from({length:8},(_,i)=>{
      const view=i%2?'subject':'resolution',target='c:'+i,key='product:'+hash({view,target})
      const specification={view,key,focus:target,interaction:null,canonicalReceipt:'r:old',
        sources:[{owner:'hatter/control',ref:'r:old',revision:'r:old',kind:'control'}]}
      return {key,view,target,roleId:'previous',intent:{...specification,id:'trigger:'+hash(specification)},
        status:{state:'Published',revision:'pp:old',canonicalReceipt:'r:old'}}
    })
    const file=path.join(f.home,'derived','product-publication.json')
    fs.writeFileSync(file,JSON.stringify({selected:null,streams}))
    f.product.inspect=()=>({store:{repairs:streams.map(s=>({id:s.intent.id}))}})
    publisher=new ProductPublication(f.product,f.home)
    await assert.rejects(publisher.select(f.roleRef),{code:'ProjectionLimitExceeded'})
    assert.equal(f.submissions.length,0);assert.equal(publisher.inspect().streams.length,8)
    assert.equal(publisher.inspect().selected,null)
    assert.equal(JSON.parse(fs.readFileSync(file)).selected,null)
    f.product.inspect=()=>({store:{repairs:[]}})
    await publisher.select(f.roleRef)
    await publisher.reconcile()
    assert.equal(f.submissions.length,1);assert.equal(publisher.inspect().streams.length,8)
    assert.equal(publisher.inspect().streams.some(s=>s.key===streams[0].key),false)
    const stored=JSON.parse(fs.readFileSync(file))
    for(const alter of [
      state=>{state.selected.extra='not allowed'},
      state=>{state.streams[0].intent.sources[0].path='/private'},
      state=>{state.streams[0].intent.canonicalReceipt='forged'},
      state=>{state.streams[0].intent.interaction={input:{}}},
      state=>{state.streams[0].status.state='unknown'},
      state=>{state.streams[0].key='forged'},
    ]){
      const state=structuredClone(stored);alter(state);fs.writeFileSync(file,JSON.stringify(state))
      assert.throws(()=>new ProductPublication(f.product,f.home),{code:'ProjectionStoreCorrupt'})
    }
  }finally{await publisher?.close();f.cleanup()}
})
test('two actual processes share PP kernel exclusion: one selection wins, the stale contender cannot overwrite or submit',async()=>{
  const f=fixture(),children=[]
  try{
    FileProjectionStore.create(path.join(f.home,'derived','projections'))
    const start=()=>{
      const child=fork(new URL('./product-publication-process.mjs',import.meta.url),[f.home],{silent:true})
      children.push(child)
      let ready,resolve,reject,stderr='',result
      const prepared=new Promise(r=>ready=r),done=new Promise((r,j)=>{resolve=r;reject=j})
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('publication child timeout'))},8000)
      child.stderr.on('data',b=>{stderr+=b.toString()})
      child.on('message',v=>{if(v.ready)ready();else result=v})
      child.on('error',reject)
      child.on('exit',(code,signal)=>{clearTimeout(timer);if(code!==0||signal||stderr)reject(Error(JSON.stringify({code,signal,stderr})));else resolve(result)})
      return {child,prepared,done}
    }
    const a=start(),b=start()
    await Promise.all([a,b].map(p=>Promise.race([p.prepared,p.done.then(()=>{throw Error('child exited before readiness')})])))
    a.child.send('select');b.child.send('select')
    const results=await Promise.all([a.done,b.done])
    assert.deepEqual(results.map(r=>r.state).sort(),['ProjectionStoreBusy','Published'])
    assert.equal(results.reduce((n,r)=>n+r.calls,0),1)
    const stored=JSON.parse(fs.readFileSync(path.join(f.home,'derived','product-publication.json')))
    assert.deepEqual(stored.selected,{roleId:'role',subjectRef:{id:'owner',class:'person'}})
    assert.equal(stored.streams.length,1);assert.equal(stored.streams[0].status.state,'Published')
  }finally{
    await Promise.all(children.map(child=>{
      if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve()
      return new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL')})
    }))
    f.cleanup()
  }
})
test('a repeatedly timed-out key cannot starve independent operation publications; each cycle still admits one attempt',async()=>{
  const f=fixture();let publisher
  try{
    f.product.operations=async()=>({targets:[1,2].map(n=>({roleRef:f.roleRef,invocationRef:'operation:'+n,
      sources:['hatter/admission','hatter/execution'].map(owner=>({owner,ref:'operation:'+n,revision:'r:1',kind:'operation'}))}))})
    const submit=f.product.submit;let attempts=0
    f.product.submit=async(view,input)=>{attempts++;if(view==='subject')throw Object.assign(Error('timeout'),{code:'ProjectionExecutionTimeout'});return submit(view,input)}
    publisher=new ProductPublication(f.product,f.home)
    assert.equal((await publisher.select(f.roleRef)).projection.state,'Pending')
    for(let i=0;i<6;i++){
      const before=attempts;await publisher.reconcile();assert.ok(attempts-before<=1)
    }
    assert.deepEqual(f.submissions.map(i=>i.focus).sort(),['operation:1','operation:2'])
    assert.equal(publisher.inspect().streams.filter(s=>s.status.state==='Published').length,2)
  }finally{await publisher?.close();f.cleanup()}
})
