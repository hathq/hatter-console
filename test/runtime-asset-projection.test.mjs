// Actual dynamic layout shape: relative assets are not private local source paths.
import test from 'node:test'
import assert from 'node:assert/strict'
import {assertSafeProjection} from '../server/lib/projection.mjs'
test('explicit relative asset policy preserves layout while private paths and other forbidden fields reject',()=>{
  const value={distributions:[{definition:{files:[{path:'libggml-cpu-x64.so',artifactRef:'a'.repeat(64)}],aliases:[{path:'libggml.so.0',target:'libggml.so.0.22.0'}]}}]}
  assert.throws(()=>assertSafeProjection(value),/projection-field-rejected/)
  assert.equal(assertSafeProjection(value,{relativeAssetPaths:true}),value)
  for(const path of ['/tmp/native','../native','a/native','C:\\native','file:secret','.','..','', 'a'.repeat(129)]){
    assert.throws(()=>assertSafeProjection({path},{relativeAssetPaths:true}),/projection-field-rejected/)
  }
  for(const key of ['command','cwd','secret','token','prompt'])assert.throws(()=>assertSafeProjection({[key]:'value'},{relativeAssetPaths:true}),/projection-field-rejected/)
  assert.throws(()=>assertSafeProjection({path:'sk-abcdefghijklmnop'},{relativeAssetPaths:true}),/projection-secret-rejected/)
})
