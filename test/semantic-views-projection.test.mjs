import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { projectSemanticViews } from '../server/lib/semantic-views-projection.mjs'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fixture() {
  const term = { reference: 'sem-lang://concept/' + 'a'.repeat(32), symbol: 'Entity', layer: 'standard-semantic' }
  const language = { schema: 'sem-lang://wire/language-snapshot/v1', owner: 'sem-lang',
    version: '0.10.0', digest: hash([term]), terms: [term] }
  const value = { schema: 'hatter://semantic/views/v1', language, forms: [], views: [{
    id: 'new-domain', scene: 'world', reference: 'extension.example',
    labels: { en: 'A newly declared domain', fr: 'Domaine déclaré' }, baseReference: term.reference,
    formIds: [], providers: ['example'], vocabularyTerms: ['extension.example'], recordKind: 'entity',
    presentationHint: 'list', maximumItems: 12 }] }
  return seal(value)
}
function seal(value) { value.digest = hash({ forms: value.forms, language: value.language, views: value.views }); return value }
test('dictionary boundary accepts novel declarations and rejects broken provenance instead of empty success', () => {
  assert.deepEqual(projectSemanticViews(fixture()), fixture())
  const mutations = [
    value => { value.language.owner = 'hatter' },
    value => { value.language.terms[0].symbol = 'Guessed identity' },
    value => { value.views[0].baseReference = 'sem-lang://concept/' + 'b'.repeat(32) },
    value => { value.views[0].formIds = ['missing-form'] },
    value => { value.views.push(value.views[0]) },
    value => { value.views[0].maximumItems = 100000 },
    value => { value.views[0].presentationHint = 'arbitrary-component' }
    ,value => { value.views[0].labels = { fr: 'English is missing' } }
    ,value => { value.views[0].labels.en = ' ' }
    ,value => { value.views[0].labels = { en: 'Good', 'not a locale': 'Invalid' } }
    ,value => { value.views[0].labels.en = 'x'.repeat(257) }
  ]
  for (const mutate of mutations) {
    const value = fixture(); mutate(value)
    assert.throws(() => projectSemanticViews(seal(value)), /projection-invalid/u)
  }
  const stale = fixture(); stale.views[0].labels.en = 'Altered after verification'
  assert.throws(() => projectSemanticViews(stale), /projection-invalid/u)
  const linked = fixture()
  linked.forms = [{ schema: 'hatter://person-profile/form-descriptor/v2', form_id: 'novel-form',
    value_schema: 'hatter://person-profile/novel/v1', structural_axis: 'novel',
    owner_repository_id: 'hatter', title_key: 'profile.novel.title',
    description_key: 'profile.novel.description', multiple: false, fields: [],
    labels: { en: { 'profile.novel.title': 'A declaration', 'profile.novel.description': 'No fields' } } }]
  linked.views[0].scene = 'person'; linked.views[0].formIds = ['novel-form']
  assert.deepEqual(projectSemanticViews(seal(linked)), linked)
  for (const ids of [[], ['novel-form', 'novel-form']]) {
    const broken = structuredClone(linked); broken.views[0].formIds = ids
    assert.throws(() => projectSemanticViews(seal(broken)), /projection-invalid/u)
  }
})
