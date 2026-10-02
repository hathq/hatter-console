// Added by the Hatter downstream project, 2026.
// Purpose: expose only exact owner-accepted account/model routes and closed mutations.
import { assertSafeProjection } from './projection.mjs'
import { commitRevision, publicationIntent } from '../../shared/commit-publication.mjs'

export function modelRouteWriteParameters(value) {
  return { routeId: token(value?.routeId), providerId: token(value?.providerId),
    accountHandle: optionalAccount(value?.accountHandle), modelId: text(value?.modelId, 120),
    reasoningEffort: text(value?.reasoningEffort, 40),
    serviceTier: value?.serviceTier == null ? null : text(value.serviceTier, 80),
    repositoryId: repository(value?.repositoryId), operationId: operation(value?.operationId),
    control: publicationIntent(value?.control) }
}

export function modelRouteRemoveParameters(value) {
  return { routeId: token(value?.routeId), control: publicationIntent(value?.control) }
}

export function projectModelRoutePublication(value) {
  const publication=parse(value?.publicationJson)
  if (!publication || Object.keys(publication).sort().join(',') !== 'commit,route') invalid()
  const receipt=publication?.commit
  if (!receipt || Object.keys(receipt).sort().join(',') !== 'commit_ref,committed_revision,domain,operation_id,parent_refs,payload_digest,prepared_ref,previous_revision') invalid()
  commitRevision(receipt.previous_revision)
  if (!Array.isArray(receipt.parent_refs) || receipt.parent_refs.length > 8
    || receipt.parent_refs.some(value=> !/^[a-f0-9]{64}$/.test(value))
    || !/^[a-f0-9]{64}$/.test(receipt.prepared_ref) || !/^[a-f0-9]{64}$/.test(receipt.payload_digest)) invalid()
  if (receipt?.domain !== 'hatter/package/control/models'
    || typeof receipt.operation_id !== 'string' || !receipt.operation_id.length
    || !/^[a-f0-9]{64}$/.test(receipt.commit_ref)) invalid()
  const revision=commitRevision(receipt.committed_revision)
  if (revision.commit !== receipt.commit_ref) invalid()
  const projected=projectModelRoutes({ registryJson:JSON.stringify({
    schema:'hathq://hatter/model-route-registry/v1',revision,
    routes:publication.route == null ? [] : [publication.route]
  }) })
  return assertSafeProjection({ commit:receipt, route:projected.routes[0] ?? null })
}

export function projectModelRoutes(value) {
  const registry = parse(value?.registryJson)
  if (registry?.schema !== 'hathq://hatter/model-route-registry/v1'
    || !Array.isArray(registry?.routes) || registry.routes.length > 256) invalid()
  const routes = registry.routes.map(item => {
    if (item?.schema !== 'hathq://hatter/model-route/v1') invalid()
    return { schema: item.schema, routeId: token(item.route_id),
      providerId: token(item.provider_id), accountHandle: optionalAccount(item.account_handle),
      modelId: text(item.model_id, 120), reasoningEffort: text(item.reasoning_effort, 40),
      serviceTier: item.service_tier == null ? null : text(item.service_tier, 80),
      repositoryId: repository(item.repository_id), operationId: operation(item.operation_id),
      acceptedOperationId: text(item.accepted_operation_id, 256) }
  })
  if (new Set(routes.map(item => item.routeId)).size !== routes.length
    || new Set(routes.map(item => `${item.repositoryId}|${item.operationId}`)).size
      !== routes.length) invalid()
  return assertSafeProjection({ schema: 'hathq://hatter-console/model-routes/v1',
    revision: commitRevision(registry.revision), routes })
}

function parse(value) {
  if (typeof value !== 'string' || value.length > 1_048_576) invalid()
  try { return JSON.parse(value) } catch { invalid() }
}
function text(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value
    || value.length > maximum) invalid()
  return value
}
function token(value) {
  const result = text(value, 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(result)) invalid()
  return result
}
function account(value) {
  const result = text(value, 40)
  if (!/^account-[a-z0-9]{24,32}$/u.test(result)) invalid()
  return result
}
function optionalAccount(value) { return value == null ? null : account(value) }
function repository(value) {
  const result = text(value, 128)
  if (!/^hat-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result)) invalid()
  return result
}
function operation(value) {
  const result = text(value, 256)
  if (!/^hathq:\/\/vocabulary\/[A-Za-z0-9._:/-]+$/u.test(result)) invalid()
  return result
}
function invalid() { throw new Error('hatter-console-model-route-invalid') }
