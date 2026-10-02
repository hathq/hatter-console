// Modified by the Hatter downstream project, 2026.
// Purpose: verify exact Invocation route projection and reject late-selector input.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activationWriteParameters, capabilityListParameters, installIpParameters, installLocalParameters,
  packageReadParameters,
  invocationControlParameters, invocationListParameters, invocationReadParameters,
  invocationWriteParameters, projectActivation, projectCapabilities, projectContinuity, projectInstallation,
  projectInvocation, projectInvocationList,
  projectCatalogPackagePreview, projectInformationSurfaces, projectPackageDetails,
  projectPlacement, projectProjectionJournal, projectServiceRequirements,
  projectWorker,
  projectionJournalReadParameters, workerReadParameters, workerUnregisterParameters
} from '../server/lib/hat-package-projection.mjs'

function semanticCatalog(terms = []) {
  return { schema: 'hathq://hat/semantic-catalog/v1',
    identity: { catalogId: 'hat-example', version: 1, digestSha256: 'a'.repeat(64) },
    ownerRepositoryId: 'hat-example', foundation: false,
    dependencies: [], incompatibilities: [], terms, lexicalizations: [], frames: [] }
}

function semanticTerm() {
  return { reference: { catalogId: 'hat-example', catalogDigestSha256: 'a'.repeat(64),
    termId: 'hathq://vocabulary/entity/financial-record/v1', version: 1,
    definitionDigestSha256: 'b'.repeat(64), kind: 'entity-type' },
  wireSchema: 'hathq://hat-example/financial-record/v1', semanticIcon: 'accounting',
  dependencies: [], isA: [], domain: [], range: [] }
}

test('accepts only exact local-path or literal-IP package sources', () => {
  assert.deepEqual(installLocalParameters({ repositoryId: 'hat-example',
    localPath: '/srv/hats/example' }), {
    repositoryId: 'hat-example', localPath: '/srv/hats/example' })
  assert.deepEqual(installIpParameters({ repositoryId: 'hat-example',
    ipAddress: '192.0.2.10', port: 8443, publicKeyHex: 'b'.repeat(64) }), {
    repositoryId: 'hat-example', ipAddress: '192.0.2.10', port: 8443,
    publicKeyHex: 'b'.repeat(64) })
  assert.throws(() => installLocalParameters({ repositoryId: 'hat-example',
    localPath: '../relative' }), /hat-input-invalid/u)
  assert.throws(() => installIpParameters({ repositoryId: 'hat-example',
    ipAddress: 'hats.example.com', port: 443, publicKeyHex: 'b'.repeat(64) }),
  /hat-input-invalid/u)
  assert.throws(() => installIpParameters({ repositoryId: 'hat-example',
    ipAddress: '127.0.0.1', port: 0, publicKeyHex: 'b'.repeat(64) }),
  /hat-input-invalid/u)
  assert.throws(() => packageReadParameters({ repositoryId: '../escape' }),
    /hat-input-invalid/u)
})

test('projects bounded HAT and worker continuity decisions', () => {
  const value = projectContinuity({ continuity: {
    schema: 'hathq://hatter/resource-continuity/v1', items: [{
      resourceKind: 'hat_package', repositoryId: 'hat-example', contextPartitionId: null,
      packageSha256: 'a'.repeat(64), decision: { state: 'recovery_available',
        action: 'restore_exact_release', reason: 'signed-package-artifact-missing' }
    }, { resourceKind: 'hat_worker', repositoryId: 'hat-example',
      contextPartitionId: 'partition-owner', packageSha256: 'a'.repeat(64),
      decision: { state: 'reregistration_required', action: 'reregister',
        reason: 'worker-identity-or-binding-changed' } }]
  } })
  assert.equal(value.items.length, 2)
  assert.equal(value.items[1].decision.action, 'reregister')
  assert.throws(() => projectContinuity({ continuity: {
    schema: 'hathq://hatter/resource-continuity/v1', items: [{
      resourceKind: 'hat_worker', repositoryId: 'hat-example',
      contextPartitionId: 'partition-owner', packageSha256: 'a'.repeat(64),
      decision: { state: 'recovery_available', action: 'replace-worker', reason: 'guessed' }
    }] } }), /hat-input-invalid/u)
})

test('passes exact canonical activation commands without deriving refs or filling a current head', () => {
  const command = { control: { operation_id: 'activate:one', expected_commit_revision: { sequence: 0, commit: null } },
    activation: { semantic_binding_ref: { namespace: 'owner', revision: 'adopted:one' }, active: true },
    causation_ref: 'user:one', parent_ref: { reference: 'decision:one' } }
  assert.deepEqual(activationWriteParameters(command), command)
  for (const field of ['control', 'activation', 'causation_ref', 'parent_ref']) {
    const missing = structuredClone(command)
    delete missing[field]
    assert.throws(() => activationWriteParameters(missing), /hat-input-invalid/u)
  }
  assert.throws(() => activationWriteParameters({ ...command, expectedRevision: 0 }), /hat-input-invalid/u)
  assert.throws(() => activationWriteParameters({ repositoryId: 'hat-example', active: true }), /hat-input-invalid/u)
})

test('projects only immutable installation and revisioned binding metadata', () => {
  const installation = projectInstallation({ installation: {
    schema: 'hathq://hat-installation/v1', repositoryId: 'hat-example',
    packageId: 'hat/example', version: '1.0.0', specificationVersion: '1',
    packageSha256: 'd'.repeat(64), artifactRef: 'hathq://artifacts/example' } })
  assert.equal(installation.installation.repositoryId, 'hat-example')
  const binding = projectActivation({ activation: { schema: 'hatter://capability/activation/v1',
    contextPartitionId: 'contextPartition-1', repositoryId: 'hat-example', packageId: 'hat/example',
    packageSha256: 'd'.repeat(64), policyDigestSha256: 'e'.repeat(64),
    catalogDigestSha256: 'a'.repeat(64), fittingDigestSha256: 'b'.repeat(64),
    subjectRef: 'subject-owner', scopeRef: 'scope/home', semanticBindingRef: { namespace: 'owner', revision: 'adopted:one' },
    revision: 3, active: true } })
  assert.equal(binding.activation.revision, 3)
  assert.deepEqual(binding.activation.semanticBindingRef, { namespace: 'owner', revision: 'adopted:one' })
})

test('projects only package-declared knowledge and context requirements', () => {
  const projected = projectPackageDetails({ installation: {
    schema: 'hathq://hat-installation/v1', repositoryId: 'hat-example',
    packageId: 'hat/example', version: '1.0.0', specificationVersion: '1.0.0',
    packageSha256: 'd'.repeat(64), artifactRef: 'hathq://artifacts/example' },
  descriptor: { schema: 'hathq://hatter/hat-package-descriptor/v2',
    manifestId: 'hat/example', manifestName: 'Example HAT',
    capabilities: ['review-record'], decisionBoundaries: ['propose-only'],
    inputClassifications: ['internal'], outputClassification: 'internal',
    permissions: [{ resource: 'financial-record', mode: 'observe',
      operations: ['read-summary'] }], catalog: semanticCatalog([semanticTerm()]),
    operations: [{ id: 'hathq://vocabulary/action/review-record/v1',
      inputSchema: 'hathq://hat-example/review-input/v1',
      outputSchema: 'hathq://hat-example/review-output/v1',
      handlerKind: 'declarative-hat', procedure: { id: 'review-record-procedure', steps: [{
        actionId: 'hathq://vocabulary/action/review-record/v1',
        inputSchema: 'hathq://hat-example/review-input/v1',
        outputSchema: 'hathq://hat-example/review-output/v1' }] } }],
    contextRequirements: [{ operationId: 'hathq://vocabulary/action/review-record/v1',
      namespace: 'financial-record', projectionSchema: 'hathq://hat-example/financial-record/v1',
      required: true, unresolvedPolicy: 'record-unresolved' }] } })
  assert.equal(projected.descriptor.contextRequirements[0].required, true)
  assert.equal(projected.descriptor.permissions[0].mode, 'observe')
  assert.equal(projected.descriptor.operations[0].handlerKind, 'declarative-hat')
  assert.equal(projected.descriptor.catalog.terms[0].semanticIcon, 'accounting')
  const preview = projectCatalogPackagePreview({
    source: 'selected-signed-catalog', descriptor: projected.descriptor })
  assert.equal(preview.descriptor.manifestId, 'hat/example')
  assert.throws(() => projectCatalogPackagePreview({
    source: 'browser-upload', descriptor: projected.descriptor }), /hat-input-invalid/u)
  assert.throws(() => projectPackageDetails({ ...projected, descriptor: {
    ...projected.descriptor, contextRequirements: [{
      ...projected.descriptor.contextRequirements[0], projectionSchema: 'https://unknown.invalid' }] } }),
  /hat-input-invalid/u)
  assert.throws(() => projectPackageDetails({ ...projected, descriptor: {
    ...projected.descriptor, catalog: { ...projected.descriptor.catalog, terms: [{
      ...projected.descriptor.catalog.terms[0], semanticIcon: 'i-lucide-landmark' }] } } }),
  /hat-input-invalid/u)
})

test('projects protocol-speaking declarations and exact provider resolution', () => {
  const protocol = { ownerId: 'ietf', protocolId: 'urn:ietf:rfc:9112', version: 1,
    specificationRef: 'https://www.rfc-editor.org/rfc/rfc9112' }
  const projected = projectServiceRequirements({ serviceRequirements: [{
    schema: 'hatter://hat/service-requirement-projection/v1',
    contextPartitionId: 'partition-owner', consumerRepositoryId: 'hat-example',
    consumerPackageId: 'hat/example', consumerManifestName: 'Example HAT',
    consumerVersion: '1.0.0', requirementId: 'http-provider',
    operationIds: ['hathq://vocabulary/action/example/v1'], acceptedProtocols: [protocol],
    state: 'resolved', providerRepositoryId: 'hat-http-provider',
    providerProtocol: protocol, candidateRepositoryIds: ['hat-http-provider']
  }] })
  assert.deepEqual(projected.requirements[0].providerProtocol, protocol)
  assert.throws(() => projectServiceRequirements({ serviceRequirements: [{
    ...projected.requirements[0], state: 'protocol_incompatible',
    providerRepositoryId: null, providerProtocol: null, acceptedProtocols: []
  }] }), /hat-input-invalid/u)
})

test('preserves execute permissions declared by an operational HAT', () => {
  const projected = projectPackageDetails({ installation: {
    schema: 'hathq://hat-installation/v1', repositoryId: 'hat-github-operator',
    packageId: 'hat/github-operator', version: '1.1.0', specificationVersion: '1.0.0',
    packageSha256: 'd'.repeat(64), artifactRef: 'hathq://artifacts/github-operator' },
  descriptor: { schema: 'hathq://hatter/hat-package-descriptor/v2',
    manifestId: 'hat/github-operator', manifestName: 'GitHub Operator',
    capabilities: ['github-work-item-creation'],
    decisionBoundaries: ['execute-exact-github-grant'],
    inputClassifications: ['internal-confidential'], outputClassification: 'internal',
    permissions: [{ resource: 'github-issue-creation', mode: 'execute',
      operations: ['create-work-item'] }], catalog: semanticCatalog(), operations: [],
    contextRequirements: [] } })
  assert.equal(projected.descriptor.permissions[0].mode, 'execute')
  assert.throws(() => projectPackageDetails({ ...projected, descriptor: {
    ...projected.descriptor, permissions: [{ ...projected.descriptor.permissions[0],
      mode: 'admin' }] } }), /hat-input-invalid/u)
})

test('projects exact bounded worker availability without process details', () => {
  assert.deepEqual(workerReadParameters({ contextPartitionId: 'contextPartition-1',
    repositoryId: 'hat-example' }), {
    contextPartitionId: 'contextPartition-1', repositoryId: 'hat-example' })
  const projected = projectWorker({ worker: {
    schema: 'hatter://hat/worker-registration/v1', contextPartitionId: 'contextPartition-1',
    repositoryId: 'hat-example', packageSha256: 'a'.repeat(64), bindingRevision: 2,
    workerId: 'worker-1', workerServiceId: 'worker-service-1',
    workerIdentityRef: 'ihat/service/worker-service-1', locationId: 'location-1',
    locationDigestSha256: 'b'.repeat(64), placementSelectionDigestSha256: 'c'.repeat(64),
    transportProfileRef: 'crowsi/mtls-authority-v1', routeRef: 'crowsi/route/worker-service-1',
    revision: 3, observedAtEpochS: 10, expiresAtEpochS: 70
  } })
  assert.equal(projected.worker.workerId, 'worker-1')
  assert.equal(JSON.stringify(projected).includes('pid'), false)
  assert.deepEqual(workerUnregisterParameters({ contextPartitionId: 'contextPartition-1',
    repositoryId: 'hat-example', workerId: 'worker-1', expectedRevision: 3 }), {
    contextPartitionId: 'contextPartition-1', repositoryId: 'hat-example', workerId: 'worker-1',
    expectedRevision: 3 })
  assert.throws(() => workerUnregisterParameters({ contextPartitionId: 'contextPartition-1',
    repositoryId: 'hat-example', workerId: 'worker-2', expectedRevision: -1 }),
  /hat-input-invalid/u)
})

test('projects every installed operation with an explicit availability state', () => {
  assert.deepEqual(capabilityListParameters({}), {})
  const projected = projectCapabilities({ capabilities: [{
    schema: 'hatter://hat/capability/v1', contextPartitionId: 'personal',
    repositoryId: 'hat-example', packageId: 'hat/example', packageSha256: 'a'.repeat(64),
    version: '1.0.0', operationId: 'hathq://vocabulary/action/example/v1',
    inputSchema: 'hathq://hat-example/input/v1',
    outputSchema: 'hathq://hat-example/output/v1', handlerKind: 'declarative-hat',
    handlerReference: 'example-procedure', state: 'worker_unavailable'
  }] })
  assert.equal(projected.capabilities[0].state, 'worker_unavailable')
  assert.equal(projected.schema, 'hathq://hatter-console/hat-capabilities/v2')
  assert.equal(JSON.stringify(projected).includes('address'), false)
})

test('projects the bounded cross-partition capability set for a full HAT composition', () => {
  const base = {
    schema: 'hatter://hat/capability/v2', repositoryId: 'hat-example',
    packageId: 'hat/example', packageSha256: 'a'.repeat(64), version: '1.0.0',
    operationId: 'hathq://vocabulary/action/example/v1',
    inputSchema: 'hathq://hat-example/input/v1',
    outputSchema: 'hathq://hat-example/output/v1', handlerKind: 'declarative-hat',
    handlerReference: 'example-procedure', state: 'placement_required'
  }
  const capabilities = Array.from({ length: 266 }, (_, index) => ({ ...base,
    contextPartitionId: `partition-${String(index).padStart(4, '0')}` }))
  const projected = projectCapabilities({ capabilities })
  assert.equal(projected.capabilities.length, 266)
})

test('projects information declarations and preserves unavailable as unavailable', () => {
  const projected = projectInformationSurfaces({ informationSurfaces: [{
    schema: 'hatter://hat/information-surface-projection/v1',
    repositoryId: 'hat-github-operator', packageId: 'hat/github-operator',
    packageSha256: 'a'.repeat(64), version: '1.1.0', manifestName: 'GitHub Operator',
    surfaceId: 'github-repositories',
    canonicalType: 'domain.software.repository',
    projectionSchema: 'hathq://hat-github-operator/repository/v1',
    dataDomainTermId: 'hathq://vocabulary/data-domain/software-web/v1',
    subjectRelation: 'managed', semanticIcon: 'repository',
    actions: [{ contextPartitionId: null,
      operationId: 'hathq://vocabulary/action/create-private-github-repository/v1',
      effectKind: 'create', state: 'worker_unavailable' }]
  }] })
  assert.equal(projected.surfaces[0].actions[0].state, 'worker_unavailable')
  assert.equal(projected.surfaces[0].semanticIcon, 'repository')
  assert.throws(() => projectInformationSurfaces({ informationSurfaces: [{
    ...projected.surfaces[0], canonicalType: 'GitHubRepository' }] }), /hat-input-invalid/u)
  assert.throws(() => projectInformationSurfaces({ informationSurfaces: [{
    ...projected.surfaces[0], semanticIcon: '<svg />' }] }),
  /hatter-console-semantic-icon-invalid/u)
})

test('projects logical placement without an IP address or transport secret', () => {
  const projected = projectPlacement({ placement: {
    schema: 'hatter://hat/placement-record/v2', contextPartitionId: 'contextPartition-1',
    repositoryId: 'hat-example', bindingRevision: 2,
    federationDirectoryRevision: 4, federationDirectoryDigestSha256: 'd'.repeat(64),
    locationSetDigestSha256: 'e'.repeat(64),
    selectionDigestSha256: 'a'.repeat(64), locationDigestSha256: 'b'.repeat(64),
    selection: { selectionId: 'selection-1', revision: 1 },
    location: { locationId: 'location-1', executionKind: 'federated-managed',
      workerServiceId: 'worker-service-1', identityAuthorityRef: 'ihat/service/worker-service-1',
      transportProfileRef: 'crowsi/mtls-authority-v1', routeRef: 'crowsi/route/worker-service-1',
      expiresAtEpochS: 70 }
  } })
  assert.equal(projected.placement.locationId, 'location-1')
  assert.equal(projected.placement.federationDirectoryRevision, 4)
  assert.equal(JSON.stringify(projected).includes('address'), false)
})

test('invocation operations share one bounded exact projection', () => {
  const input = { repositoryId: 'hat-example',
    operationId: 'hathq://vocabulary/action/example/v1', invocationJson: '{}' }
  assert.deepEqual(invocationWriteParameters(input), input)
  assert.deepEqual(invocationReadParameters({ contextPartitionId: 'contextPartition-1',
    repositoryId: 'hat-example', invocationId: 'invoke-1' }), {
    contextPartitionId: 'contextPartition-1', repositoryId: 'hat-example', invocationId: 'invoke-1' })
  assert.deepEqual(invocationListParameters({ contextPartitionId: 'contextPartition-1',
    repositoryId: 'hat-example' }), {
    contextPartitionId: 'contextPartition-1', repositoryId: 'hat-example' })
  assert.equal(invocationControlParameters({ contextPartitionId: 'contextPartition-1',
    repositoryId: 'hat-example', invocationId: 'invoke-1', expectedStateRevision: 2,
    requestId: 'cancel-1', idempotencyKey: 'cancel-request-1' }, 'cancel').kind, 'cancel')
  const reference = { owner_id: 'zixcel', reference: 'artifact-1',
    schema_id: 'hathq://hat-example/input/v1', digest_sha256: 'a'.repeat(64) }
  const record = { schema: 'hatter://hat/invocation-record/v1',
    repository_id: 'hat-example', package_id: 'hat/example', package_sha256: 'b'.repeat(64),
    handler_kind: 'declarative-hat', handler_reference: 'review-procedure',
    request_kind: 'inference', admission: { execution: { model_route: { ...reference, reference: 'route-example' } } },
    timing: { requested_at_unix_ms: 10, planned_start_at_unix_ms: 10,
      planned_end_at_unix_ms: null, time_zone: 'UTC',
      actual_started_at_unix_ms: null, actual_completed_at_unix_ms: null },
    invocation: { invocation_id: 'invoke-1', operation_id: 'hathq://vocabulary/action/example/v1',
      expected_projection_revision: 0, idempotency_key: 'request-1', input: reference,
      effective_grant: { ...reference, schema_id: 'hathq://hatter/execution/grant/v1' },
      placement: { ...reference, schema_id: 'hathq://hat/placement/v1' },
      context_partition: { context_partition_id: 'contextPartition-1', revision: 1 } },
    status: { schema: 'hathq://hat/action-status/v2', invocation_id: 'invoke-1',
      context_partition_id: 'contextPartition-1', state_revision: 1, phase: 'queued', reason_id: null },
    result: null, pending_result: null, pending_event: null }
  const projected = projectInvocation({ invocationJson: JSON.stringify(record) })
  assert.equal(projected.invocation.status.phase, 'queued')
  assert.equal(projected.invocation.handlerReference, 'review-procedure')
  assert.equal(projected.invocation.requestKind, 'inference')
  assert.equal(projected.invocation.routeId, 'route-example')
  assert.equal(projected.invocation.routeReference.digestSha256, reference.digest_sha256)
  assert.throws(() => projectInvocation({ invocationJson: JSON.stringify({ ...record, model_route_id: 'route-example' }) }))
  assert.equal(projected.invocation.timing.requestedAtUnixMs, 10)
  assert.deepEqual(projectInvocationList({ invocationJsons: [JSON.stringify(record)] })
    .invocations, [projected.invocation])
  assert.equal(JSON.stringify(projected).includes('body'), false)
})

test('projects bounded projection-journal references without copying source bodies', () => {
  assert.deepEqual(projectionJournalReadParameters({ contextPartitionId: 'contextPartition-1',
    packageId: 'hat/example', fromRevision: 2, limit: 32 }), {
    contextPartitionId: 'contextPartition-1', packageId: 'hat/example', fromRevision: 2, limit: 32
  })
  const projected = projectProjectionJournal({ projectionJournalJson: JSON.stringify({
    schema: 'hathq://hat/projection-journal/v1', context_partition_id: 'contextPartition-1',
    package_id: 'hat/example', from_revision: 2, to_revision: 3, events: [{
      schema: 'hathq://hat/projection-event/v1', event_id: 'event-3',
      event_type: 'core.event.action.completed',
      occurred_time: { start_epoch_ms: 1_700_000_000_003, end_epoch_ms: null },
      observed_at_epoch_ms: 1_700_000_000_003,
      correlation_id: 'invoke-1', causation_id: null, invocation_id: 'invoke-1',
      context_partition_id: 'contextPartition-1', operation_id: 'hathq://vocabulary/action/example/v1',
      previous_revision: 2, next_revision: 3, evidence_refs: [{
        owner_id: 'zixcel-filesystem', reference: 'receipt-3',
        digest_sha256: 'f'.repeat(64) }] }] }) })
  assert.equal(projected.projectionJournal.events[0].evidenceRefs[0].ownerId,
    'zixcel-filesystem')
  assert.equal(projected.projectionJournal.events[0].eventType,
    'core.event.action.completed')
  assert.equal(projected.projectionJournal.events[0].correlationId, 'invoke-1')
  assert.equal(JSON.stringify(projected).includes('body'), false)
})
