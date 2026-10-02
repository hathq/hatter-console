// Modified by the Hatter downstream project, 2026.
// Purpose: include profile and schema-graph methods in the bounded Console runtime.
import { DiagnosticStore } from '../lib/diagnostic-store.mjs'
import { ProductProjections } from './product-projections.mjs'
import { ProductPublication } from './product-publication.mjs'
import { OpaqueHandles } from '../lib/opaque-handles.mjs'
import { assertSafeProjection, projectAccount } from '../lib/projection.mjs'
import { InvalidationBuffer } from '../lib/invalidation-buffer.mjs'
import { loginParameters } from '../lib/rpc-policy.mjs'
import {
  projectLogin, projectModelProviders, projectModels, projectRuntimeStatus, projectUsage
} from '../lib/runtime-projection.mjs'
import { ManagementConnection } from '../lib/management-connection.mjs'
import {
  bindingReadParameters, activationWriteParameters, capabilityListParameters,
  compositionApproveParameters, compositionPrepareParameters, compositionReadParameters,
  installIpParameters, installLocalParameters,
  invocationControlParameters, invocationListParameters, invocationReadParameters,
  invocationWriteParameters,
  packageReadParameters, projectActivation, projectCapabilities, projectCatalogPackagePreview,
  projectComposition, projectCompositionPreview, projectInstallation, projectInvocation,
  projectInvocationList,
  projectContinuity, projectInformationSurfaces, projectPackageDetails,
  projectServiceRequirements, projectSetupTasks,
  placementReadParameters, placementSelectParameters, projectLease, projectPlacement,
  projectPlacementCandidates, projectProjectionJournal, projectWorker,
  setupCompleteParameters,
  projectionJournalReadParameters, workerClaimParameters, workerReadParameters,
  workerResultParameters, workerStatusParameters, workerUnregisterParameters
} from '../lib/hat-package-projection.mjs'
import {
  profileReadParameters, profileScope, profileWriteParameters, projectProfileEntries,
  projectProfileEntry, projectProfileForms, projectSchemaGraph
} from '../lib/profile-projection.mjs'
import { projectHatDiscovery, unavailableHatDiscovery } from '../lib/hat-discovery-projection.mjs'
import { catalogSourceSelectParameters, catalogSourceWriteParameters,
  projectCatalogSources } from '../lib/hat-catalog-source-projection.mjs'
import { projectInstance } from '../lib/instance-projection.mjs'
import { digitalTwinReadParameters } from '../lib/digital-twin-projection.mjs'
import { projectSemanticViews } from '../lib/semantic-views-projection.mjs'
import { roleMemory } from '../../shared/role-memory.mjs'
import { modelRouteRemoveParameters, modelRouteWriteParameters,
  projectModelRoutes, projectModelRoutePublication } from '../lib/model-route-projection.mjs'
import { projectCodexTrace } from '../lib/codex-trace-projection.mjs'
import { projectInferenceEngineStatus } from '../lib/inference-engine-status-projection.mjs'
import { failureFromError } from '../lib/management-failure.mjs'
import { rpcFailure } from '../lib/jsonl-channel.mjs'
import { actionPlanApproveParameters, actionPlanWriteParameters,
  projectActionPlanRegistry } from '../lib/action-plan-projection.mjs'

/** Exposes Hatter-owned state through bounded owner-browser projections. */
export class HatterRuntime {
  workRead = null
  capabilityRead = null
  statusRead = null
  closed = false
  closePromise = null
  constructor({ environment = process.env, diagnosticsStore = new DiagnosticStore(), onStartupStage = ()=>{} } = {}) {
    this.projectionEnvironment = { ...environment }
    this.projections = null
    this.handles = new OpaqueHandles()
    this.invalidationBuffer = new InvalidationBuffer()
    this.diagnosticsStore = diagnosticsStore
    this.startupStage=stage=>{try{onStartupStage(stage)}catch{}}
    this.activeLogin = null
    this.management = new ManagementConnection({ environment,
      onNotification: value => this.notification(value),
      onServerRequest: (value, channel) => this.rejectServerRequest(value, channel),
      onExit: () => this.exited() })
  }

  async rpc(method, params = {}, timeoutMs = undefined, observe = () => {}) {
    let observation=Object.freeze({phase:'NotDispatched',requestRef:null})
    const record=value=>{observation=value;try{observe(value)}catch{}}
    record(observation)
    if(this.closed)throw rpcFailure(Object.assign(Error('ProjectionRuntimeClosed'),{code:'ProjectionRuntimeClosed'}),observation)
    try {
      const channel = await this.management.start()
      return await channel.request(method, params, timeoutMs, record)
    } catch (error) {
      // Preserve the typed transport owner outcome through the existing diagnostics
      // interface; an unavailable stream is not a semantic NeedsResolution.
      const failure = failureFromError(error)
      if (failure?.code === 'management-transport-failed') {
        const code = `hatter-console-${failure.code}`
        this.diagnosticsStore.record(code, 'error', rpcArea(method), failure)
        this.invalidationBuffer.publish('diagnostics')
        const projected = new Error(code)
        Object.defineProperty(projected, 'failure', { value: failure })
        throw rpcFailure(projected,error.rpc??observation)
      }
      if (error instanceof Error && error.message.startsWith('hatter-console-')) {
        this.diagnosticsStore.record(error.message, 'warning', rpcArea(method),
          failureFromError(error))
        this.invalidationBuffer.publish('diagnostics')
        throw rpcFailure(error,error.rpc??observation)
      }
      if (error instanceof Error && error.message === 'hatter-app-server-request-rejected') {
        this.diagnosticsStore.record('hatter-app-server-request-rejected', 'warning', rpcArea(method))
        this.invalidationBuffer.publish('diagnostics')
        throw rpcFailure(new Error('hatter-console-operation-rejected'),error.rpc??observation)
      }
      this.diagnosticsStore.record('hatter-app-server-request-failed', 'error', rpcArea(method))
      this.invalidationBuffer.publish('diagnostics')
      throw rpcFailure(new Error('hatter-console-runtime-unavailable'),error.rpc??observation)
    }
  }

  async overview() {
    // Concurrent document readers borrow one original status observation, not
    // one full response reservation each. Keep no completed-state cache; this
    // neither queues commands nor expands Crowsi's four-frame admission bound.
    this.statusRead ??= this.rpc('hatter/status/read').then(projectRuntimeStatus)
      .finally(()=>{this.statusRead=null})
    return this.statusRead
  }
  async worlds(operation='list',input={}) { return this.rpc('world/execute',{operation,...input}) }
  async runtimeRoles() { return this.rpc('inference/role/list', { maximumItems: 64 }) }
  async workObservation() {
    this.workRead ??= this.rpc('inference/execute',{operation:'scheduler'}).finally(()=>{this.workRead=null})
    return this.workRead
  }
  async roleMemory(roleRef) { return roleMemory(await this.rpc('inference/role/memory', { roleRef })) }
  async digitalTwinStatus() { return assertSafeProjection(
    await this.rpc('digital-twin/status/read')) }
  async digitalTwinFoundation() { return assertSafeProjection(
    await this.rpc('digital-twin/foundation/read')) }
  async representativeArchetypes() { return assertSafeProjection(
    await this.rpc('digital-twin/representative-archetype/read')) }
  async digitalTwinProjection(definition) { return assertSafeProjection(
    await this.rpc('digital-twin/projection/read', digitalTwinReadParameters(definition))) }
  async operationalRecords(kind, maximumItems = 256) {
    if (!['desired-state', 'goal', 'commitment', 'task', 'delegation', 'execution',
      'verification', 'intelligence-artifact', 'inference-action', 'representative-role',
      'matter', 'matter-contribution', 'automation-policy'].includes(kind)
      || !Number.isSafeInteger(maximumItems) || maximumItems < 1 || maximumItems > 1024) {
      throw new Error('hatter-console-operational-list-input-invalid')
    }
    return assertSafeProjection(await this.rpc('digital-twin/operational/list', {
      kind, maximumItems
    }))
  }
  async runnableTasks(observedAtEpochS, maximumItems = 256) {
    if (!Number.isSafeInteger(observedAtEpochS) || observedAtEpochS < 1
      || !Number.isSafeInteger(maximumItems) || maximumItems < 1 || maximumItems > 256) {
      throw new Error('hatter-console-operational-wakeup-input-invalid')
    }
    return assertSafeProjection(await this.rpc('digital-twin/task/runnable', {
      observedAtEpochS, maximumItems
    }))
  }
  async instance() { return projectInstance(await this.rpc('instance/read')) }
  async installHatLocal(input) {
    const result = projectInstallation(await this.rpc(
      'hat/package/install-local', installLocalParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async installHatIp(input) {
    const result = projectInstallation(await this.rpc(
      'hat/package/install-ip', installIpParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async officialHatCatalog(locale = 'en') {
    return projectHatDiscovery(await this.rpc('hat/catalog/list', {
      locale: locale === 'ja' ? 'ja' : 'en' }))
  }
  async availableHatCatalog(locale = 'en') {
    try { return await this.officialHatCatalog(locale) }
    catch { return unavailableHatDiscovery() }
  }
  async catalogSources() {
    return projectCatalogSources(await this.rpc('hat/catalog-source/list'))
  }
  async writeCatalogSource(input) {
    const result = projectCatalogSources(await this.rpc(
      'hat/catalog-source/write', catalogSourceWriteParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async selectCatalogSource(input) {
    const result = projectCatalogSources(await this.rpc(
      'hat/catalog-source/select', catalogSourceSelectParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async installOfficialHat(input) {
    const repositoryId = typeof input?.repositoryId === 'string' ? input.repositoryId : ''
    if (!/^hat-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(repositoryId)) {
      throw new Error('hatter-console-hat-input-invalid')
    }
    const result = projectInstallation(await this.rpc(
      'hat/catalog/install', { repositoryId }))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async previewCatalogHat(input) {
    return projectCatalogPackagePreview(await this.rpc(
      'hat/catalog/package-preview', packageReadParameters(input)))
  }
  async hatPackage(input) {
    return projectPackageDetails(await this.rpc(
      'hat/package/read', packageReadParameters(input)))
  }
  async hatCapabilities(input = {}) {
    const params = capabilityListParameters(input), key = JSON.stringify(params)
    // Navigation and capability utilities request the same owner observation
    // concurrently. Share only that in-flight read, never cache a completed state
    // or enlarge Crowsi's four-frame response reservation.
    if (this.capabilityRead?.key === key) return this.capabilityRead.promise
    const pending = { key, promise: this.rpc('hat/capability/list', params).then(projectCapabilities) }
    this.capabilityRead = pending
    try { return await pending.promise }
    finally { if (this.capabilityRead === pending) this.capabilityRead = null }
  }
  async actionPlans() {
    return projectActionPlanRegistry(await this.rpc('hat/action-plan/list'))
  }
  async writeActionPlan(input) {
    const result = projectActionPlanRegistry(await this.rpc(
      'hat/action-plan/write', actionPlanWriteParameters(input)))
    this.invalidationBuffer.publish('action-plans')
    return result
  }
  async approveActionPlan(input) {
    const result = projectActionPlanRegistry(await this.rpc(
      'hat/action-plan/approve', actionPlanApproveParameters(input)))
    this.invalidationBuffer.publish('action-plans')
    return result
  }
  async hatContinuity() {
    return projectContinuity(await this.rpc('hat/continuity/read'))
  }
  async hatInformationSurfaces(input = {}) {
    return projectInformationSurfaces(await this.rpc(
      'hat/information-surface/list', capabilityListParameters(input)))
  }
  async hatServiceRequirements(input = {}) {
    return projectServiceRequirements(await this.rpc(
      'hat/service-requirement/list', capabilityListParameters(input)))
  }
  async hatSetupTasks() {
    return projectSetupTasks(await this.rpc('hat/setup/list'))
  }
  async completeHatSetup(input) {
    const result = assertSafeProjection(await this.rpc(
      'hat/setup/complete', setupCompleteParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async writeHatActivation(input) {
    const result = assertSafeProjection(await this.rpc(
      'hat/activation/write', activationWriteParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async hatActivation(input) {
    return projectActivation(await this.rpc(
      'hat/activation/read', bindingReadParameters(input)))
  }
  async repairHatActivation(input) {
    const result = assertSafeProjection(await this.rpc(
      'hat/activation/repair', activationWriteParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async inspectHatActivation(input) {
    return assertSafeProjection(await this.rpc(
      'hat/activation/projection', activationWriteParameters(input)))
  }
  async prepareHatComposition(input) {
    return projectCompositionPreview(await this.rpc(
      'hat/composition/prepare', compositionPrepareParameters(input)))
  }
  async approveHatComposition(input) {
    const result = assertSafeProjection(await this.rpc(
      'hat/composition/approve', compositionApproveParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async hatComposition(input) {
    return projectComposition(await this.rpc(
      'hat/composition/read', compositionReadParameters(input)))
  }
  async hatPlacement(input) {
    return projectPlacement(await this.rpc(
      'hat/placement/read', placementReadParameters(input)))
  }
  async hatPlacementCandidates(input) {
    return projectPlacementCandidates(await this.rpc(
      'hat/placement/list', placementReadParameters(input)))
  }
  async allHatPlacementCandidates() {
    return projectPlacementCandidates(await this.rpc('hat/placement/list-all', {}))
  }
  async selectHatPlacement(input) {
    const result = projectPlacement(await this.rpc(
      'hat/placement/select', placementSelectParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async hatProjectionJournal(input) {
    return projectProjectionJournal(await this.rpc(
      'hat/projection-journal/read', projectionJournalReadParameters(input)))
  }
  async invokeHat(input) {
    const result = projectInvocation(await this.rpc(
      'hat/invocation/invoke', invocationWriteParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async hatInvocation(input) {
    return projectInvocation(await this.rpc(
      'hat/invocation/read', invocationReadParameters(input)))
  }
  async hatInvocations(input) {
    return projectInvocationList(await this.rpc(
      'hat/invocation/list', invocationListParameters(input)))
  }
  async controlHatInvocation(input, kind) {
    const result = projectInvocation(await this.rpc(
      'hat/invocation/control', invocationControlParameters(input, kind)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async claimHatInvocation(input) {
    return projectLease(await this.rpc('hat/worker/claim', workerClaimParameters(input)))
  }
  async hatWorker(input) {
    return projectWorker(await this.rpc('hat/worker/read', workerReadParameters(input)))
  }
  async unregisterHatWorker(input) {
    const result = projectWorker(await this.rpc(
      'hat/worker/unregister', workerUnregisterParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async updateHatInvocationStatus(input) {
    return projectInvocation(await this.rpc(
      'hat/worker/status', workerStatusParameters(input)))
  }
  async completeHatInvocation(input) {
    const result = projectInvocation(await this.rpc(
      'hat/worker/complete', workerResultParameters(input)))
    this.invalidationBuffer.publish('hats')
    return result
  }
  async profileForms() {
    return projectProfileForms(await this.rpc('profile/form/list'))
  }
  async semanticViews() { return projectSemanticViews(await this.rpc('profile/dictionary/read')) }
  async profileEntries(input = {}) {
    return projectProfileEntries(await this.rpc('profile/entry/list', profileScope(input)))
  }
  async profileEntry(input) {
    return projectProfileEntry(await this.rpc('profile/entry/read', profileReadParameters(input)))
  }
  async writeProfileEntry(input) {
    const result = projectProfileEntry(await this.rpc(
      'profile/entry/write', profileWriteParameters(input)))
    this.invalidationBuffer.publish('profile')
    return result
  }
  async schemaGraph(input = {}) {
    return projectSchemaGraph(await this.rpc('schema/graph/read', {}))
  }
  async account() {
    const account = projectAccount(await this.rpc('account/read', { refreshToken: false }))
    if (account.state === 'authenticated') this.activeLogin = null
    return assertSafeProjection({ ...account, login: this.activeLogin })
  }
  async models(input) { return projectModels(await this.rpc('model/list', {
    providerId: input.providerId, cursor: input.cursor ?? null, limit: 100, includeHidden: false })) }
  async refreshModels(input) {
    const result = projectModels(await this.rpc('model/refresh', {
      providerId: input.providerId, cursor: null, limit: 100, includeHidden: false }))
    this.invalidationBuffer.publish('models')
    return result
  }
  async modelProviders() {
    return projectModelProviders(await this.rpc('model/provider/list'))
  }
  async modelRoutes() {
    return projectModelRoutes(await this.rpc('model/route/list'))
  }
  async writeModelRoute(input) {
    const result = projectModelRoutePublication(await this.rpc(
      'model/route/write', modelRouteWriteParameters(input)))
    this.invalidationBuffer.publish('models')
    return result
  }
  async removeModelRoute(input) {
    const result = projectModelRoutes(await this.rpc(
      'model/route/remove', modelRouteRemoveParameters(input)))
    this.invalidationBuffer.publish('models')
    return result
  }

  async usage() {
    const [rate, usage] = await Promise.all([
      this.available('account/rateLimits/read'), this.available('account/usage/read')])
    return projectUsage(rate, usage)
  }

  async beginLogin(flow) {
    if (this.activeLogin?.flow === flow) return this.activeLogin
    if (this.activeLogin) throw new Error('hatter-console-login-in-progress')
    this.activeLogin = projectLogin(
      await this.rpc('account/login/start', loginParameters(flow)), this.handles)
    this.invalidationBuffer.publish('account')
    return this.activeLogin
  }
  async cancelLogin(handle) {
    if (!this.activeLogin || this.activeLogin.handle !== handle) {
      throw new Error('hatter-console-login-handle-invalid')
    }
    await this.rpc('account/login/cancel', {
      loginId: this.handles.resolve('login', handle) })
    this.activeLogin = null
    this.invalidationBuffer.publish('account')
    return { cancelled: true }
  }
  async selectAccount(handle) {
    await this.rpc('account/select', { handle: accountHandle(handle) })
    this.invalidationBuffer.publish('account')
    return { selected: true }
  }
  async removeAccount(handle) {
    await this.rpc('account/remove', { handle: accountHandle(handle) })
    this.invalidationBuffer.publish('account')
    return { removed: true }
  }
  async logout() {
    await this.rpc('account/logout')
    this.activeLogin = null
    this.invalidationBuffer.publish('account')
    return { signedOut: true }
  }
  diagnostics() { return { schema: 'hathq://hatter-console/diagnostics/v1',
    diagnostics: this.diagnosticsStore.list() } }
  recordDiagnostic(code, severity = 'warning', area = 'runtime') {
    this.diagnosticsStore.record(code, severity, area)
    this.invalidationBuffer.publish('diagnostics')
  }
  async codexTrace() {
    return projectCodexTrace(await this.rpc('runtime/codex-trace/read'))
  }
  async inferenceEngineStatus() {
    return projectInferenceEngineStatus(await this.rpc('inference/status/read'))
  }
  async localRuntimeRegistry(command) {
    return assertSafeProjection(await this.rpc('model/runtime/execute', command, 35_000), { relativeAssetPaths: true })
  }
  async startProjections() {
    if(this.closed)throw Object.assign(Error('ProjectionRuntimeClosed'),{code:'ProjectionRuntimeClosed'})
    this.projectionStartup ??= (async()=>{
      try {
        this.projections ??= new ProductProjections(this.projectionEnvironment,{connection:this.management,onObservation:value=>this.diagnosticsStore.recordObservation(value)})
        // Load minimal trigger metadata before PP retries need an exact producer
        // definition. Startup remains explicit, never a read/GET side effect.
        this.publication ??= new ProductPublication(this.projections,this.projectionEnvironment.HATTER_HOME)
        this.startupStage('ProducerRecoveryStart')
        const result=await this.projections.startup()
        this.startupStage('ProducerRecoveryReady')
        this.startupStage('PublicationReconcileStart')
        await this.publication.reconcile()
        this.startupStage('PublicationReconcileReady')
        this.publication.start(error=>this.diagnosticsStore.record('hatter-console-projection-publication-failed','error','runtime',failureFromError(error)))
        return result
      } catch (error) {
        this.diagnosticsStore.record('hatter-console-projection-startup-failed', 'error', 'runtime', failureFromError(error))
        throw error
      }
    })().finally(() => { this.projectionStartup = null })
    return this.projectionStartup
  }
  close() {
    if(this.closePromise)return this.closePromise
    this.closed=true
    // D1: release pending management calls before joining startup/publication
    // which can be awaiting those calls. Never restart this disposed runtime.
    // Only this observer connection is closed; Management and external work stay owned by the product root.
    this.closePromise=Promise.resolve().then(async()=>{
      const management=Promise.resolve().then(()=>this.management.close())
      const projections=(async()=>{
        if(this.projectionStartup)await this.projectionStartup.catch(()=>{})
        try { await this.publication?.close() } finally { await this.projections?.close() }
      })()
      const results=await Promise.allSettled([management,projections])
      const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason)
      if(failures.length)throw new AggregateError(failures,'Hatter runtime shutdown failed')
    })
    return this.closePromise
  }

  async available(method) {
    try { return { state: 'available', value: await this.rpc(method) } }
    catch { return { state: 'unavailable', value: null } }
  }

  notification(value) {
    const method = typeof value?.method === 'string' ? value.method : ''
    if (['account/updated', 'account/login/completed'].includes(method)) {
      if (method === 'account/login/completed') this.activeLogin = null
      this.invalidationBuffer.publish('account')
    } else if (method === 'account/rateLimits/updated') this.invalidationBuffer.publish('models')
    else if (['model/rerouted', 'model/verification',
      'model/safetyBuffering/updated'].includes(method)) this.invalidationBuffer.publish('models')
  }
  rejectServerRequest(value, channel) {
    channel.reject(value.id)
    this.diagnosticsStore.record('hatter-server-request-rejected', 'warning', 'runtime')
    this.invalidationBuffer.publish('diagnostics')
  }
  exited() {
    this.activeLogin = null
    this.diagnosticsStore.record('hatter-app-server-exited', 'error')
    this.invalidationBuffer.publish('diagnostics')
  }
}

function accountHandle(value) {
  if (typeof value !== 'string' || !/^account-[a-z0-9]{24,32}$/u.test(value)) {
    throw new Error('hatter-console-account-handle-invalid')
  }
  return value
}

function rpcArea(method) {
  if (method.startsWith('hat/catalog')) return 'hat-catalog'
  if (method.startsWith('hat/')) return 'hat-runtime'
  if (method.startsWith('account/')) return 'account'
  if (method.startsWith('model/')) return 'models'
  if (method.startsWith('profile/') || method.startsWith('schema/')) return 'profile'
  if (method.startsWith('digital-twin/')) return 'digital-twin'
  if (method.startsWith('runtime/')) return 'codex-runtime'
  if (method.startsWith('instance/')) return 'instance'
  return 'runtime'
}
