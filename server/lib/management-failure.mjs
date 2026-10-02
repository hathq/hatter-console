// Added by the Hatter downstream project, 2026.
// Purpose: validate bounded semantic management failures without retaining implementation text.
import { assertSafeProjection } from './projection.mjs'

const CODE = /^[a-z][a-z0-9-]{2,95}$/u
const TOKEN = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u
const REASON = /^hathq:\/\/vocabulary\/reason\/[a-z0-9-]+\/v[1-9][0-9]*$/u
const ACTION = /^hathq:\/\/vocabulary\/action\/[a-z0-9-]+\/v[1-9][0-9]*$/u
const OPERATION = /^[a-z][a-z0-9-]*(?:\/[a-z][A-Za-z0-9-]*)+$/u
const classes = new Set(['input', 'precondition', 'authority', 'dependency', 'availability',
  'conflict', 'limit', 'timeout', 'cancelled', 'internal'])
const recoveries = new Set(['none', 'owner-action', 'retry', 'external-change'])
const responsibilities = new Set(['owner', 'hatter', 'hat', 'external-service'])
const transportOutcomes = new Set(['InputTooLarge', 'FrameTooLarge', 'Backpressure',
  'ConnectionClosed', 'ConnectionFailed', 'ProtocolViolation', 'MalformedFrame',
  'Timeout', 'SequenceExhausted'])
// Current producer discriminants only. Unknown/private text is not a label,
// permission, recovery operation or replacement for missing semantic evidence.
const participantCodes = new Set(['InvalidParticipantRequest','ParticipantSourceUnavailable',
  'ParticipantSourceStale','ParticipantSearchLimitExceeded','ParticipantDefinitionUnavailable',
  'ParticipantEntityUnavailable','ParticipantProvenanceUnavailable','ParticipantBindingUnavailable'])

export function projectManagementFailure(error) {
  const value = error?.data
  if (!Number.isInteger(error?.code) || error.code < -32099 || error.code > -32000
    || typeof error?.message !== 'string'
    || !exactKeys(value, ['schema', 'code', 'reasonId', 'class', 'recovery',
      'responsibility', 'operation', 'parameters', 'nextActionId'])
    || value?.schema !== 'hathq://hatter/management-failure/v1'
    || value.code !== error.message || !CODE.test(value.code)
    || !REASON.test(value.reasonId ?? '') || !classes.has(value.class)
    || !recoveries.has(value.recovery) || !responsibilities.has(value.responsibility)
    || !OPERATION.test(value.operation ?? '') || !validateFailureParameters(value.parameters)
    || !(value.nextActionId == null || ACTION.test(value.nextActionId))
    || (value.recovery === 'owner-action') !== (value.nextActionId != null)
    || (value.recovery === 'owner-action') !== (value.responsibility === 'owner')) return null
  return assertSafeProjection({ code: value.code, reasonId: value.reasonId,
    class: value.class, recovery: value.recovery, responsibility: value.responsibility,
    operation: value.operation, parameters: { ...value.parameters },
    nextActionId: value.nextActionId ?? null })
}

function exactKeys(value, expected) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === expected.length
    && expected.sort().every((key, index) => actual[index] === key)
}

export function managementFailureError(error) {
  const failure = projectManagementFailure(error)
  const result = new Error(failure == null
    ? 'hatter-app-server-request-rejected' : `hatter-console-${failure.code}`)
  if (failure != null) Object.defineProperty(result, 'failure', { value: failure })
  return result
}

export function failureFromError(error) {
  const value = error instanceof Error ? Reflect.get(error, 'failure') : null
  return value && typeof value === 'object' ? value : null
}

export function validateFailureParameters(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length <= 16 && entries.every(([key, parameter]) => {
    if (typeof parameter !== 'string') return false
    if (key === 'component') return ['hatter/scheduler', 'crowsi'].includes(parameter)
    if (key === 'schedulerBoundary') return parameter === 'dispatchExclusion'
    if (key === 'schedulerExclusion') return ['TimedOut','Io'].includes(parameter)
    if (key === 'sourceOwner') return ['hatter', 'sem-lang', 'hatter/control', 'hatter/participant', 'hatter/execution', 'hatter/admission', 'zixcel-local-inference', 'hatter-transport', 'hatter-utils-path'].includes(parameter)
    if (key === 'sourceCode' && (value.sourceOwner === 'hatter/participant'
      || value.sourceOwner === 'sem-lang' && typeof value.ownerFailure === 'string')) return participantCodes.has(parameter)
    if (key === 'sourceCode' && ['response_too_large', 'input_limit', 'artifact-input-too-large', 'artifact-input-changed',
      'artifact-input-invalid', 'artifact-unavailable', 'artifact-path-rejected'].includes(parameter)) return true
    if (['limit', 'observedAtLeast', 'httpStatus'].includes(key)) return /^[0-9]{1,20}$/u.test(parameter)
    if (key === 'dimension') return ['bytes', 'entries', 'records', 'line_bytes'].includes(parameter)
    if (key === 'modelAdmission') return TOKEN.test(parameter)
    if (key === 'sourceRef') return /^[a-f0-9]{64}$/u.test(parameter)
    if (['source', 'controlSource'].includes(key)) return /^[A-Z][A-Za-z]{0,95}$/u.test(parameter)
    if (key === 'control') return controlParameter(parameter)
    if (key === 'ownerFailure') return ['sem-lang','hatter/control','hatter/admission'].includes(value.sourceOwner)
      && structuredParameter(parameter, true)
    if (['sourceRetention', 'sourceRecord', 'semantic', 'confirmation', 'feedback', 'bound'].includes(key)) return structuredParameter(parameter)
    return TOKEN.test(key) && (key === 'transport' ? transportOutcomes.has(parameter) : TOKEN.test(parameter))
  })
}

// Original Graph receipt is public evidence, never a private restoration object.
function controlParameter(text) {
  if (text.length > 4096) return false
  let value;try{value=JSON.parse(text)}catch{return false}
  if (value?.Graph && Object.hasOwn(value.Graph,'DependencyConflict')) {
    const conflict=value.Graph.DependencyConflict
    const revision=v=>exactKeys(v,['sequence','commit'])&&Number.isSafeInteger(v.sequence)
      &&v.sequence>=0&&(v.sequence===0?v.commit===null:typeof v.commit==='string'&&/^[a-f0-9]{64}$/u.test(v.commit))
    // The declared GraphSpace is a public identifier, not a filesystem path.
    // Admit it only in this closed owner variant, never in arbitrary diagnostics.
    return exactKeys(value,['Graph'])&&exactKeys(value.Graph,['DependencyConflict'])
      &&exactKeys(conflict,['space','expected','actual'])&&typeof conflict.space==='string'
      &&conflict.space.length<=512&&/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(conflict.space)
      &&revision(conflict.expected)&&revision(conflict.actual)
  }
  return structuredParameter(text)
}

function receiptParameter(text) {
  if(text.length>4096)return false
  let r;try{r=JSON.parse(text)}catch{return false}
  const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v)
  const revision=v=>exactKeys(v,['sequence','commit'])&&Number.isSafeInteger(v.sequence)&&v.sequence>=0&&(v.commit===null||hash(v.commit))
  const identifier=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\x00-\x1f\x7f\\]/u.test(v)&&!v.startsWith('/')&&!v.includes('/home/')
  return exactKeys(r,['domain','operation_id','prepared_ref','commit_ref','parent_refs','previous_revision','committed_revision','payload_digest'])
    &&identifier(r.domain)&&identifier(r.operation_id)&&hash(r.prepared_ref)&&hash(r.commit_ref)&&hash(r.payload_digest)
    &&Array.isArray(r.parent_refs)&&r.parent_refs.length<=8&&r.parent_refs.every(hash)
    &&revision(r.previous_revision)&&revision(r.committed_revision)
}

// Read only the current owner's closed post-publication failure variant. A
// similarly named field elsewhere is not evidence of a committed operation.
export function committedOwnerReceipt(failure) {
  if (failure?.parameters?.sourceOwner !== 'sem-lang'
    || !validateFailureParameters(failure.parameters)) return null
  let value;try{value=JSON.parse(failure.parameters.ownerFailure)}catch{return null}
  const keys=Object.keys(value??{})
  if(keys.length!==1||!['Role','Feedback','Inference','Structure'].includes(keys[0]))return null
  const body=value[keys[0]]
  if(!exactKeys(body,['Publication'])||!exactKeys(body.Publication,['PublishedSource']))return null
  const source=body.Publication.PublishedSource
  if(!exactKeys(source,['receipt','source'])||!receiptParameter(JSON.stringify(source.receipt)))return null
  return source.receipt
}

// Shape validation only: owner-defined discriminants are not translated into a
// competing Console error taxonomy. Private diagnostics are rejected, never shown.
function structuredParameter(text, owner = false) {
  if (text.length > 4096) return false
  let value
  try { value = JSON.parse(text) } catch { return false }
  let remaining = 128
  const safe = (v, depth = 0) => {
    if (--remaining < 0 || depth > 8) return false
    if (v === null || typeof v === 'boolean') return true
    if (typeof v === 'number') return owner ? Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER : Number.isSafeInteger(v) && v >= 0
    if (typeof v === 'string') return v === '[redacted]' || (owner
      ? /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/u.test(v) && !/^[A-Za-z]:\//u.test(v)
        && !v.split('/').some(part => !part || part === '.' || part === '..')
      : /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(v))
    if (Array.isArray(v)) return v.length <= 16 && v.every(c => safe(c, depth + 1))
    return typeof v === 'object' && Object.entries(v).every(([k, c]) =>
      /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(k)
      && k !== 'restoration' && !/^(?:path|cwd|objects|dependencies|secret|token|raw)$/iu.test(k)
      && (k!=='detail'||c==='[redacted]')
      && safe(c, depth + 1))
  }
  return safe(value)
}
