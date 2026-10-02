// Added by the Hatter downstream project, 2026.
// Purpose: keep generic Digital Twin views exact-term driven and closed over safe UI hints.
import { assertSafeProjection } from './projection.mjs'
import { declarationLabel } from '../../shared/declaration-label.mjs'
/** @param {{views: Array<{scene: string, id: string, recordKind: string, vocabularyTerms: string[], maximumItems: number, presentationHint: string, labels: Record<string, string>, reference: string}>}} dictionary */
export function digitalTwinDefinitions(dictionary, locale = 'en') {
  return dictionary.views.filter(view => view.scene === 'world').map(view => ({
    projectionId: view.id, recordKind: view.recordKind, vocabularyTerms: view.vocabularyTerms,
    maximumItems: view.maximumItems, presentationHint: view.presentationHint,
    label: declarationLabel(view.labels, locale), summary: view.reference
  }))
}

export function digitalTwinDefinition(dictionary, id, locale = 'en') {
  const value = digitalTwinDefinitions(dictionary, locale).find(item => item.projectionId === id)
  if (!value) throw new Error('hatter-console-digital-twin-projection-unknown')
  return value
}

export function digitalTwinReadParameters(definition) {
  return { projectionId: definition.projectionId, recordKind: definition.recordKind,
    vocabularyTerms: [...definition.vocabularyTerms], maximumItems: definition.maximumItems,
    presentationHint: definition.presentationHint }
}

export function projectDigitalTwinArea(definition, value) {
  if (value?.schema !== 'hathq://hatter/digital-twin-projection/v2'
    || value.projectionId !== definition.projectionId
    || value.presentationHint !== definition.presentationHint
    || !Number.isSafeInteger(value.graphRevision) || value.graphRevision < 0
    || typeof value.truncated !== 'boolean' || !Array.isArray(value.items)
    || value.items.length > definition.maximumItems) invalid()
  const items = value.items.map(item => ({ semanticId: text(item.semanticId, 512),
    recordKind: recordKind(item.recordKind, definition.recordKind),
    vocabularyTypes: stringList(item.vocabularyTypes, 32, 512),
    properties: safeProperties(item.properties) }))
  return assertSafeProjection({ projectionId: definition.projectionId,
    label: definition.label, summary: definition.summary,
    vocabularyTerms: definition.vocabularyTerms,
    presentationHint: definition.presentationHint, graphRevision: value.graphRevision,
    truncated: value.truncated, itemCount: items.length, items })
}

function recordKind(value, expected) {
  if (!['entity', 'event', 'assertion'].includes(value) || value !== expected) invalid()
  return value
}

function safeProperties(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length > 128) invalid()
  return Object.fromEntries(Object.entries(value).map(([key, property]) => {
    const safeKey = text(key, 128)
    if (property == null || typeof property !== 'object'
      || !['null', 'bool', 'signed', 'unsigned', 'float', 'string', 'bytes']
        .includes(property.kind)) invalid()
    const rendered = property.kind === 'bytes' ? `[${Array.isArray(property.value)
      ? property.value.length : 0} bytes]` : property.kind === 'null' ? 'null'
      : String(property.value)
    return [safeKey, text(rendered, 4096)]
  }))
}

function stringList(value, maximum, bytes) {
  if (!Array.isArray(value) || value.length > maximum) invalid()
  return value.map(item => text(item, bytes))
}
function text(value, bytes) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > bytes) invalid()
  return value
}
function invalid() { throw new Error('hatter-console-digital-twin-projection-invalid') }
