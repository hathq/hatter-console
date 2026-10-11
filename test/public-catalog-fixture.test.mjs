import test from 'node:test'
import assert from 'node:assert/strict'
import {publicCatalogFixture} from './helpers/public-catalog-fixture.mjs'

test('public fixture excludes extra packages and categories without mutating the signed source',()=>{
  const source={entries:[{repository_id:'allowed',category_id:'public'},{repository_id:'extra',category_id:'private'}],categories:[{id:'public'},{id:'private'}]}
  const result=publicCatalogFixture(source,['allowed'])
  assert.deepEqual(result.entries,[source.entries[0]])
  assert.deepEqual(result.categories,[source.categories[0]])
  assert.equal(source.entries.length,2)
  assert.equal(source.categories.length,2)
})
test('missing or repeated approved identities cannot produce a partial fixture',()=>{
  const source={entries:[{repository_id:'allowed',category_id:'public'}],categories:[{id:'public'}]}
  assert.throws(()=>publicCatalogFixture(source,['missing']))
  assert.throws(()=>publicCatalogFixture(source,['allowed','allowed']))
  assert.throws(()=>publicCatalogFixture({...source,entries:[source.entries[0],source.entries[0]]},['allowed']))
})
