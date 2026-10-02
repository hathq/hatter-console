// Validate the exact Role memory projection only. sem-lang remains the owner
// of retention, promotion, meaning and revisions.
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keys = (value, expected) => object(value)
  && Object.keys(value).sort().join(',') === expected.split(',').sort().join(',')
const kinds = ['TimeZone', 'ReferenceDate', 'Location', 'Calendar', 'Agent', 'Capability']
const scopes = ['CurrentExpression', 'CurrentRequest', 'Conversation', 'Session', 'Task',
  'Agent', 'Environment', 'PersistentAgentDefault', 'DomainSpecific']

export function roleMemory(value) {
  if (!keys(value, 'roleRef,subjectRef,semanticRevision,memoryRevision,shortTerm,longTerm')
    || !keys(value.roleRef, 'schema,id,revision,digest_sha256')
    || value.roleRef.schema !== 'hathq://semantic/reference/v1'
    || typeof value.roleRef.id !== 'string' || !value.roleRef.id.startsWith('runtime-role:')
    || !Number.isSafeInteger(value.roleRef.revision) || value.roleRef.revision < 1
    || !digest(value.roleRef.digest_sha256)
    || !subject(value.subjectRef)
    || new TextEncoder().encode(JSON.stringify(value)).byteLength > 1_048_576
    || !digest(value.semanticRevision) || !digest(value.memoryRevision)
    || !Array.isArray(value.shortTerm) || value.shortTerm.length > 128
    || !Array.isArray(value.longTerm) || value.longTerm.length > 128) invalid()
  for (const item of value.shortTerm) shortTerm(item, value)
  for (const item of value.longTerm) longTerm(item, value)
  return value
}

function subject(value) {
  return keys(value, 'id,class') && typeof value.id === 'string' && value.id
    && typeof value.class === 'string' && value.class
}

function sameSubject(left, right) {
  return subject(left) && left.id === right.id && left.class === right.class
}

function shortTerm(item, value) {
  if (!keys(item, 'reference,input_ref,input_digest,surface,context,retention')
    || !digest(item.reference) || !digest(item.input_digest)
    || typeof item.input_ref !== 'string' || !item.input_ref
    || !['DiscardAfterCompile', 'KeepForSession', 'KeepAsEvidence', 'KeepForAudit'].includes(item.retention)
    || (item.retention === 'DiscardAfterCompile' ? item.surface !== null : typeof item.surface !== 'string')) invalid()
  const context = item.context
  if (!keys(context, 'subject,evidence,at,locale,semantic_revision,context_refs,context_scope,observation_evidence')
    || !sameSubject(context.subject, value.subjectRef)
    || !digest(context.semantic_revision) || typeof context.locale !== 'string'
    || !(context.at === null || Number.isSafeInteger(context.at))
    || !Array.isArray(context.evidence) || !Array.isArray(context.context_refs)
    || !Array.isArray(context.observation_evidence) || typeof context.context_scope !== 'string') invalid()
}

function longTerm(item, value) {
  if (!keys(item, 'id,subject,kind,value,scope,validity,evidence,revision,promotion_ref')
    || typeof item.id !== 'string' || !item.id || !sameSubject(item.subject, value.subjectRef)
    || !kinds.includes(item.kind) || typeof item.value !== 'string'
    || !scopes.includes(item.scope) || typeof item.revision !== 'string' || !item.revision
    || typeof item.promotion_ref !== 'string' || !item.promotion_ref
    || !keys(item.validity, 'valid_from,valid_until,superseded_by')
    || !(item.validity.valid_from === null || Number.isSafeInteger(item.validity.valid_from))
    || !(item.validity.valid_until === null || Number.isSafeInteger(item.validity.valid_until))
    || !(item.validity.superseded_by === null || typeof item.validity.superseded_by === 'string')
    || !Array.isArray(item.evidence) || item.evidence.length > 128) invalid()
  for (const evidence of item.evidence)
    if (!keys(evidence, 'reference,detail') || typeof evidence.reference !== 'string'
      || !evidence.reference || typeof evidence.detail !== 'string') invalid()
}

function invalid() { throw new Error('hatter-console-role-memory-invalid') }
