// Added by the Hatter downstream project, 2026.
// Purpose: validate closed profile and schema-graph documents before browser projection.
import { assertSafeProjection } from './projection.mjs'

const TOKEN = /^[a-z0-9][a-z0-9\/_-]{0,127}$/u
const SCHEMA = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/u

export function profileScope(value = {}) {
  return { subjectId: token(value.subjectId ?? 'self') }
}

export function profileReadParameters(value) {
  return { ...profileScope(value), entryId: token(value?.entryId) }
}

export function profileWriteParameters(value) {
  const scope = profileScope(value)
  const entry = { entry_id: token(value?.entryId), form_id: token(value?.formId),
    values: values(value?.values), expected_revision: optionalRevision(value?.expectedRevision) }
  const entryJson = JSON.stringify(entry)
  if (entryJson.length > 32_768) invalid()
  return { ...scope, entryJson }
}

export function projectProfileForms(value) {
  const source = document(value?.formsJson)
  if (!Array.isArray(source) || source.length > 256) invalid()
  if (new Set(source.map(item => item.form_id)).size !== source.length) invalid()
  return safe({ schema: 'hathq://hatter-console/profile-forms/v1',
    forms: source.map(form) })
}

export function projectProfileEntries(value) {
  const source = document(value?.entriesJson)
  if (!Array.isArray(source) || source.length > 256) invalid()
  return safe({ schema: 'hathq://hatter-console/profile-entries/v1',
    entries: source.map(entry) })
}

export function projectProfileEntry(value) {
  return safe({ schema: 'hathq://hatter-console/profile-entry/v1',
    entry: entry(document(value?.entryJson)) })
}

export function projectSchemaGraph(value) {
  const source = document(value?.graphJson)
  if (source?.schema !== 'hatter://management/semantic-schema-graph/v2' || !Array.isArray(source.nodes)
    || !Array.isArray(source.edges) || source.nodes.length > 256 || source.edges.length > 512) invalid()
  const nodes = source.nodes.map(node)
  const ids = new Set(nodes.map(item => item.id))
  if (ids.size !== nodes.length) invalid()
  const edges = source.edges.map(item => ({ from: text(item?.from, 256),
    to: text(item?.to, 256), kind: token(item?.kind) }))
  if (edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) invalid()
  return safe({ schema: 'hathq://hatter-console/semantic-schema-graph/v2', nodes, edges })
}

function form(value) {
  if (value?.schema !== 'hatter://person-profile/form-descriptor/v2'
    || !Array.isArray(value?.fields) || value.fields.length > 16) invalid()
  const fields = value.fields.map(field)
  if (fields.some(field => field.meaning.schemaId !== value.value_schema
    || field.meaning.fieldPath !== field.fieldId)) invalid()
  const declaredLabels = labels(value.labels)
  if ([value.title_key, value.description_key, ...fields.map(field => field.labelKey)]
    .some(key => !declaredLabels.en[key])) invalid()
  let setup = null
  if (value.setup != null) {
    if (!Array.isArray(value.setup.requiredFieldIds) || !value.setup.requiredFieldIds.length
      || value.setup.requiredFieldIds.some(id => !fields.some(field => field.fieldId === id && field.required))) invalid()
    setup = { id: token(value.setup.id), requiredFieldIds: value.setup.requiredFieldIds.map(token) }
  }
  const ids = new Set(fields.map(item => item.fieldId))
  if (ids.size !== fields.length || fields.some(item => item.dependsOn && !ids.has(item.dependsOn))) invalid()
  return { schema: value.schema, formId: token(value.form_id), valueSchema: schema(value.value_schema),
    structuralAxis: token(value.structural_axis), ownerRepositoryId: token(value.owner_repository_id),
    titleKey: labelKey(value.title_key), descriptionKey: labelKey(value.description_key),
    multiple: value.multiple === true, fields, labels: declaredLabels, setup }
}

function field(value) {
  const kind = text(value?.kind, 16)
  const inputMode = text(value?.input_mode, 32)
  if (!['text', 'date', 'boolean', 'select'].includes(kind)) invalid()
  if (!['owner-asserted', 'candidate-selection', 'external-reference'].includes(inputMode)) invalid()
  if (!Array.isArray(value?.option_values) || value.option_values.length > 300) invalid()
  const optionValues = value.option_values.map(item => text(item, 64))
  if (new Set(optionValues).size !== optionValues.length
    || optionValues.some((item, index) => index > 0 && optionValues[index - 1] >= item)) invalid()
  const dependsOn = value.depends_on == null ? null : token(value.depends_on)
  const format = optionalText(value.format, 32)
  if (kind !== 'select' && (optionValues.length || dependsOn !== null)) invalid()
  if (kind === 'select' && !optionValues.length && dependsOn === null) invalid()
  if (kind === 'select' && !closedSelection(format, optionValues, dependsOn)) invalid()
  if ((kind === 'select') !== (inputMode === 'candidate-selection')) invalid()
  if (inputMode === 'external-reference' && !['reference', 'sha256'].includes(format)) invalid()
  if (inputMode === 'owner-asserted' && ['reference', 'sha256'].includes(format)) invalid()
  return { fieldId: token(value.path), kind, inputMode, labelKey: labelKey(value.label_key),
    required: value.required === true, minimumLength: optionalBound(value.minimum_length),
    maximumLength: optionalBound(value.maximum_length), format,
    optionValues, dependsOn, meaning: meaning(value.meaning) }
}

function labels(value) {
  if (!value || typeof value !== 'object' || !value.en || Object.keys(value).length > 128) invalid()
  return Object.fromEntries(Object.entries(value).map(([locale, entries]) => {
    if (!/^[A-Za-z0-9-]{2,80}$/u.test(locale) || !entries || typeof entries !== 'object') invalid()
    return [locale, Object.fromEntries(Object.entries(entries).map(([key, label]) =>
      [labelKey(key), text(label, 1024)]))]
  }))
}
function meaning(value) {
  if (!value || !/^[0-9a-f]{64}$/u.test(value.languageDigest)
    || !/^[0-9a-f]{64}$/u.test(value.definitionDigest)) invalid()
  return { reference: schema(value.reference), baseReference: schema(value.baseReference),
    languageDigest: value.languageDigest, definitionDigest: value.definitionDigest,
    schemaId: schema(value.schemaId), fieldPath: token(value.fieldPath) }
}

function closedSelection(format, values, dependsOn) {
  if (format === 'country-region') return dependsOn === null
    && values.every(value => /^[A-Z]{2}$/u.test(value))
  if (format === 'language-tag') return dependsOn === null
    && values.every(value => value.length <= 35
      && /^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value))
  if (format === 'explanation-style') return dependsOn === null
    && values.join(',') === 'concise,concrete-examples,standard,step-by-step'
  return format === 'administrative-area' && values.length === 0 && dependsOn === 'country_region'
}

function entry(value) {
  if (value?.schema !== 'hatter://person-profile/entry/v2') invalid()
  return { schema: value.schema, entryId: token(value.entry_id),
    subjectId: token(value.subject_id), formId: token(value.form_id),
    valueSchema: schema(value.value_schema), structuralAxis: token(value.structural_axis),
    values: values(value.values), revision: revision(value.revision),
    recordedAtEpochS: revision(value.recorded_at_epoch_s) }
}

function node(value) {
  if (!Array.isArray(value?.facts) || value.facts.length > 128) invalid()
  return { id: text(value.id, 256), label: text(value.label, 512), kind: token(value.kind),
    ownerRepositoryId: token(value.owner_repository_id),
    schemaId: value.schema_id == null ? null : schema(value.schema_id),
    facts: value.facts.map(item => ({ label: text(item?.label, 128), value: text(item?.value, 16_384) })) }
}

function values(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') invalid()
  const entries = Object.entries(value)
  if (entries.length > 16) invalid()
  return Object.fromEntries(entries.map(([key, item]) => {
    token(key)
    if (typeof item !== 'string' && typeof item !== 'boolean') invalid()
    if (typeof item === 'string') text(item, 2048)
    return [key, item]
  }))
}
function document(value) { try { return JSON.parse(text(value, 1_048_576)) } catch { invalid() } }
function token(value) { const result = text(value, 128); if (!TOKEN.test(result)) invalid(); return result }
function schema(value) { const result = text(value, 512); if (!SCHEMA.test(result)) invalid(); return result }
function labelKey(value) { const result = text(value, 128); if (!/^profile\.[a-z0-9._-]+$/u.test(result)) invalid(); return result }
function text(value, max) { if (typeof value !== 'string' || !value || value.length > max || value.includes('\0')) invalid(); return value }
function optionalText(value, max) { return value == null ? null : text(value, max) }
function optionalBound(value) { return value == null ? null : revision(value) }
function optionalRevision(value) { return value == null ? null : revision(value) }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) invalid(); return value }
function safe(value) { return assertSafeProjection(value) }
function invalid() { throw new Error('hatter-console-profile-projection-invalid') }
