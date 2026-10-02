// Added by the Hatter downstream project, 2026.
// Purpose: prove browser profile forms and schema graphs reject executable or untyped input.
import assert from 'node:assert/strict'
import test from 'node:test'
import { profileWriteParameters, projectProfileForms, projectSchemaGraph }
  from '../server/lib/profile-projection.mjs'

test('profile write keeps only closed scalar values and exact revision', () => {
  const value = profileWriteParameters({ entryId: 'languages',
    formId: 'hatter-profile-languages', values: { primary_language: 'ja-JP' },
    expectedRevision: 1 })
  assert.equal(JSON.parse(value.entryJson).expected_revision, 1)
  assert.throws(() => profileWriteParameters({ entryId: 'languages', formId: 'form',
    values: { nested: { inferred: true } } }), /profile-projection-invalid/)
})

test('form projection accepts closed selections and rejects unknown UI kinds', () => {
  const descriptor = { schema: 'hatter://person-profile/form-descriptor/v2',
    form_id: 'hatter-profile-languages', value_schema: 'hatter://person-profile/languages/v1',
    structural_axis: 'preference-objective', owner_repository_id: 'hatter',
    title_key: 'profile.languages.title', description_key: 'profile.languages.description',
    multiple: false, labels: { en: { 'profile.languages.title': 'Languages', 'profile.languages.description': 'Description', 'profile.field.primary_language': 'Language' } }, fields: [{ path: 'primary_language', kind: 'select',
      input_mode: 'candidate-selection',
      meaning: { reference: 'hatter://meaning/language', baseReference: 'sem-lang://concept/1234', languageDigest: 'a'.repeat(64), definitionDigest: 'b'.repeat(64), schemaId: 'hatter://person-profile/languages/v1', fieldPath: 'primary_language' },
      label_key: 'profile.field.primary_language', required: true,
      minimum_length: 1, maximum_length: 35, format: 'language-tag',
      option_values: ['en', 'ja'], depends_on: null }] }
  const projected = projectProfileForms({ formsJson: JSON.stringify([descriptor]) })
  assert.deepEqual(projected.forms[0].fields[0].optionValues, ['en', 'ja'])
  assert.equal(projected.forms[0].fields[0].inputMode, 'candidate-selection')
  assert.throws(() => projectProfileForms({ formsJson: JSON.stringify([{
    ...descriptor, fields: [{ ...descriptor.fields[0], kind: 'component' }] }] ) }))
  assert.throws(() => projectProfileForms({ formsJson: JSON.stringify([{
    ...descriptor, fields: [{ ...descriptor.fields[0], option_values: [] }] }] ) }))
  assert.throws(() => projectProfileForms({ formsJson: JSON.stringify([{
    ...descriptor, fields: [{ ...descriptor.fields[0], option_values: ['ja', 'EN'] }] }] ) }))
  assert.throws(() => projectProfileForms({ formsJson: JSON.stringify([{
    ...descriptor, fields: [{ ...descriptor.fields[0], input_mode: 'owner-asserted' }] }] ) }))
})

test('schema graph rejects dangling edges', () => {
  const graph = { schema: 'hatter://management/semantic-schema-graph/v2',
    nodes: [{ id: 'hatter', label: 'Hatter', kind: 'system', owner_repository_id: 'hatter',
      schema_id: null, facts: [] }], edges: [{ from: 'hatter', to: 'missing', kind: 'owns' }] }
  assert.throws(() => projectSchemaGraph({ graphJson: JSON.stringify(graph) }))
})
