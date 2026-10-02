// Modified by the Hatter downstream project, 2026.
// Purpose: present the accepted route reference and never a late route selector.
import { assertSafeProjection } from './projection.mjs'
import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import { vocabularyPresentation } from '../../shared/vocabulary-presentation.mjs'

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const LOWER_HEX_32 = /^[0-9a-f]{64}$/u
const PROTOCOL_REF = /^[a-z][a-z0-9+.-]{1,31}:[^\s@?#]+$/u

export function installLocalParameters(value) {
  const localPath = text(value?.localPath, 4096)
  if (!isAbsolute(localPath) || localPath.includes('\0')) invalid()
  return { repositoryId: repositoryId(value?.repositoryId), localPath }
}

export function installIpParameters(value) {
  const ipAddress = text(value?.ipAddress, 45)
  const port = Number(value?.port)
  if (isIP(ipAddress) === 0 || !Number.isSafeInteger(port) || port < 1 || port > 65535) invalid()
  return { repositoryId: repositoryId(value?.repositoryId), ipAddress, port,
    publicKeyHex: fixedHex(value?.publicKeyHex, 64) }
}

export function packageReadParameters(value) {
  return { repositoryId: token(value?.repositoryId) }
}

export function capabilityListParameters(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 0) invalid()
  return {}
}

export function bindingReadParameters(value) {
  return {
    contextPartitionId: token(value?.contextPartitionId),
    repositoryId: token(value?.repositoryId)
  }
}

// Hatter P1-B: preserve the submitted Foundation base and owner refs; never invent adoption.
export function activationWriteParameters(value) {
  return canonicalCommand(value, ['control', 'activation', 'causation_ref', 'parent_ref'])
}
function canonicalCommand(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== keys.sort().join(',')
    || typeof value.control?.operation_id !== 'string'
    || !value.control?.expected_commit_revision
    || !value.causation_ref || !value.parent_ref) invalid()
  return assertSafeProjection(parseDocument(document(JSON.stringify(value))))
}

export function compositionPrepareParameters(value) {
  const members = boundedArray(value?.members, 64).map(member => {
    if (['catalogDigestSha256', 'dependencyRepositoryIds', 'incompatibleRepositoryIds']
      .some(field => Object.hasOwn(member ?? {}, field))) invalid()
    return { repository_id: repositoryId(member?.repositoryId),
      fitting_digest_sha256: digest(member?.fittingDigestSha256),
      policy_digest_sha256: digest(member?.policyDigestSha256) }
  })
  if (!members.length) invalid()
  return { requestJson: JSON.stringify({ proposal_id: token(value?.proposalId),
    subject_ref: subjectReference(value?.subjectRef), scope_ref: subjectReference(value?.scopeRef),
    members }) }
}

export function compositionApproveParameters(value) {
  return canonicalCommand(value, ['control', 'proposal', 'approval', 'semantic_refs', 'causation_ref', 'parent_ref'])
}

export function compositionReadParameters(value) {
  return { subjectRef: subjectReference(value?.subjectRef), scopeRef: subjectReference(value?.scopeRef) }
}

export function placementReadParameters(value) { return bindingReadParameters(value) }
export function setupCompleteParameters(value) {
  return { repositoryId: repositoryId(value?.repositoryId),
    templateId: token(value?.templateId), projectionRef: subjectReference(value?.projectionRef),
    expectedRevision: optionalRevision(value?.expectedRevision) ?? 0 }
}
export function placementSelectParameters(value) {
  return { ...bindingReadParameters(value), locationId: token(value?.locationId),
    expectedRevision: optionalRevision(value?.expectedRevision) ?? 0 }
}

export function projectionJournalReadParameters(value) {
  const fromRevision = optionalRevision(value?.fromRevision) ?? 0
  const limit = Number(value?.limit ?? 64)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) invalid()
  return { contextPartitionId: token(value?.contextPartitionId),
    packageId: packageId(value?.packageId), fromRevision, limit }
}

export function invocationWriteParameters(value) {
  return { repositoryId: token(value?.repositoryId),
    operationId: vocabularyId(value?.operationId),
    invocationJson: document(value?.invocationJson) }
}

export function invocationReadParameters(value) {
  return { ...bindingReadParameters(value), invocationId: token(value?.invocationId) }
}

export function invocationListParameters(value) { return bindingReadParameters(value) }

export function invocationControlParameters(value, kind) {
  if (!['cancel', 'recover'].includes(kind)) invalid()
  return { ...invocationReadParameters(value),
    expectedStateRevision: revision(value?.expectedStateRevision),
    requestId: token(value?.requestId), idempotencyKey: token(value?.idempotencyKey), kind }
}

export function workerClaimParameters(value) {
  return { ...bindingReadParameters(value), workerId: token(value?.workerId) }
}
export function workerReadParameters(value) { return bindingReadParameters(value) }
export function workerUnregisterParameters(value) {
  return { ...bindingReadParameters(value), workerId: token(value?.workerId),
    expectedRevision: revision(value?.expectedRevision) }
}
export function workerStatusParameters(value) {
  return { repositoryId: token(value?.repositoryId), workerId: token(value?.workerId),
    statusJson: document(value?.statusJson) }
}
export function workerResultParameters(value) {
  return { ...bindingReadParameters(value), workerId: token(value?.workerId),
    resultJson: document(value?.resultJson),
    failureJson: value?.failureJson == null ? null : document(value.failureJson) }
}

export function projectInstallation(value) {
  const installation = value?.installation
  return safe({ schema: 'hathq://hatter-console/hat-installation/v1', installation: {
    schema: text(installation?.schema, 160),
    repositoryId: token(installation?.repositoryId),
    packageId: packageId(installation?.packageId),
    version: text(installation?.version, 80),
    specificationVersion: text(installation?.specificationVersion, 80),
    packageSha256: digest(installation?.packageSha256),
    artifactReference: text(installation?.artifactRef, 2048)
  } })
}

export function projectPackageDetails(value) {
  const installation = projectInstallation(value).installation
  return safe({ schema: 'hathq://hatter-console/hat-package-details/v1', installation,
    descriptor: projectDescriptor(value?.descriptor) })
}

export function projectCatalogPackagePreview(value) {
  if (value?.source !== 'selected-signed-catalog') invalid()
  return safe({ schema: 'hathq://hatter-console/hat-catalog-package-preview/v1',
    source: value.source, descriptor: projectDescriptor(value?.descriptor) })
}

function projectDescriptor(descriptor) {
  if (descriptor?.schema !== 'hathq://hatter/hat-package-descriptor/v2') invalid()
  const classifications = ['public', 'internal', 'internal-confidential',
    'restricted-sensitive']
  return { schema: descriptor.schema, manifestId: packageId(descriptor.manifestId),
      manifestName: text(descriptor.manifestName, 100),
      capabilities: tokenList(descriptor.capabilities, 256),
      decisionBoundaries: tokenList(descriptor.decisionBoundaries, 128),
      inputClassifications: choiceList(descriptor.inputClassifications, classifications, 8),
      outputClassification: choice(descriptor.outputClassification, classifications),
      permissions: boundedArray(descriptor.permissions, 256).map(permission => ({
        resource: token(permission?.resource),
        mode: choice(permission?.mode, ['observe', 'propose', 'execute']),
        operations: tokenList(permission?.operations, 64) })),
      operations: boundedArray(descriptor.operations, 128).map(operation => ({
        id: vocabularyId(operation?.id), inputSchema: schemaId(operation?.inputSchema),
        outputSchema: schemaId(operation?.outputSchema),
        handlerKind: choice(operation?.handlerKind,
          ['declarative-hat', 'hat-service', 'ecosystem-adapter', 'delegated-hat']),
        procedure: { id: token(operation?.procedure?.id),
          steps: boundedArray(operation?.procedure?.steps, 64).map(step => ({
            actionId: vocabularyId(step?.actionId), inputSchema: schemaId(step?.inputSchema),
            outputSchema: schemaId(step?.outputSchema) })) },
        effects: boundedArray(operation?.effects ?? [], 16).map(effect => ({
          kind: choice(effect?.kind, ['create', 'link', 'update']),
          surfaceId: token(effect?.surfaceId) })) })),
      informationSurfaces: boundedArray(descriptor.informationSurfaces ?? [], 64).map(surface => ({
        id: token(surface?.id),
        canonicalType: canonicalType(surface?.canonicalType),
        projectionSchema: schemaId(surface?.projectionSchema),
        dataDomainTermId: dataDomainTerm(surface?.dataDomainTermId),
        subjectRelation: choice(surface?.subjectRelation, ['owned', 'managed', 'used']),
        ...semanticIcon(surface?.semanticIcon) })),
      serviceRequirements: boundedArray(descriptor.serviceRequirements ?? [], 32).map(item => ({
        id: token(item?.id),
        operationIds: uniqueVocabularyIds(item?.operationIds, 16),
        acceptedProtocols: boundedArray(item?.acceptedProtocols ?? [], 16).map(protocolReference) })),
      communicationCapabilities: boundedArray(descriptor.communicationCapabilities ?? [], 32)
        .map(item => {
          if (item?.schema !== 'hathq://hat/communication-capability/v1') invalid()
          return { schema: item.schema, id: token(item?.id),
            protocol: protocolReference(item?.protocol),
            role: choice(item?.role, ['client', 'server', 'peer']),
            direction: choice(item?.direction, ['send', 'receive', 'bidirectional']),
            operationIds: uniqueVocabularyIds(item?.operationIds, 64) }
        }),
      setupTemplates: boundedArray(descriptor.setupTemplates ?? [], 32).map(item => ({
        id: token(item?.id), title: text(item?.title, 160), summary: text(item?.summary, 512),
        actionLabel: text(item?.actionLabel, 120),
        contextNamespace: token(item?.contextNamespace),
        projectionSchema: schemaId(item?.projectionSchema) })),
      catalog: projectSemanticCatalog(descriptor.catalog),
      contextRequirements: boundedArray(descriptor.contextRequirements, 512).map(item => ({
        operationId: vocabularyId(item?.operationId), namespace: token(item?.namespace),
        projectionSchema: schemaId(item?.projectionSchema), required: item?.required === true,
        unresolvedPolicy: token(item?.unresolvedPolicy) })) }
}

function projectSemanticCatalog(catalog) {
  if (catalog?.schema !== 'hathq://hat/semantic-catalog/v1') invalid()
  const kinds = ['concept', 'entity-type', 'relation', 'predicate', 'property', 'event-type',
    'state-type', 'action', 'reason', 'unit', 'protocol-field']
  const termReference = value => ({ catalogId: text(value?.catalogId, 512),
    catalogDigestSha256: digest(value?.catalogDigestSha256),
    termId: text(value?.termId, 512), version: revision(value?.version),
    definitionDigestSha256: digest(value?.definitionDigestSha256),
    kind: choice(value?.kind, kinds) })
  const catalogReference = value => ({ catalogId: text(value?.catalogId, 512),
    version: revision(value?.version), digestSha256: digest(value?.digestSha256) })
  return { schema: catalog.schema, identity: catalogReference(catalog.identity),
    ownerRepositoryId: repositoryId(catalog.ownerRepositoryId), foundation: catalog.foundation === true,
    dependencies: boundedArray(catalog.dependencies, 64).map(catalogReference),
    incompatibilities: boundedArray(catalog.incompatibilities, 64).map(catalogReference),
    terms: boundedArray(catalog.terms, 4096).map(term => ({
      reference: termReference(term?.reference),
      ...(term?.wireSchema == null ? {} : { wireSchema: schemaId(term.wireSchema) }),
      ...semanticIcon(term?.semanticIcon),
      dependencies: boundedArray(term?.dependencies, 128).map(termReference),
      isA: boundedArray(term?.isA, 128).map(termReference),
      domain: boundedArray(term?.domain, 128).map(termReference),
      range: boundedArray(term?.range, 128).map(termReference) })),
    lexicalizations: boundedArray(catalog.lexicalizations, 16384).map(item => ({
      term: termReference(item?.term), locale: text(item?.locale, 35),
      preferred: text(item?.preferred, 160),
      searchAliases: boundedArray(item?.searchAliases, 32).map(value => text(value, 160)) })),
    frames: boundedArray(catalog.frames, 1024).map(frame => ({
      frameId: text(frame?.frameId, 512),
      definitionDigestSha256: digest(frame?.definitionDigestSha256),
      predicate: termReference(frame?.predicate),
      roles: boundedArray(frame?.roles, 16).map(role => ({
        role: choice(role?.role, ['actor', 'subject', 'object', 'value', 'source',
          'destination', 'instrument', 'time', 'place', 'evidence', 'output']),
        required: role?.required === true,
        acceptedKinds: choiceList(role?.acceptedKinds, kinds, kinds.length) })) })) }
}

export function projectSetupTasks(value) {
  if (!Array.isArray(value?.setupTasks) || value.setupTasks.length > 2048) invalid()
  return safe({ schema: 'hathq://hatter-console/hat-setup-tasks/v2',
    tasks: value.setupTasks.map(setupTask) })
}

function setupTask(item) {
  const revision = optionalRevision(item?.revision) ?? 0
  const projectionRef = item?.projectionRef == null ? null : subjectReference(item.projectionRef)
  const status = choice(item?.status, ['unresolved', 'completed'])
  if ((status === 'completed') !== (revision > 0 && projectionRef !== null)) invalid()
  return { schema: exactSetupSchema(item?.schema), repositoryId: repositoryId(item?.repositoryId),
    packageId: packageId(item?.packageId), version: text(item?.version, 80),
    packageSha256: digest(item?.packageSha256), templateId: token(item?.templateId),
    title: text(item?.title, 160), summary: text(item?.summary, 512),
    actionLabel: text(item?.actionLabel, 120), contextNamespace: token(item?.contextNamespace),
    projectionSchema: schemaId(item?.projectionSchema), revision, projectionRef, status }
}

function exactSetupSchema(value) {
  const result = text(value, 80)
  if (result !== 'hatter://hat/setup-task/v2') invalid()
  return result
}

export function projectCapabilities(value) {
  if (!Array.isArray(value?.capabilities) || value.capabilities.length > 4096) invalid()
  return safe({ schema: 'hathq://hatter-console/hat-capabilities/v2',
    capabilities: value.capabilities.map(item => {
      const state = text(item?.state, 48)
      if (!['binding_required', 'binding_inactive', 'placement_required',
        'location_operation_unavailable', 'worker_unavailable', 'available'].includes(state)) {
        invalid()
      }
      return { schema: text(item?.schema, 160),
        contextPartitionId: token(item?.contextPartitionId),
        repositoryId: repositoryId(item?.repositoryId), packageId: packageId(item?.packageId),
        packageSha256: digest(item?.packageSha256), version: text(item?.version, 80),
        operationId: vocabularyId(item?.operationId), inputSchema: schemaId(item?.inputSchema),
        outputSchema: schemaId(item?.outputSchema), handlerKind: token(item?.handlerKind),
        handlerReference: subjectReference(item?.handlerReference), state,
        ...semanticIcon(item?.semanticIcon) }
    }) })
}

export function projectContinuity(value) {
  const source = value?.continuity
  if (source?.schema !== 'hathq://hatter/resource-continuity/v1'
    || !Array.isArray(source.items) || source.items.length > 8192) invalid()
  return safe({ schema: source.schema, items: source.items.map(item => ({
    resourceKind: choice(item?.resourceKind, ['hat_package', 'hat_worker']),
    repositoryId: repositoryId(item?.repositoryId),
    contextPartitionId: item?.contextPartitionId == null ? null : token(item.contextPartitionId),
    packageSha256: digest(item?.packageSha256),
    decision: continuityDecision(item?.decision)
  })) })
}

function continuityDecision(value) {
  return { state: choice(value?.state, ['retained', 'recovery_available', 'move_available',
    'registration_required', 'reregistration_required', 'blocked']),
  action: choice(value?.action, ['none', 'restore_exact_release', 'restore_marker',
    'confirm_move', 'register', 'reregister', 'rebind', 'reconnect', 'select_placement',
    'review_conflict']), reason: token(value?.reason) }
}

export function projectInformationSurfaces(value) {
  const surfaces = boundedArray(value?.informationSurfaces, 4096).map(surface => ({
    schema: exact(surface?.schema, 'hatter://hat/information-surface-projection/v1'),
    repositoryId: repositoryId(surface?.repositoryId),
    packageId: packageId(surface?.packageId), packageSha256: digest(surface?.packageSha256),
    version: text(surface?.version, 80), manifestName: text(surface?.manifestName, 100),
    surfaceId: token(surface?.surfaceId),
    canonicalType: canonicalType(surface?.canonicalType),
    projectionSchema: schemaId(surface?.projectionSchema),
    dataDomainTermId: dataDomainTerm(surface?.dataDomainTermId),
    subjectRelation: choice(surface?.subjectRelation, ['owned', 'managed', 'used']),
    ...semanticIcon(surface?.semanticIcon),
    actions: boundedArray(surface?.actions, 2048).map(action => ({
      contextPartitionId: action?.contextPartitionId == null
        ? null : token(action.contextPartitionId),
      operationId: vocabularyId(action?.operationId),
      effectKind: choice(action?.effectKind, ['create', 'link', 'update']),
      state: choice(action?.state, ['binding_required', 'binding_inactive',
        'placement_required', 'location_operation_unavailable', 'worker_unavailable',
        'available']) }))
  }))
  return safe({ schema: 'hathq://hatter-console/hat-information-surfaces/v1', surfaces })
}

export function projectServiceRequirements(value) {
  const requirements = boundedArray(value?.serviceRequirements, 4096).map(item => ({
    schema: exact(item?.schema, 'hatter://hat/service-requirement-projection/v1'),
    contextPartitionId: token(item?.contextPartitionId),
    consumerRepositoryId: repositoryId(item?.consumerRepositoryId),
    consumerPackageId: packageId(item?.consumerPackageId),
    consumerManifestName: text(item?.consumerManifestName, 100),
    consumerVersion: text(item?.consumerVersion, 80),
    requirementId: token(item?.requirementId),
    operationIds: uniqueVocabularyIds(item?.operationIds, 16),
    acceptedProtocols: boundedArray(item?.acceptedProtocols ?? [], 16).map(protocolReference),
    state: choice(item?.state,
      ['missing', 'protocol_incompatible', 'unavailable', 'ambiguous', 'resolved']),
    providerRepositoryId: item?.providerRepositoryId == null
      ? null : repositoryId(item.providerRepositoryId),
    providerProtocol: item?.providerProtocol == null
      ? null : protocolReference(item.providerProtocol),
    candidateRepositoryIds: uniqueRepositoryIds(item?.candidateRepositoryIds, 64)
  }))
  for (const item of requirements) {
    const hasProvider = item.providerRepositoryId != null
    const hasProtocol = item.providerProtocol != null
    if (hasProvider !== (item.state === 'resolved')
      || hasProtocol && !hasProvider
      || hasProtocol && !item.acceptedProtocols.some(protocol =>
        JSON.stringify(protocol) === JSON.stringify(item.providerProtocol))
      || hasProvider && !item.candidateRepositoryIds.includes(item.providerRepositoryId)
      || item.state === 'missing' && item.candidateRepositoryIds.length
      || item.state === 'protocol_incompatible'
        && (!item.candidateRepositoryIds.length || !item.acceptedProtocols.length)
      || item.state === 'unavailable' && !item.candidateRepositoryIds.length
      || item.state === 'ambiguous' && item.candidateRepositoryIds.length < 2) invalid()
  }
  const identities = requirements.map(item =>
    `${item.contextPartitionId}|${item.consumerRepositoryId}|${item.requirementId}`)
  if (new Set(identities).size !== identities.length) invalid()
  return safe({ schema: 'hathq://hatter-console/hat-service-requirements/v1', requirements })
}

function protocolReference(value) {
  const protocolId = text(value?.protocolId, 384)
  const specificationRef = text(value?.specificationRef, 384)
  if (!PROTOCOL_REF.test(protocolId) || !PROTOCOL_REF.test(specificationRef)) invalid()
  return { ownerId: token(value?.ownerId), protocolId, version: revision(value?.version),
    specificationRef }
}

export function projectActivation(value) {
  const binding = value?.activation
  return safe({ schema: 'hatter://console/capability/activation/v1', activation: {
    schema: exact(binding?.schema, 'hatter://capability/activation/v1'),
    contextPartitionId: token(binding?.contextPartitionId),
    repositoryId: token(binding?.repositoryId),
    packageId: packageId(binding?.packageId),
    packageSha256: digest(binding?.packageSha256),
    policyDigestSha256: digest(binding?.policyDigestSha256),
    catalogDigestSha256: digest(binding?.catalogDigestSha256),
    fittingDigestSha256: digest(binding?.fittingDigestSha256),
    subjectRef: subjectReference(binding?.subjectRef),
    scopeRef: subjectReference(binding?.scopeRef),
    semanticBindingRef: {
      namespace: text(binding?.semanticBindingRef?.namespace, 512),
      revision: text(binding?.semanticBindingRef?.revision, 512)
    },
    revision: revision(binding?.revision), active: binding?.active === true
  } })
}

export function projectCompositionPreview(value) {
  const preview = value?.preview
  const proposal = projectCompositionProposal(preview?.proposal)
  const proposalJson = document(value?.proposalJson)
  if (JSON.stringify(proposal) !== JSON.stringify(projectCompositionProposalWire(
    parseDocument(proposalJson)))) invalid()
  return safe({ schema: 'hathq://hatter-console/hat-composition-preview/v1', plan: {
    proposal,
    proposalDigestSha256: digest(preview?.proposalDigestSha256),
    proposalJson
  } })
}

export function projectComposition(value) {
  const composition = value?.composition
  const proposal = projectCompositionProposal(composition?.proposal)
  const approval = composition?.approval
  return safe({ schema: 'hathq://hatter-console/hat-composition/v1', composition: {
    schema: text(composition?.schema, 160), compositionId: token(composition?.compositionId),
    revision: revision(composition?.revision),
    proposalDigestSha256: digest(composition?.proposalDigestSha256), proposal,
    approval: { schema: exact(approval?.schema, 'hathq://hat/composition-approval/v1'),
      approvalId: token(approval?.approvalId),
      proposalDigestSha256: digest(approval?.proposalDigestSha256),
      approvedBySubjectRef: subjectReference(approval?.approvedBySubjectRef),
      expectedCompositionRevision: optionalRevision(approval?.expectedCompositionRevision) },
    bindings: boundedArray(composition?.bindings, 64)
      .map(binding => projectActivation({ activation: binding }).activation)
  } })
}

function projectCompositionProposal(value) {
  return { schema: exact(value?.schema, 'hathq://hat/composition-proposal/v1'),
    proposalId: token(value?.proposalId), subjectRef: subjectReference(value?.subjectRef),
    scopeRef: subjectReference(value?.scopeRef),
    expectedCompositionRevision: optionalRevision(value?.expectedCompositionRevision),
    members: boundedArray(value?.members, 64).map(member => ({
      repositoryId: repositoryId(member?.repositoryId), packageId: packageId(member?.packageId),
      packageDigestSha256: digest(member?.packageDigestSha256),
      catalogDigestSha256: digest(member?.catalogDigestSha256),
      fittingDigestSha256: digest(member?.fittingDigestSha256),
      policyDigestSha256: digest(member?.policyDigestSha256),
      expectedBindingRevision: optionalRevision(member?.expectedBindingRevision),
      dependencyRepositoryIds: tokenList(member?.dependencyRepositoryIds, 64),
      incompatibleRepositoryIds: tokenList(member?.incompatibleRepositoryIds, 64),
      operationIds: boundedArray(member?.operationIds, 128).map(vocabularyId) })) }
}

function projectCompositionProposalWire(value) {
  return projectCompositionProposal({ schema: value?.schema, proposalId: value?.proposal_id,
    subjectRef: value?.subject_ref, scopeRef: value?.scope_ref,
    expectedCompositionRevision: value?.expected_composition_revision,
    members: boundedArray(value?.members, 64).map(member => ({
      repositoryId: member?.repository_id, packageId: member?.package_id,
      packageDigestSha256: member?.package_digest_sha256,
      catalogDigestSha256: member?.catalog_digest_sha256,
      fittingDigestSha256: member?.fitting_digest_sha256,
      policyDigestSha256: member?.policy_digest_sha256,
      expectedBindingRevision: member?.expected_binding_revision,
      dependencyRepositoryIds: member?.dependency_repository_ids,
      incompatibleRepositoryIds: member?.incompatible_repository_ids,
      operationIds: member?.operation_ids })) })
}

export function projectInvocation(value) {
  const record = parseDocument(value?.invocationJson)
  if (record.schema !== 'hatter://hat/invocation-record/v1') invalid()
  const invocation = record.invocation
  const status = record.status
  const contextPartitionId = token(invocation?.context_partition?.context_partition_id)
  const invocationId = token(invocation?.invocation_id)
  if (status?.schema !== 'hathq://hat/action-status/v2'
    || token(status?.context_partition_id) !== contextPartitionId
    || token(status?.invocation_id) !== invocationId) invalid()
  const phase = text(status.phase, 32)
  if (!['queued', 'running', 'waiting', 'unresolved', 'completed',
    'failed', 'cancelled'].includes(phase)) invalid()
  const timing = record.timing
  const requestedAtUnixMs = instant(timing?.requested_at_unix_ms)
  const plannedStartAtUnixMs = instant(timing?.planned_start_at_unix_ms)
  const plannedEndAtUnixMs = optionalInstant(timing?.planned_end_at_unix_ms)
  const actualStartedAtUnixMs = optionalInstant(timing?.actual_started_at_unix_ms)
  const actualCompletedAtUnixMs = optionalInstant(timing?.actual_completed_at_unix_ms)
  const requestKind = choice(record.request_kind, ['hat-operation', 'inference'])
  if (!record.admission?.execution || 'model_route_id' in record) invalid()
  const routeReference = record.admission.execution.model_route == null
    ? null : projectActionReference(record.admission.execution.model_route)
  const routeId = routeReference == null ? null : token(routeReference.reference)
  if (requestedAtUnixMs > plannedStartAtUnixMs
    || plannedEndAtUnixMs != null && plannedEndAtUnixMs < plannedStartAtUnixMs
    || actualStartedAtUnixMs != null && actualStartedAtUnixMs < plannedStartAtUnixMs
    || actualCompletedAtUnixMs != null
      && (actualStartedAtUnixMs == null || actualCompletedAtUnixMs < actualStartedAtUnixMs)
    || (requestKind === 'inference') !== (routeId != null)) invalid()
  return safe({ schema: 'hathq://hatter-console/hat-invocation/v1', invocation: {
    schema: record.schema, repositoryId: token(record.repository_id),
    packageId: packageId(record.package_id), packageSha256: digest(record.package_sha256),
    handlerKind: token(record.handler_kind),
    handlerReference: subjectReference(record.handler_reference), invocationId,
    requestKind, routeId, routeReference,
    timing: { requestedAtUnixMs, plannedStartAtUnixMs, plannedEndAtUnixMs,
      timeZone: text(timing?.time_zone, 80), actualStartedAtUnixMs, actualCompletedAtUnixMs },
    contextPartitionId, contextPartitionRevision: revision(invocation.context_partition.revision),
    operationId: vocabularyId(invocation.operation_id),
    expectedProjectionRevision: revision(invocation.expected_projection_revision),
    idempotencyKey: token(invocation.idempotency_key),
    input: projectActionReference(invocation.input),
    effectiveGrant: projectActionReference(invocation.effective_grant),
    placement: projectActionReference(invocation.placement),
    status: { stateRevision: revision(status.state_revision), phase,
      reasonId: optionalSchemaId(status.reason_id) },
    result: record.result == null ? null : projectResult(record.result, invocationId),
    recoveryPending: record.pending_result != null
  } })
}

export function projectInvocationList(value) {
  const records = boundedArray(value?.invocationJsons, 320)
    .map(invocationJson => projectInvocation({ invocationJson }).invocation)
  const identities = records.map(item => item.invocationId)
  if (new Set(identities).size !== identities.length) invalid()
  return safe({ schema: 'hathq://hatter-console/hat-invocations/v1', invocations: records })
}

export function projectLease(value) {
  const lease = parseDocument(value?.leaseJson)
  if (lease == null) return safe({ schema: 'hathq://hatter-console/hat-lease/v1', lease: null })
  const projected = projectInvocation({ invocationJson: JSON.stringify(lease.record) })
  return safe({ schema: 'hathq://hatter-console/hat-lease/v1',
    laneRevision: revision(lease.lane_revision), lease: projected.invocation })
}

export function projectWorker(value) {
  const worker = value?.worker
  return safe({ schema: 'hathq://hatter-console/hat-worker/v1', worker: {
    schema: text(worker?.schema, 160), contextPartitionId: token(worker?.contextPartitionId),
    repositoryId: token(worker?.repositoryId), packageSha256: digest(worker?.packageSha256),
    bindingRevision: revision(worker?.bindingRevision), workerId: token(worker?.workerId),
    workerServiceId: token(worker?.workerServiceId),
    workerIdentityRef: subjectReference(worker?.workerIdentityRef),
    locationId: token(worker?.locationId),
    locationDigestSha256: digest(worker?.locationDigestSha256),
    placementSelectionDigestSha256: digest(worker?.placementSelectionDigestSha256),
    transportProfileRef: subjectReference(worker?.transportProfileRef),
    routeRef: subjectReference(worker?.routeRef),
    revision: revision(worker?.revision), observedAtEpochS: revision(worker?.observedAtEpochS),
    expiresAtEpochS: revision(worker?.expiresAtEpochS)
  } })
}

export function projectPlacement(value) {
  const placement = value?.placement
  const selection = placement?.selection
  const location = placement?.location
  return safe({ schema: 'hathq://hatter-console/hat-placement/v1', placement: {
    schema: text(placement?.schema, 160), contextPartitionId: token(placement?.contextPartitionId),
    repositoryId: token(placement?.repositoryId), bindingRevision: revision(placement?.bindingRevision),
    federationDirectoryRevision: revision(placement?.federationDirectoryRevision),
    federationDirectoryDigestSha256: digest(placement?.federationDirectoryDigestSha256),
    locationSetDigestSha256: digest(placement?.locationSetDigestSha256),
    selectionId: token(selection?.selectionId), selectionRevision: revision(selection?.revision),
    selectionDigestSha256: digest(placement?.selectionDigestSha256),
    locationId: token(location?.locationId),
    locationDigestSha256: digest(placement?.locationDigestSha256),
    executionKind: text(location?.executionKind, 32), workerServiceId: token(location?.workerServiceId),
    identityAuthorityRef: subjectReference(location?.identityAuthorityRef),
    transportProfileRef: subjectReference(location?.transportProfileRef),
    routeRef: subjectReference(location?.routeRef), expiresAtEpochS: revision(location?.expiresAtEpochS)
  } })
}

export function projectPlacementCandidates(value) {
  const locations = boundedArray(value?.locations, 64).map(item => {
    const location = item?.location
    return { sourceId: token(item?.sourceId), contextPartitionId: token(item?.contextPartitionId),
      repositoryId: token(item?.repositoryId),
      directoryRevision: revision(item?.directoryRevision),
      directoryDigestSha256: digest(item?.directoryDigestSha256),
      locationSetDigestSha256: digest(item?.locationSetDigestSha256),
      locationDigestSha256: digest(item?.locationDigestSha256),
      locationId: token(location?.locationId), executionKind: text(location?.executionKind, 32),
      workerServiceId: token(location?.workerServiceId),
      identityAuthorityRef: subjectReference(location?.identityAuthorityRef),
      transportProfileRef: subjectReference(location?.transportProfileRef),
      routeRef: subjectReference(location?.routeRef),
      region: location?.region == null ? null : token(location.region),
      jurisdictions: tokenList(location?.jurisdictions, 16),
      dataResidencies: tokenList(location?.dataResidencies, 16),
      operationIds: boundedArray(location?.operationIds, 128).map(vocabularyId),
      acceptedClassifications: choiceList(location?.acceptedClassifications,
        ['public', 'internal', 'internal-confidential', 'restricted-sensitive'], 8),
      assurance: choice(location?.assurance, ['official', 'verified']),
      expiresAtEpochS: revision(location?.expiresAtEpochS) }
  })
  return safe({ schema: 'hathq://hatter-console/hat-placement-candidates/v1', locations })
}

export function projectProjectionJournal(value) {
  const document = parseDocument(value?.projectionJournalJson)
  if (document.schema !== 'hathq://hat/projection-journal/v1'
    || !Array.isArray(document.events) || document.events.length > 256) invalid()
  const contextPartitionId = token(document.context_partition_id)
  const events = document.events.map(event => projectEvent(event, contextPartitionId))
  return safe({ schema: 'hathq://hatter-console/hat-projection-journal/v1', projectionJournal: {
    schema: document.schema, contextPartitionId, packageId: packageId(document.package_id),
    fromRevision: revision(document.from_revision), toRevision: revision(document.to_revision),
    events } })
}

function projectEvent(value, contextPartitionId) {
  const occurred = value?.occurred_time
  if (value?.schema !== 'hathq://hat/projection-event/v1'
    || value?.event_type !== 'core.event.action.completed'
    || token(value?.context_partition_id) !== contextPartitionId
    || value?.correlation_id !== value?.invocation_id
    || occurred == null || typeof occurred !== 'object'
    || !Array.isArray(value?.evidence_refs) || value.evidence_refs.length > 32) invalid()
  return { schema: value.schema, eventId: token(value.event_id),
    eventType: value.event_type,
    occurredTime: { startEpochMs: revision(occurred.start_epoch_ms),
      endEpochMs: occurred.end_epoch_ms == null ? null : revision(occurred.end_epoch_ms) },
    observedAtEpochMs: revision(value.observed_at_epoch_ms),
    correlationId: subjectReference(value.correlation_id),
    causationId: value.causation_id == null ? null : subjectReference(value.causation_id),
    invocationId: token(value.invocation_id), operationId: vocabularyId(value.operation_id),
    previousRevision: revision(value.previous_revision),
    nextRevision: revision(value.next_revision),
    evidenceRefs: value.evidence_refs.map(item => ({ ownerId: token(item?.owner_id),
      reference: subjectReference(item?.reference), digestSha256: digest(item?.digest_sha256) })) }
}

function projectResult(value, invocationId) {
  if (value?.schema !== 'hathq://hat/action-result/v1'
    || token(value?.invocation_id) !== invocationId
    || !Array.isArray(value?.evidence_refs) || value.evidence_refs.length > 256) invalid()
  const outcome = text(value.outcome, 32)
  if (!['completed', 'failed', 'denied', 'cancelled'].includes(outcome)) invalid()
  return { operationId: vocabularyId(value.operation_id),
    stateRevision: revision(value.state_revision),
    projectionRevision: revision(value.projection_revision), outcome,
    reasonId: optionalSchemaId(value.reason_id),
    output: value.output == null ? null : projectActionReference(value.output),
    evidenceRefs: value.evidence_refs.map(projectEvidence) }
}

function projectActionReference(value) {
  return { ownerId: token(value?.owner_id), reference: subjectReference(value?.reference),
    schemaId: schemaId(value?.schema_id), digestSha256: digest(value?.digest_sha256) }
}
function projectEvidence(value) {
  return { ownerId: token(value?.owner_id), reference: subjectReference(value?.reference),
    digestSha256: digest(value?.digest_sha256) }
}

function document(value) {
  const result = text(value, 1_048_576)
  try { JSON.parse(result) } catch { invalid() }
  return result
}
function parseDocument(value) {
  const result = text(value, 1_048_576)
  try { return JSON.parse(result) } catch { invalid() }
}
function boundedArray(value, max) {
  if (!Array.isArray(value) || value.length > max) invalid()
  return value
}
function tokenList(value, max) { return boundedArray(value, max).map(token) }
function uniqueVocabularyIds(value, max) {
  const values = boundedArray(value, max).map(vocabularyId)
  if (!values.length || new Set(values).size !== values.length) invalid()
  return values
}
function uniqueRepositoryIds(value, max) {
  const values = boundedArray(value, max).map(repositoryId)
  if (new Set(values).size !== values.length) invalid()
  return values
}
function choiceList(value, choices, max) {
  return boundedArray(value, max).map(item => choice(item, choices))
}
function choice(value, choices) {
  const result = text(value, 64)
  if (!choices.includes(result)) invalid()
  return result
}
function exact(value, expected) {
  if (value !== expected) invalid()
  return expected
}
function token(value) {
  const result = text(value, 128)
  if (!TOKEN.test(result)) invalid()
  return result
}
function optionalToken(value) { return value == null ? null : token(value) }
function repositoryId(value) {
  const result = text(value, 128)
  if (!/^hat-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result)) invalid()
  return result
}
function packageId(value) {
  const result = text(value, 128)
  if (!/^hat\/[A-Za-z0-9][A-Za-z0-9._/-]{0,123}$/u.test(result)) invalid()
  return result
}
function subjectReference(value) {
  const result = text(value, 256)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(result)) invalid()
  return result
}
function vocabularyId(value) {
  const result = text(value, 256)
  if (!/^hathq:\/\/vocabulary\/[A-Za-z0-9._:/-]+$/u.test(result)) invalid()
  return result
}
function dataDomainTerm(value) {
  const result = vocabularyId(value)
  if (!/^hathq:\/\/vocabulary\/data-domain\/[a-z0-9][a-z0-9/-]*\/v[1-9][0-9]*$/u
    .test(result)) invalid()
  return result
}
function canonicalType(value) {
  const result = text(value, 128)
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u
    .test(result)) invalid()
  return result
}
function schemaId(value) {
  const result = text(value, 256)
  if (!/^hathq:\/\/[A-Za-z0-9._:/-]+$/u.test(result)) invalid()
  return result
}
function optionalSchemaId(value) { return value == null ? null : schemaId(value) }
function semanticIcon(value) {
  return value == null ? {} : { semanticIcon:
    vocabularyPresentation({ semanticIcon: value }).semanticIcon }
}
function digest(value) {
  const result = text(value, 64)
  if (!LOWER_HEX_32.test(result)) invalid()
  return result
}
function fixedHex(value, length) {
  const result = text(value, length)
  if (result.length !== length || !/^[0-9a-f]+$/u.test(result)) invalid()
  return result
}
function optionalRevision(value) { return value == null ? null : revision(value) }
function optionalInstant(value) { return value == null ? null : instant(value) }
function instant(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) invalid()
  return result
}
function revision(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) invalid()
  return result
}
function text(value, max) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > max) invalid()
  return value
}
function safe(value) { return assertSafeProjection(value) }
function invalid() { throw new Error('hatter-console-hat-input-invalid') }
