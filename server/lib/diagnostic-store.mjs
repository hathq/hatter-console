// Hatter R1: retain the already-bounded owner failure, not a lossy second taxonomy.
import {validateFailureParameters} from './management-failure.mjs'
import {AsyncLocalStorage} from 'node:async_hooks'
import {performance} from 'node:perf_hooks'
/** Records stable reason codes without retaining provider or process diagnostics. */
export class DiagnosticStore {
  constructor(capacity = 128, now = Date.now) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error('hatter-console-diagnostic-capacity-invalid')
    this.capacity = capacity
    this.now = now
    this.sequence = 0
    this.rows = []
    this.context = new AsyncLocalStorage()
    this.startupOrigin = performance.now()
    this.startupCount = 0
  }

  recordStartup(stage) {
    if(!startupStages.has(stage)||this.startupCount>=24)return null
    const observation={stage,elapsedMs:performance.now()-this.startupOrigin}
    this.record('hatter-console-startup-observed','info','runtime')
    this.rows.at(-1).startup={...observation};this.startupCount++
    return observation
  }

  record(code, severity = 'warning', area = 'runtime', failure = null) {
    if (!/^[a-z][a-z0-9-]{2,95}$/u.test(code)
      || !['info', 'warning', 'error'].includes(severity)
      || !/^[a-z][a-z-]{1,31}$/u.test(area)) return
    const semantic = semanticFailure(failure)
    if (!Number.isSafeInteger(this.sequence + 1)) throw new Error('hatter-console-diagnostic-sequence-exhausted')
    this.rows.push({ sequence: ++this.sequence, code, severity, area,
      observedAtUnixMs: this.now(), ...semantic })
    if (this.rows.length > this.capacity) this.rows.shift()
  }

  list() { return structuredClone(this.rows).reverse() }

  withOperation(requestRef, execute) {
    return this.context.run(uuid.test(requestRef??'')?{requestRef,started:performance.now()}:null, execute)
  }
  recordStage(stage) {
    const context=this.context.getStore()
    if(!context||!interactionStages.has(stage))return
    let row=this.rows.find(row=>row.observation?.requestRef===context.requestRef)
    if(!row){
      this.record('hatter-console-operation-observed','info','runtime')
      row=this.rows.at(-1);row.observation={requestRef:context.requestRef,sources:[],omittedSources:0,stages:[]}
    }
    row.observation.stages??=[]
    if(row.observation.stages.length<24){
      row.observation.stages.push({stage,elapsedMs:performance.now()-context.started})
      if(Buffer.byteLength(JSON.stringify(row.observation))>8192)row.observation.stages.pop()
    }
  }

  // Same bounded, non-authoritative store as owner failures. Drop malformed
  // observations before retention; never copy arbitrary errors or input bodies.
  recordObservation(value) {
    const observation = safeObservation(value)
    if (!observation) return
    const requestRef=observation.requestRef??this.context.getStore()?.requestRef
    if(observation.interaction&&!requestRef)return
    if(requestRef){
      const existing=this.rows.find(row=>row.observation?.requestRef===requestRef)
      const joined=existing?structuredClone(existing.observation):{requestRef,sources:[],omittedSources:0}
      if(observation.callRef){joined.sources.push(observation)}
      else Object.assign(joined,observation)
      while(joined.sources.length>4||Buffer.byteLength(JSON.stringify(joined))>8192){
        if(!joined.sources.length)return
        joined.sources.shift();joined.omittedSources++
      }
      if(existing){existing.observation=joined;return}
      this.record('hatter-console-operation-observed', 'info', 'runtime')
      this.rows.at(-1).observation=joined
      return
    }
    this.record('hatter-console-operation-observed', 'info', 'runtime')
    this.rows.at(-1).observation = observation
  }
}

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const digest = /^[a-f0-9]{64}$/u
const stages = new Set(['RequestAccepted','OwnerInitializationStart',
  'OwnerInitializationReady','RpcDispatchStart','RpcTransportEntered','OwnerResponseReady'])
const interactionStages=new Set(['RequestAccepted','SelectionStart','SelectionReady',
  'SceneActionValidationStart','SceneActionValidationReady','OwnerOperationStart','OwnerOperationSettled'])
const startupStages=new Set(['EntryStarted','HandoffStart','HandoffReady','SiteStart','SiteConstructed',
 'ProjectionsStart','ProjectionsReady','ProjectionsFailed','ProducerRecoveryStart','ProducerRecoveryReady',
 'PublicationReconcileStart','PublicationReconcileReady','ListenStart','SocketBound','ReadinessResponseFinished'])
const exactKeys = (value,keys) => value && Object.getPrototypeOf(value)===Object.prototype
  && Object.keys(value).every(key=>keys.includes(key))
function safeObservation(value) {
  if (!value || typeof value!=='object') return null
  let result
  if(value.kind==='interaction-context'){
    const text=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f]/u.test(value)
    const projection=value=>exactKeys(value,['key','revision'])&&text(value.key)&&/^pp:[a-f0-9]{64}$/u.test(value.revision??'')
    if(!exactKeys(value,['kind','sceneRef','dataProjectionRef','actionId','inputGeneration','inputContractRef','sourceRefs'])
      ||!projection(value.sceneRef)||!projection(value.dataProjectionRef)||!text(value.actionId)
      ||!text(value.inputGeneration)||!text(value.inputContractRef)
      ||!Array.isArray(value.sourceRefs)||value.sourceRefs.length>16
      ||!value.sourceRefs.every(source=>exactKeys(source,['owner','ref','revision','kind'])
        &&['owner','ref','revision','kind'].every(key=>text(source[key]))))return null
    result={interaction:{sceneRef:{...value.sceneRef},dataProjectionRef:{...value.dataProjectionRef},
      actionId:value.actionId,inputGeneration:value.inputGeneration,inputContractRef:value.inputContractRef,
      sourceRefs:value.sourceRefs.map(source=>({...source}))}}
  }else if (value.callRef) {
    if (!exactKeys(value,['callRef','method','operation','outcome','failedAt','rpc','stages']) || !uuid.test(value.callRef)
      || !(value.failedAt==null||stages.has(value.failedAt))
      || !['source/execute','interaction/execute'].includes(value.method)
      || ![null,'targets','operations','describe','sourceDescribe','sourceSubmit','acquire','read','release','provision','reconcile'].includes(value.operation)
      || typeof value.outcome!=='string' || !/^[A-Za-z][A-Za-z0-9-]{0,95}$/u.test(value.outcome)
      || !exactKeys(value.rpc,['phase','requestRef']) || !['NotDispatched','PossiblyDispatched','OwnerResponded'].includes(value.rpc.phase)
      || !(value.rpc.requestRef===null || Number.isSafeInteger(value.rpc.requestRef)&&value.rpc.requestRef>0)
      || !Array.isArray(value.stages) || value.stages.length>24) return null
    let previous=0
    for (const item of value.stages) {
      if (!exactKeys(item,['stage','elapsedMs']) || !stages.has(item.stage)
        || !Number.isFinite(item.elapsedMs) || item.elapsedMs<previous) return null
      previous=item.elapsedMs
    }
    result={...value,rpc:{...value.rpc},stages:value.stages.map(item=>({...item}))}
  } else {
    if (!exactKeys(value,['requestRef','owner','stage','receiptRef','operation','httpStatus','managementRequestRef'])
      || !uuid.test(value.requestRef??'')
      || !['hatter/delivery','hatter/control','hatter/semantic','hatter/catalog','hatter/models','hatter/projection'].includes(value.owner)
      || !['DELIVERY_REJECTED','NOT_DISPATCHED','OWNER_REJECTED','OUTCOME_UNCERTAIN','OWNER_COMMITTED','PUBLICATION_FAILED_AFTER_COMMIT'].includes(value.stage)
      || !(value.receiptRef===null||digest.test(value.receiptRef??''))
      || typeof value.operation!=='string' || value.operation.length>96 || !/^\/?[a-z][a-zA-Z0-9-]*(?:\/[a-z][a-zA-Z0-9-]*)+$/u.test(value.operation)
      || !(value.httpStatus===null||Number.isSafeInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)
      || !(value.managementRequestRef==null||Number.isSafeInteger(value.managementRequestRef)&&value.managementRequestRef>0)) return null
    result={...value}
  }
  return Buffer.byteLength(JSON.stringify(result))<=8192?result:null
}

function semanticFailure(value) {
  if (value == null) return { reasonId: null, class: null, recovery: null,
    responsibility: null, operation: null, parameters: {}, nextActionId: null }
  const reason = /^hathq:\/\/vocabulary\/reason\/[a-z0-9-]+\/v[1-9][0-9]*$/u
  const action = /^hathq:\/\/vocabulary\/action\/[a-z0-9-]+\/v[1-9][0-9]*$/u
  const operation = /^[a-z][a-z0-9-]*(?:\/[a-z][A-Za-z0-9-]*)+$/u
  const classes = ['input', 'precondition', 'authority', 'dependency', 'availability',
    'conflict', 'limit', 'timeout', 'cancelled', 'internal']
  const recoveries = ['none', 'owner-action', 'retry', 'external-change']
  const responsibilities = ['owner', 'hatter', 'hat', 'external-service']
  if (!reason.test(value.reasonId ?? '') || !classes.includes(value.class)
    || !recoveries.includes(value.recovery) || !responsibilities.includes(value.responsibility)
    || !operation.test(value.operation ?? '')
    || !(value.nextActionId == null || action.test(value.nextActionId))) return semanticFailure(null)
  const parameters = validateFailureParameters(value.parameters ?? {}) ? {...value.parameters} : {}
  return { reasonId: value.reasonId, class: value.class, recovery: value.recovery,
    responsibility: value.responsibility, operation: value.operation, parameters,
    nextActionId: value.nextActionId ?? null }
}
