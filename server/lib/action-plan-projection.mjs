// Added by the Hatter downstream project, 2026.
// Purpose: expose one exact action interface for owner and inference-authored multi-step plans.
import { assertSafeProjection } from './projection.mjs'

const TOKEN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u
const REPOSITORY = /^hat-[a-z0-9]+(?:-[a-z0-9]+)*$/u
const DIGEST = /^[a-f0-9]{64}$/u
const URI = /^hathq:\/\/[A-Za-z0-9._:/-]+$/u
const STATES = new Set(['binding_required', 'binding_inactive', 'placement_required',
  'location_operation_unavailable', 'worker_unavailable', 'available'])

export function projectActionPlanCatalog({ capabilities, packages }) {
  if (!Array.isArray(capabilities?.capabilities) || capabilities.capabilities.length > 4096
    || !Array.isArray(packages) || packages.length > 64) invalid('catalog')
  const descriptors = new Map(packages.map(value => {
    const repositoryId = repository(value?.installation?.repositoryId)
    const operations = array(value?.descriptor?.operations, 128).map(operationContract)
    return [repositoryId, { installation: value.installation, manifestName:
      text(value?.descriptor?.manifestName, 100), operations }]
  }))
  const actions = capabilities.capabilities.map(capability => {
    const repositoryId = repository(capability?.repositoryId)
    const descriptor = descriptors.get(repositoryId)
    const operationId = uri(capability?.operationId)
    const operation = descriptor?.operations.find(value => value.id === operationId)
    if (!operation || descriptor.installation.packageSha256 !== capability.packageSha256
      || operation.inputSchema !== capability.inputSchema
      || operation.outputSchema !== capability.outputSchema) invalid('catalog')
    return { actionKey: `${capability.contextPartitionId}|${repositoryId}|${operationId}`,
      contextPartitionId: token(capability.contextPartitionId), repositoryId,
      packageId: packageId(capability.packageId), packageSha256: digest(capability.packageSha256),
      version: text(capability.version, 80), manifestName: descriptor.manifestName,
      operationId, inputSchema: uri(capability.inputSchema), outputSchema: uri(capability.outputSchema),
      handlerKind: choice(capability.handlerKind, ['declarative-hat', 'hat-service',
        'ecosystem-adapter', 'delegated-hat']), state: state(capability.state),
      procedure: operation.procedure, effects: operation.effects }
  }).sort((left, right) => left.actionKey.localeCompare(right.actionKey))
  if (new Set(actions.map(value => value.actionKey)).size !== actions.length) invalid('catalog')
  return assertSafeProjection({ schema: 'hathq://hatter-console/action-catalog/v1', actions })
}

export function actionPlanWriteParameters(value) {
  exactKeys(value, ['planId', 'title', 'source', 'expectedRevision', 'steps'])
  const steps = array(value.steps, 64, 1).map(stepWrite)
  return { planId: token(value.planId), title: text(value.title, 160),
    source: choice(value.source, ['owner', 'inference']), expectedRevision: revision(value.expectedRevision),
    steps }
}

export function actionPlanApproveParameters(value) {
  exactKeys(value, ['planId', 'expectedRevision', 'ownerDecisionId'])
  return { planId: token(value.planId), expectedRevision: revision(value.expectedRevision),
    ownerDecisionId: token(value.ownerDecisionId) }
}

export function projectActionPlanRegistry(value) {
  const source = value?.registry
  if (source?.schema !== 'hathq://hatter/action-plan-registry/v1') invalid('projection')
  const registryRevision = revision(source.revision)
  const plans = array(source.plans, 64).map(plan => {
    if (plan?.schema !== 'hathq://hatter/action-plan/v1') invalid('projection')
    const approved = boolean(plan.approved)
    const ownerDecisionId = plan.ownerDecisionId == null ? null : token(plan.ownerDecisionId)
    if (approved !== (ownerDecisionId !== null)) invalid('projection')
    return { planId: token(plan.planId), title: text(plan.title, 160),
      source: choice(plan.source, ['owner', 'inference']),
      acceptedRevision: positive(plan.acceptedRevision, registryRevision),
      planDigestSha256: digest(plan.planDigestSha256), steps: array(plan.steps, 64, 1).map(stepWrite),
      approved, ownerDecisionId }
  })
  if (new Set(plans.map(value => value.planId)).size !== plans.length) invalid('projection')
  return assertSafeProjection({ schema: 'hathq://hatter-console/action-plan-registry/v1',
    revision: registryRevision, plans })
}

function operationContract(value) {
  return { id: uri(value?.id), inputSchema: uri(value?.inputSchema),
    outputSchema: uri(value?.outputSchema), handlerKind: choice(value?.handlerKind,
      ['declarative-hat', 'hat-service', 'ecosystem-adapter', 'delegated-hat']),
    procedure: procedure(value?.procedure), effects: array(value?.effects ?? [], 16).map(effect => ({
      kind: choice(effect?.kind, ['create', 'link', 'update']), surfaceId: token(effect?.surfaceId) })) }
}
function procedure(value) {
  return { id: token(value?.id), steps: array(value?.steps, 64, 1).map(step => ({
    actionId: uri(step?.actionId), inputSchema: uri(step?.inputSchema),
    outputSchema: uri(step?.outputSchema) })) }
}
function stepWrite(value) {
  exactKeys(value, ['stepId', 'contextPartitionId', 'repositoryId', 'packageSha256',
    'operationId', 'inputSchema', 'outputSchema', 'dependsOn', 'inputFromStepId'])
  const dependsOn = array(value.dependsOn, 64).map(token)
  if (new Set(dependsOn).size !== dependsOn.length) invalid('input')
  return { stepId: token(value.stepId), contextPartitionId: token(value.contextPartitionId),
    repositoryId: repository(value.repositoryId), packageSha256: digest(value.packageSha256),
    operationId: uri(value.operationId), inputSchema: uri(value.inputSchema),
    outputSchema: uri(value.outputSchema), dependsOn,
    inputFromStepId: value.inputFromStepId == null ? null : token(value.inputFromStepId) }
}
function exactKeys(value, keys) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) invalid('input')
}
function array(value, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid('projection')
  return value
}
function text(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || value.length > maximum || /[\u0000-\u001f]/u.test(value)) invalid('input')
  return value
}
function token(value) { if (typeof value !== 'string' || !TOKEN.test(value)) invalid('input'); return value }
function repository(value) { if (typeof value !== 'string' || !REPOSITORY.test(value)) invalid('input'); return value }
function packageId(value) { if (typeof value !== 'string' || !/^hat\/[a-z0-9-]+$/u.test(value)) invalid('input'); return value }
function digest(value) { if (typeof value !== 'string' || !DIGEST.test(value)) invalid('input'); return value }
function uri(value) { if (typeof value !== 'string' || value.length > 256 || !URI.test(value)) invalid('input'); return value }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) invalid('input'); return value }
function positive(value, maximum) { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) invalid('projection'); return value }
function boolean(value) { if (typeof value !== 'boolean') invalid('projection'); return value }
function choice(value, values) { if (!values.includes(value)) invalid('input'); return value }
function state(value) { if (!STATES.has(value)) invalid('catalog'); return value }
function invalid(area) { throw new Error(`hatter-console-action-plan-${area}-invalid`) }
