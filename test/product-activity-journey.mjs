// Hatter D1 2026: actual Graph Work -> exact source -> installed PP -> restart.
// No fixture producer or substituted owner response. Called by the four-Role test.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {ProductProjections} from '../server/runtime/product-projections.mjs'
import {ProductPublication} from '../server/runtime/product-publication.mjs'
const input=JSON.parse(fs.readFileSync(0,'utf8'))
const environment={...process.env,HATTER_HOME:input.home,HATTER_CONSOLE_HANDOFF_VERSION:'1',
 HATTER_CONSOLE_HANDOFF_ACTIVE:'1',HATTER_CLI_EXECUTABLE:input.binary,HATTER_LAUNCH_CWD:input.home,
 HATTER_CLI_EXECUTABLE_SHA256:'sha256:'+createHash('sha256').update(fs.readFileSync(input.binary)).digest('hex')}
const product=new ProductProjections(environment)
let publication
try{
 await product.provisionSourceOwners()
 await product.startup()
 publication=new ProductPublication(product,input.home)
 const previous=publication.inspect().streams.length?product.read(publication.inspect().streams[0].key):null
 const first=await publication.reconcile()
 assert.equal(first.state,'Published',JSON.stringify(first))
 assert.equal(first.streams.length,1)
 const key=first.streams[0].key,snapshot=product.read(key)
 assert.equal(snapshot.lineage.request.purpose,'activity')
 assert.equal(snapshot.kind,'Data')
 assert.equal(snapshot.lineage.sources.length,1)
 assert.equal(snapshot.lineage.sources[0].owner,'hatter/control')
 const actual=Object.fromEntries(snapshot.data.items.map(item=>{
  assert.equal(item.value.kind,'work');assert.equal(item.sourceRefs[0].ref,snapshot.lineage.sources[0].ref)
  return [item.value.value.spec.requestRef,item.value.value]
 }))
 assert.deepEqual(actual,input.works,'all states, identities, claims, receipts and exact references must match')
 assert.equal(snapshot.data.unresolved.length,0,'waiting input is not a fabricated semantic Confirmation')
 assert.equal(publication.inspect().selected,null,'Activity requires no synthetic selected Role')
 assert.equal(product.recoverState({key,revision:snapshot.revision}).kind,'NoChange')
 await publication.close();publication=new ProductPublication(product,input.home)
 const restarted=await publication.reconcile()
 assert.equal(restarted.state,'Published')
 assert.deepEqual(product.read(key),snapshot,'restart cannot invent progress or a new projection revision')
 await publication.recover(key)
 assert.deepEqual(product.read(key),snapshot)
 assert.equal(product.recoverState({key,revision:null}).kind,'Snapshot')
 let browser=null
 if(Object.values(input.works).every(w=>w.state.Completed)){
  await publication.close()
  browser=await (await import('./product-activity-browser.mjs')).activityBrowser(input,environment,previous,snapshot)
 }
 process.stdout.write(JSON.stringify({status:'PASS',key,revision:snapshot.revision,source:snapshot.lineage.sources[0],
  requests:Object.keys(actual),states:Object.values(actual).map(w=>w.state),browser})+'\n')
}finally{await publication?.close();await product.close()}
