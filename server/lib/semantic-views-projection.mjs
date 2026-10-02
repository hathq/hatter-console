// Hatter: validate one released language/application declaration snapshot, without semantic inference.
import { createHash } from 'node:crypto'
import { assertSafeProjection } from './projection.mjs'
import { projectProfileForms } from './profile-projection.mjs'

export function projectSemanticViews(value) {
  if (value?.schema !== 'hatter://semantic/views/v1'
    || value.language?.schema !== 'sem-lang://wire/language-snapshot/v1'
    || value.language.owner !== 'sem-lang' || value.language.version !== '0.10.0'
    || !/^[0-9a-f]{64}$/u.test(value.language.digest ?? '')
    || !Array.isArray(value.language.terms) || !value.language.terms.length
    || value.language.terms.length > 4096 || !Array.isArray(value.views)
    || value.views.length > 256 || !Array.isArray(value.forms) || value.forms.length > 256) invalid()
  const references = new Set(value.language.terms.map(term => term.reference))
  if (references.size !== value.language.terms.length || value.language.terms.some(term =>
    !/^sem-lang:\/\/concept\/[0-9a-f]{32}$/u.test(term.reference)
    || typeof term.symbol !== 'string' || !term.symbol || term.symbol.length > 128
    || !['semantic-basis', 'standard-semantic'].includes(term.layer))) invalid()
  const languageDigest = createHash('sha256').update(JSON.stringify(value.language.terms.map(term => ({
    reference: term.reference, symbol: term.symbol, layer: term.layer })))).digest('hex')
  if (languageDigest !== value.language.digest) invalid()
  const ids = new Set(), forms = new Map(value.forms.map(form => [form.form_id, form]))
  const coveredForms = new Set()
  if (forms.size !== value.forms.length) invalid()
  for (const view of value.views) {
    if (!/^[a-z][a-z0-9-]{0,127}$/u.test(view.id ?? '') || ids.has(`${view.scene}:${view.id}`)
      || !['person', 'world'].includes(view.scene) || !references.has(view.baseReference)
      || Object.hasOwn(view, 'label') || !validLabels(view.labels)
      || !Array.isArray(view.formIds) || view.formIds.some(id => !forms.has(id))
      || new Set(view.formIds).size !== view.formIds.length
      || (view.scene === 'world' && view.formIds.length > 0)
      || !Array.isArray(view.providers) || view.providers.length > 256
      || !Array.isArray(view.vocabularyTerms) || view.vocabularyTerms.length > 32
      || !['entity', 'event', 'assertion'].includes(view.recordKind)
      || !['list', 'table', 'cards', 'timeline'].includes(view.presentationHint)
      || !Number.isSafeInteger(view.maximumItems) || view.maximumItems < 1 || view.maximumItems > 256) invalid()
    ids.add(`${view.scene}:${view.id}`)
    for (const id of view.formIds) coveredForms.add(id)
  }
  if (coveredForms.size !== forms.size) invalid()
  for (const form of forms.values()) for (const field of form.fields ?? []) {
    if (!references.has(field.meaning?.baseReference)
      || field.meaning?.languageDigest !== value.language.digest
      || field.meaning?.schemaId !== form.value_schema || field.meaning?.fieldPath !== field.path) invalid()
  }
  const expected = createHash('sha256').update(JSON.stringify({
    forms: value.forms, language: value.language, views: value.views })).digest('hex')
  if (value.digest !== expected) invalid()
  // "path" here is a validated schema field identifier, never a filesystem path.
  // Do not weaken the general secret/path projection guard for this wire spelling.
  projectProfileForms({ formsJson: JSON.stringify(value.forms) })
  assertSafeProjection({ ...value, forms: value.forms.map(form => ({ ...form,
    fields: form.fields.map(({ path, ...field }) => ({ ...field, fieldId: path })) })) })
  return value
}
function validLabels(labels) {
  return labels && typeof labels === 'object' && !Array.isArray(labels)
    && typeof labels.en === 'string' && labels.en.trim().length > 0
    && Object.keys(labels).length <= 256
    && Object.entries(labels).every(([locale, label]) =>
      /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/u.test(locale) && locale.length <= 64
      && typeof label === 'string' && label.trim().length > 0 && [...label].length <= 256)
}
function invalid() { throw new Error('hatter-console-projection-invalid') }
