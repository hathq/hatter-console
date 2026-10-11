import assert from 'node:assert/strict'

/** Select test data by the owner's public policy before creating a temporary signature. */
export function publicCatalogFixture(catalog,repositoryIds){
  assert(Array.isArray(repositoryIds)&&repositoryIds.length>0)
  assert.equal(new Set(repositoryIds).size,repositoryIds.length)
  const allowed=new Set(repositoryIds)
  const entries=catalog.entries.filter(entry=>allowed.has(entry.repository_id))
  assert.equal(entries.length,allowed.size,'every approved repository requires an exact fixture entry')
  assert.equal(new Set(entries.map(entry=>entry.repository_id)).size,allowed.size)
  const categories=new Set(entries.map(entry=>entry.category_id))
  return {...catalog,entries,categories:catalog.categories.filter(category=>categories.has(category.id))}
}
