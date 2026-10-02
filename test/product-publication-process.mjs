// Test-owned process exercising the installed PP kernel exclusion, not an
// in-memory substitute for cross-process metadata CAS.
import path from 'node:path'
import {FileProjectionStore} from '@hathq/projection-runtime/store'
import {ProductPublication} from '../server/runtime/product-publication.mjs'
const home=process.argv[2],store=new FileProjectionStore(path.join(home,'derived','projections'))
const roleRef={id:'role',revision:1,digest_sha256:'a'.repeat(64)}
let calls=0
const product={
  withPublicationMetadata:operation=>store.withAttempt('product-publication-metadata',operation),
  sourceInteraction:async()=>null,
  targets:async()=>({head:{commit:'receipt:one'},targets:[{kind:'subject',roleRef,
    subjectRef:{id:'owner',class:'person'},receiptRef:'receipt:one'}]}),
  operations:async()=>({targets:[]}),maintain:async()=>[],inspect:()=>({store:{repairs:[]}}),read:()=>null,
  describe:async(owner,ref)=>({owner,ref,revision:ref,kind:owner==='sem-lang'?'semantic':'control'}),
  submit:async()=>{calls++;return {snapshot:{revision:'pp:one'}}},
}
const publication=new ProductPublication(product,home)
process.send({ready:true})
process.once('message',async()=>{
  try{await publication.select(roleRef);await publication.reconcile();process.send({state:'Published',calls})}
  catch(error){process.send({state:error.code,calls})}
  finally{await publication.close();process.disconnect()}
})
