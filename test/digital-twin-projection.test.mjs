import assert from 'node:assert/strict'
import test from 'node:test'
import { digitalTwinDefinition, digitalTwinDefinitions, digitalTwinReadParameters,
  projectDigitalTwinArea } from '../server/lib/digital-twin-projection.mjs'

const dictionary = { views: [{ id: 'people', scene: 'world', recordKind: 'entity',
  vocabularyTerms: ['world.person.identity'], maximumItems: 128, presentationHint: 'cards',
  labels: { en: 'People from dictionary', ja: '人' }, reference: 'world.person.identity' }] }
test('selects exactly adopted views, including novel terms, without a fixed category list', () => {
  assert.deepEqual(digitalTwinDefinitions(dictionary).map(value => value.projectionId), ['people'])
  const expanded = { views: [...dictionary.views, { ...dictionary.views[0],
    id: 'novel', labels: { en: 'Novel domain', fr: 'Domaine nouveau' }, vocabularyTerms: ['extension.novel'] }] }
  assert.deepEqual(digitalTwinDefinitions(expanded).map(value => value.projectionId), ['people', 'novel'])
  assert.deepEqual(digitalTwinDefinition(expanded, 'novel').vocabularyTerms, ['extension.novel'])
  assert.throws(() => digitalTwinDefinition(dictionary, 'novel'), /projection-unknown/u)
  assert.equal(digitalTwinDefinition(expanded, 'novel', 'fr-CA').label, 'Domaine nouveau')
  assert.equal(digitalTwinDefinition(dictionary, 'people', 'ja-JP').label, '人')
  assert.deepEqual(digitalTwinReadParameters(digitalTwinDefinition(dictionary, 'people', 'ja')),
    digitalTwinReadParameters(digitalTwinDefinition(dictionary, 'people', 'en')))
})

test('sends only closed management projection fields', () => {
  const definition = digitalTwinDefinition(dictionary, 'people')
  const parameters = digitalTwinReadParameters(definition)
  assert.deepEqual(parameters, {
    projectionId: 'people', recordKind: 'entity',
    vocabularyTerms: ['world.person.identity'], maximumItems: 128,
    presentationHint: 'cards'
  })
  assert.equal('label' in parameters, false)
  assert.equal('summary' in parameters, false)
})

test('projects bounded graph values without exposing bytes or backend types', () => {
  const definition = digitalTwinDefinition(dictionary, 'people')
  const value = projectDigitalTwinArea(definition, {
    schema: 'hathq://hatter/digital-twin-projection/v2', projectionId: 'people',
    graphRevision: 4, presentationHint: 'cards', truncated: false, items: [{
      semanticId: 'person:self', recordKind: 'entity',
      vocabularyTypes: ['world.person.identity'], properties: {
        canonical_id: { kind: 'string', value: 'person:self' },
        opaque: { kind: 'bytes', value: [1, 2, 3] }
      }
    }]
  })
  assert.equal(value.itemCount, 1)
  assert.equal(value.items[0].properties.opaque, '[3 bytes]')
  assert.equal(JSON.stringify(value).includes('redb'), false)
})
