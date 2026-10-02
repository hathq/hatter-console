// Hatter downstream 2026: pure shared protocol projection/validation, no repair.
import { createHash } from 'node:crypto'
export function protocolFailure(code, details = []) {
  const error = new Error(`hatter-console-protocol-${code}:${details.join(',')}`)
  error.code = code; error.details = details; throw error
}
export const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
export const digest = value => createHash('sha256').update(stable(value?.oneOf ? { ...value,
  oneOf: [...value.oneOf].sort((a, b) => a.properties.method.enum[0].localeCompare(b.properties.method.enum[0], 'en')) } : value)).digest('hex')
export function methodSet(schema) {
  if (!Array.isArray(schema?.oneOf)) protocolFailure('UnsupportedRepresentation')
  const methods = schema.oneOf.map(item => {
    const values = item?.properties?.method?.enum
    if (values?.length !== 1 || typeof values[0] !== 'string') protocolFailure('UnsupportedRepresentation')
    return values[0]
  })
  if (new Set(methods).size !== methods.length) protocolFailure('DuplicateMethod')
  return methods.sort()
}
export function exactMethods(actual, expected) {
  const missing = expected.filter(m => !actual.includes(m)), extra = actual.filter(m => !expected.includes(m))
  if (missing.length) protocolFailure('SchemaProjectionIncomplete', missing)
  if (extra.length) protocolFailure('SchemaProjectionExtra', extra)
}
export function projectSchema(canonical, allowed) {
  const methods = methodSet(canonical), selected = [...allowed].sort()
  if (new Set(selected).size !== selected.length) protocolFailure('DuplicateMethod')
  const unknown = selected.filter(m => !methods.includes(m))
  if (unknown.length) protocolFailure('UnknownConsoleMethod', unknown)
  return { ...canonical, 'x-hatter-projection': { canonical_digest: digest(canonical), methods: selected },
    oneOf: [...canonical.oneOf].filter(x => selected.includes(x.properties.method.enum[0]))
      .sort((a, b) => a.properties.method.enum[0].localeCompare(b.properties.method.enum[0], 'en')) }
}
export function typeScript(schema) {
  return '// Generated from Hatter Rust Request + METHODS. Do not edit.\n'
    + 'export type HatterManagementMethod =\n' + methodSet(schema).map(m => `  | ${JSON.stringify(m)}`).join('\n')
    + '\n\nexport interface HatterManagementRequest {\n  id: string | number\n  method: HatterManagementMethod\n  params?: unknown\n}\n'
}
export function verifyProjection(canonical, projected, typescript, allowed) {
  const expected = projectSchema(canonical, allowed)
  exactMethods(methodSet(projected), methodSet(expected))
  if (stable(projected) !== stable(expected)) protocolFailure('StaleSnapshot')
  if (typescript !== typeScript(projected)) protocolFailure('JsonTypeScriptMismatch')
  return { canonical_methods: methodSet(canonical), console_methods: methodSet(projected) }
}
export function graphProjection(canonical, projected) {
  return { canonical_digest: digest(canonical), projection_digest: digest(projected),
    canonical_methods: methodSet(canonical), console_methods: methodSet(projected),
    nodes: methodSet(canonical).map(method => ({ id: method, kind: 'rpc-method', console: methodSet(projected).includes(method) })),
    edges: methodSet(canonical).map(method => ({ source: 'ClientRequest', target: method, relation: 'method' })) }
}
