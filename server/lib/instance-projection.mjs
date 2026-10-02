// Added by the Hatter downstream project, 2026.
// Purpose: validate the path-free instance and expose its physical root without workspace taxonomy.
const roles = new Set(['standalone', 'primary', 'replica', 'backup'])
const rootStates = new Set(['uninitialized', 'active', 'marker_missing',
  'registered_elsewhere', 'registered_root_missing', 'relocation_required',
  'duplicate_marker', 'orphaned_marker', 'foreign_marker'])
const digest = /^[0-9a-f]{64}$/u
const fields = new Set(['schema', 'stateRevision', 'initialized', 'instanceId', 'role',
  'identityState', 'personIdentityRef', 'authorityEpoch', 'primaryInstanceId',
  'workspaceRootId', 'workspaceRootFingerprintSha256', 'workspaceRootState',
  'continuity',
  'platformFamily', 'platformOs', 'identityContractOwner', 'transportContractOwner'])
const continuityStates = new Set(['retained', 'recovery_available', 'move_available',
  'registration_required', 'reregistration_required', 'blocked'])
const continuityActions = new Set(['none', 'restore_exact_release', 'restore_marker',
  'confirm_move', 'register', 'reregister', 'rebind', 'reconnect', 'select_placement',
  'review_conflict'])

export function projectInstance(value) {
  const source = value?.instance
  if (!source || Object.keys(source).some(field => !fields.has(field))
    || Object.keys(source).length !== fields.size
    || source.schema !== 'hathq://hatter/instance-projection/v2'
    || !Number.isSafeInteger(source.stateRevision) || source.stateRevision < 0
    || typeof source.initialized !== 'boolean' || !roles.has(source.role)
    || !['unpaired', 'paired'].includes(source.identityState)
    || !rootStates.has(source.workspaceRootState)
    || !continuityStates.has(source.continuity?.state)
    || !continuityActions.has(source.continuity?.action)
    || !bounded(source.continuity?.reason, 120)
    || !bounded(source.platformFamily, 32) || !bounded(source.platformOs, 32)
    || source.identityContractOwner !== 'ihat-identity-contracts'
    || source.transportContractOwner !== 'crowsi') invalid()
  optional(source.instanceId, 128)
  optional(source.personIdentityRef, 256)
  optional(source.primaryInstanceId, 128)
  optional(source.workspaceRootId, 128)
  if (source.workspaceRootFingerprintSha256 !== null
    && !digest.test(source.workspaceRootFingerprintSha256)) invalid()
  if (source.authorityEpoch !== null
    && (!Number.isSafeInteger(source.authorityEpoch) || source.authorityEpoch < 0)) invalid()
  if (!source.initialized && (source.stateRevision !== 0 || source.instanceId !== null
    || source.workspaceRootId !== null)) invalid()
  const { workspaceRootId, workspaceRootFingerprintSha256, workspaceRootState, ...instance } = source
  return Object.freeze(structuredClone({ ...instance,
    workingRootId: workspaceRootId,
    workingRootFingerprintSha256: workspaceRootFingerprintSha256,
    workingRootState: workspaceRootState }))
}

function optional(value, limit) {
  if (value !== null && !bounded(value, limit)) invalid()
}

function bounded(value, limit) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    && value.trim() === value
}

function invalid() { throw new Error('hatter-console-instance-projection-invalid') }
