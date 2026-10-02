// Hatter downstream 2026: declarations and exact owner writes share one path.
import test from 'node:test'
import assert from 'node:assert/strict'
import {validateInputDeclaration} from '@zixcel/interaction/input'
import {catalogActions,submitCatalogSettings} from '../delivery/catalog-settings.mjs'
test('catalog settings declare bounded input, retain reviewed revision and refuse invalid trust without writes',async()=>{
 const registry={revision:2,sources:[{sourceId:'team',label:'Team'}]},writes=[]
 const runtime={catalogSources:async()=>registry,selectCatalogSource:async value=>writes.push(value),writeCatalogSource:async value=>writes.push(value)}
 const actions=catalogActions(registry)
 for(const action of actions)assert.deepEqual(validateInputDeclaration(action.input),[])
 const input={sourceId:'local',label:'Local',kind:'local_directory',location:'/explicit/local',logicalOrigin:'https://example.test',
  signingKeyId:'key',publicKeyHex:'a'.repeat(64),federationSigningKeyId:'',federationPublicKeyHex:'',select:false}
 await submitCatalogSettings(runtime,'catalog:write:2',input)
 assert.deepEqual(writes,[{...input,expectedRevision:2,federationSigningKeyId:null,federationPublicKeyHex:null}])
 await submitCatalogSettings(runtime,'catalog:select:2',{sourceId:'team'})
 assert.deepEqual(writes[1],{sourceId:'team',expectedRevision:2})
 for(const [id,value]of [['catalog:write:1',input],['catalog:select:2',{sourceId:'unknown'}],['catalog:write:2',{...input,location:'x'.repeat(4097)}],['catalog:write:2',{...input,secret:'extra'}]])
  await assert.rejects(submitCatalogSettings(runtime,id,value))
 assert.equal(writes.length,2,'no guessed source or rebased revision')
})
