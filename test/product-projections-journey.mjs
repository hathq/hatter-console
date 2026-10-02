// Actual product service + installed PP + real Hatter CLI. Called while canonical
// test sources are alive; no alternate transport, retention store or fake reader.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {ProductProjections} from '../server/runtime/product-projections.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
const input=JSON.parse(fs.readFileSync(0,'utf8'))
const environment={...process.env,HATTER_HOME:input.home,HATTER_CONSOLE_HANDOFF_VERSION:'1',
  HATTER_CONSOLE_HANDOFF_ACTIVE:'1',HATTER_CLI_EXECUTABLE:input.binary,HATTER_LAUNCH_CWD:input.home,
  HATTER_CLI_EXECUTABLE_SHA256:'sha256:'+createHash('sha256').update(fs.readFileSync(input.binary)).digest('hex')}
const product=new ProductProjections(environment),owner=new SourceOwnerClient(environment)
try{
  await product.startup()
  const sources=await Promise.all(input.owners.map(o=>product.describe(o,input.receipt.commit_ref)))
  const expected=[]
  for(const source of sources){
    const lease=await owner.call({operation:'acquire',source,holder:'acceptance-reference',durationMs:60000})
    const result=await owner.call({operation:'read',source,holder:'acceptance-reference',generation:lease.generation})
    expected.push(result)
    await owner.call({operation:'release',owner:source.owner,holder:'acceptance-reference',generation:lease.generation})
  }
  const key=input.key??'actual-subject'
  const published=await product.submit(input.view??'subject',{key,sources,focus:'owner',id:'product-journey'})
  assert.deepEqual(product.read(published.snapshot.key),published.snapshot)
  if(input.key==='unresolved-subject'){
    const records=expected.find(r=>r.source.owner==='hatter/control').body.records
    const residuals=records.filter(r=>r.kind==='continuation').flatMap(r=>r.value.remainingResiduals)
    assert.ok(residuals.length>0)
    assert.deepEqual(published.snapshot.data.unresolved.flatMap(r=>r.evidence.slice(1)).sort(),residuals.map(r=>r.reference).sort())
  }
  if(input.view==='resolution'){
    assert.equal(published.snapshot.kind,'Scene')
    assert.ok(published.snapshot.data.unresolved.length>0)
    assert.equal(published.snapshot.data.actions[0].targetOwner,'hatter')
    assert.equal(published.snapshot.data.actions[0].commandRef,'inference/role/decide')
    // Multiple confirmations in one server lifetime do not exhaust its bounded
    // producer registry. Only focus changes; canonical sources remain exact.
    for(let n=0;n<9;n++){
      const next=await product.submit('resolution',{key:published.snapshot.key,sources,focus:'confirmation-'+n,id:'repeat-'+n})
      assert.deepEqual(next.snapshot.lineage.sources,published.snapshot.lineage.sources)
    }
    await product.submit('resolution',{key:published.snapshot.key,sources,focus:'owner',id:'restore-focus'})
  }
  assert.deepEqual(published.snapshot.lineage.sources.toSorted((a,b)=>a.owner.localeCompare(b.owner)),sources.toSorted((a,b)=>a.owner.localeCompare(b.owner)))
  for(const {source,body} of expected){
    const items=published.snapshot.data.items.filter(i=>i.sourceRefs[0].owner===source.owner)
    if(source.owner==='sem-lang')assert.deepEqual(items.map(i=>i.value).toSorted((a,b)=>a.id.localeCompare(b.id)),body.claims.toSorted((a,b)=>a.id.localeCompare(b.id)))
    else if(source.owner==='hatter/control')assert.deepEqual(items.map(i=>i.value).toSorted((a,b)=>a.reference.id.localeCompare(b.reference.id)),body.records.toSorted((a,b)=>a.reference.id.localeCompare(b.reference.id)))
    else assert.deepEqual(items.map(i=>i.value),[body])
  }
  assert.equal(product.recoverState({key:published.snapshot.key,revision:published.snapshot.revision}).kind,'NoChange')
  assert.equal(product.recoverState({key:published.snapshot.key,revision:null}).kind,'Snapshot')
  const bad={...sources[0],revision:'0'.repeat(64)}
  await assert.rejects(owner.call({operation:'acquire',source:bad,holder:'negative',durationMs:1000}),error=>{
    assert.equal(error.failure?.parameters.source,'SourceRevisionMismatch')
    assert.equal(error.code,'SourceRevisionMismatch');return true
  })
  assert.deepEqual(product.read(published.snapshot.key),published.snapshot)
  process.stdout.write(JSON.stringify({status:'PASS',sources,projection:published.snapshot})+'\n')
}finally{await product.close();await owner.close()}
