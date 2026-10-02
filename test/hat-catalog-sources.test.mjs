import assert from 'node:assert/strict'
import test from 'node:test'
import {
  catalogSourceSelectParameters, catalogSourceWriteParameters, projectCatalogSources
} from '../server/lib/hat-catalog-source-projection.mjs'

test('projects source trust while hiding a local directory path', () => {
  const projected = projectCatalogSources({ registry: {
    schema: 'hatter://hat/catalog-source-registry/v1', revision: 2,
    selectedSourceId: 'local-hats', sources: [{
      schema: 'hatter://hat/catalog-source/v1', sourceId: 'local-hats',
      label: 'Local releases', kind: 'local_directory', location: '/srv/private/hats',
      logicalOrigin: 'https://hats.example.test', signingKeyId: 'example-catalog-v1',
      publicKeyHex: 'ab'.repeat(32)
    }]
  } })
  assert.equal(projected.sources[0].locationSummary, 'Local directory')
  assert.equal(JSON.stringify(projected).includes('/srv/private/hats'), false)
  assert.equal(projected.sources[0].publicKeyFingerprint, 'ab'.repeat(8))
})

test('projects the valid built-in HTTPS source', () => {
  const value = projectCatalogSources({ registry: {
    schema: 'hatter://hat/catalog-source-registry/v1', revision: 0,
    selectedSourceId: 'ihat-official', sources: [{
      schema: 'hatter://hat/catalog-source/v1', sourceId: 'ihat-official',
      label: 'iHAT official', kind: 'https', location: 'https://ihat.space',
      logicalOrigin: 'https://ihat.space', signingKeyId: 'official-hats-marketplace-v2-r3',
      publicKeyHex: 'ab'.repeat(32)
    }]
  } })
  assert.equal(value.selectedSourceId, 'ihat-official')
  assert.equal(value.sources[0].locationSummary, 'https://ihat.space')
})

test('write and select parameters are closed and revisioned', () => {
  const value = catalogSourceWriteParameters({ sourceId: 'team-hats', label: 'Team HATs',
    kind: 'https', location: 'https://packages.example.test/base',
    logicalOrigin: 'https://hats.example.test', signingKeyId: 'team-catalog-v1',
    publicKeyHex: '12'.repeat(32), expectedRevision: 3, select: true })
  assert.equal(value.expectedRevision, 3)
  assert.deepEqual(catalogSourceSelectParameters({ sourceId: 'team-hats', expectedRevision: 4 }),
    { sourceId: 'team-hats', expectedRevision: 4 })
  assert.throws(() => catalogSourceWriteParameters({ ...value,
    location: 'http://packages.example.test' }), /hat-input-invalid/u)
})
