import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  projectHatDiscovery, unavailableHatDiscovery
} from '../server/lib/hat-discovery-projection.mjs'

test('keeps candidate discovery empty instead of guessing without a signed catalog', () => {
  const value = unavailableHatDiscovery()
  assert.equal(value.status, 'unavailable')
  assert.equal(value.candidateSource, 'signed-catalog')
  assert.equal(value.genreSource, 'hat-information-coordinate.data_domain_term_id')
  assert.equal(value.artifactAcquisitionAvailable, false)
  assert.equal(value.catalogDigestSha256, null)
  assert.deepEqual(value.candidates, [])
  assert.deepEqual(value.genres, [])
})

test('projects verified candidates into signed categories without granting authority', () => {
  const digest = 'ab'.repeat(32)
  const value = projectHatDiscovery({ catalog: {
    schema: 'hatter://hat/catalog-projection/v1', source: 'https://ihat.space',
    sourceId: 'ihat-official', sourceLabel: 'iHAT official', sourceKind: 'https',
    artifactAcquisitionAvailable: true,
    catalogDigestSha256: digest,
    categories: [{ id: 'finance', termId: 'hathq://vocabulary/data-domain/finance/v1',
      name: 'お金・会計', summary: '会計を扱います。', installedHatCount: 0 }],
    candidates: [{ repositoryId: 'hat-accountant', packageId: 'hat/accountant',
      version: '1.0.0', packageSha256: digest, name: '会計担当',
      summary: '会計記録を確認します。', categoryId: 'finance', assurance: 'official',
      residenceScopes: ['JP', 'JP-13'], installed: false }]
  } })
  assert.equal(value.status, 'available')
  assert.equal(value.candidates[0].availability, 'installable')
  assert.equal(value.candidates[0].assurance, 'official')
  assert.deepEqual(value.candidates[0].residenceScopes, ['JP', 'JP-13'])
  assert.equal(value.genres[0].installedHatCount, 0)
  assert.equal(value.genres[0].availableHatCount, 1)
  assert.throws(() => projectHatDiscovery({ catalog: {
    schema: 'hatter://hat/catalog-projection/v1', source: 'https://ihat.space',
    sourceId: 'ihat-official', sourceLabel: 'iHAT official', sourceKind: 'https',
    artifactAcquisitionAvailable: true, catalogDigestSha256: digest,
    categories: [{ id: 'finance', termId: 'hathq://vocabulary/data-domain/finance/v1',
      name: 'お金・会計', summary: '会計を扱います。', installedHatCount: 0 }],
    candidates: [{ repositoryId: 'hat-accountant', packageId: 'hat/accountant',
      version: '1.0.0', packageSha256: digest, name: '会計担当',
      summary: '会計記録を確認します。', categoryId: 'finance', assurance: 'unverified',
      residenceScopes: [], installed: false }]
  } }), /catalog-projection-invalid/u)
})

test('keeps verified cached candidates visible but not installable', () => {
  const digest = 'ab'.repeat(32)
  const value = projectHatDiscovery({ catalog: {
    schema: 'hatter://hat/catalog-projection/v1', source: 'https://ihat.space',
    sourceId: 'local-hats', sourceLabel: 'Local HATs', sourceKind: 'local_directory',
    artifactAcquisitionAvailable: false, catalogDigestSha256: digest,
    categories: [{ id: 'finance', termId: 'hathq://vocabulary/data-domain/finance/v1',
      name: 'お金・会計', summary: '会計を扱います。', installedHatCount: 0 }],
    candidates: [{ repositoryId: 'hat-accountant', packageId: 'hat/accountant',
      version: '1.0.0', packageSha256: digest, name: '会計担当',
      summary: '会計記録を確認します。', categoryId: 'finance', assurance: 'source-pinned',
      residenceScopes: [], installed: false }]
  } })
  assert.equal(value.status, 'available')
  assert.equal(value.candidates[0].availability, 'unavailable')
  assert.equal(value.candidates[0].assurance, 'source-pinned')
  assert.equal(value.candidates[0].updateState, 'blocked')
})

test('does not allow a HAT to inject navigation paths or presentation chrome', async () => {
  const schema = JSON.parse(await readFile(new URL(
    '../protocol-snapshot/hat-discovery-contract.schema.json', import.meta.url)))
  const candidate = schema.$defs.candidate.properties
  const genre = schema.$defs.genre.properties
  for (const field of ['path', 'route', 'icon', 'component', 'executable']) {
    assert.equal(field in candidate, false)
    assert.equal(field in genre, false)
  }
  assert.deepEqual(candidate.assurance.enum, ['official', 'source-pinned'])
  assert.equal(schema.$defs.genre.properties.termId.pattern.startsWith(
    '^hathq://vocabulary/data-domain/'), true)
})
