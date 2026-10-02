// Hatter application protocol adapter. Crowsi owns bytes and physical delivery.
import { LocalTransport, Budget, limitsFor, TransportError } from '@crowsi/transport-foundation'
import { managementFailureError } from './management-failure.mjs'

/** Carries bounded bidirectional app-server messages without retaining payload history. */
export class JsonlChannel {
  constructor(readable, writable, { timeoutMs = 10_000, maxLineBytes = 1024 * 1024,
    onNotification = () => {}, onServerRequest = () => {}, session,
    maxPendingMessages = 64, maxPendingBytes = 4 * (maxLineBytes + 2) } = {}) {
    this.timeoutMs = timeoutMs
    this.maxLineBytes = maxLineBytes
    this.onNotification = onNotification
    this.onServerRequest = onServerRequest
    const limits = limitsFor(maxLineBytes, { pendingMessages: maxPendingMessages, pendingBytes: maxPendingBytes })
    this.requests = new Budget(limits)
    this.nextId = 1
    this.pending = new Map()
    this.closed = false
    this.transport = new LocalTransport(readable, writable, { limits, session,
      onFrame: frame => {
        if (!frame.payload.length) return
        let line
        try { line = new TextDecoder('utf-8', { fatal: true }).decode(frame.payload) }
        catch { this.fail(transportFailure(new TransportError('MalformedFrame'))); return }
        this.receive(line)
      },
      onFailure: error => this.fail(transportFailure(error)) })
  }

  request(method, params, timeoutMs = this.timeoutMs, observe = () => {}) {
    let observation = Object.freeze({phase:'NotDispatched',requestRef:null})
    const record = (phase, requestRef) => {
      observation = Object.freeze({phase,requestRef})
      try { observe(observation) } catch {}
    }
    const rejected = error => Promise.reject(rpcFailure(error, observation))
    record('NotDispatched',null)
    if (this.closed) return rejected(transportFailure(new TransportError('ConnectionClosed')))
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      return rejected(new Error('hatter-app-server-timeout-invalid'))
    }
    if (!Number.isSafeInteger(this.nextId)) return rejected(transportFailure(new TransportError('SequenceExhausted')))
    let release
    try { release = this.requests.reserve(this.transport.limits.frame) }
    catch (error) { return rejected(transportFailure(error)) }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); release()
        reject(rpcFailure(transportFailure(new TransportError('Timeout')),observation))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject:error=>reject(rpcFailure(error,observation)), timer, release, record })
      // Entering the transport is not proof of delivery or of no mutation.
      // This local observation never retries, changes timers, or grants authority.
      record('PossiblyDispatched',id)
      this.transport.sendJson({ id, method, params }).catch(error => {
        const pending = this.pending.get(id)
        if (pending) { clearTimeout(timer); this.pending.delete(id); release(); pending.reject(transportFailure(error)) }
      })
    })
  }

  notify(method, params) { this.write({ method, params }) }
  respond(id, result) { this.write({ id, result }) }
  reject(id) {
    this.write({ id, error: { code: -32601, message: 'Request is not available.' } })
  }

  consume(chunk) {
    if (!this.closed) this.transport.listeners.data(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  receive(line) {
    let value
    try { value = JSON.parse(line) } catch {
      this.fail(transportFailure(new TransportError('MalformedFrame'))); return
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    if ('id' in value && ('result' in value || 'error' in value)) {
      if (value.id === null && value.error?.data?.parameters?.transport) {
        this.fail(managementFailureError(value.error)); return
      }
      const pending = this.pending.get(value.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(value.id)
      pending.release()
      pending.record('OwnerResponded',value.id)
      if ('error' in value) pending.reject(managementFailureError(value.error))
      else pending.resolve(value.result)
    } else if ('id' in value && typeof value.method === 'string') {
      this.onServerRequest(value)
    } else if (typeof value.method === 'string') this.onNotification(value)
  }

  write(value) {
    if (this.closed) throw transportFailure(new TransportError('ConnectionClosed'))
    this.transport.sendJson(value).catch(error => this.fail(transportFailure(error)))
  }

  fail(code) {
    if (this.closed) return
    this.closed = true
    const failure = code instanceof Error ? code : transportFailure(new TransportError('ConnectionClosed'))
    if (typeof code === 'string') failure.message = code
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer); pending.release(); pending.reject(failure)
    }
    this.pending.clear()
    this.transport?.close()
  }
}

// Error observations are per request: a shared channel failure must not acquire
// the ID of the first pending request. No request body/history is retained.
export function rpcFailure(error, observation) {
  const result = new Error(error.message, {cause:error})
  if(error.failure)Object.defineProperty(result,'failure',{value:error.failure})
  if(error.code)Object.defineProperty(result,'code',{value:error.code})
  Object.defineProperty(result,'rpc',{value:Object.freeze({...observation})})
  return result
}

export function transportFailure(error) {
  const outcome = error instanceof TransportError ? error.outcome : 'ProtocolViolation'
  const applicationParse = ['ProtocolViolation','MalformedFrame'].includes(outcome)
  const code = {InputTooLarge:'hatter-app-server-message-too-large', FrameTooLarge:'hatter-app-server-message-too-large',
    Backpressure:'hatter-app-server-backpressure', ConnectionClosed:'hatter-app-server-unavailable',
    ConnectionFailed:'hatter-app-server-unavailable', ProtocolViolation:'hatter-app-server-protocol-invalid',
    MalformedFrame:'hatter-app-server-protocol-invalid', Timeout:'hatter-app-server-timeout',
    SequenceExhausted:'hatter-app-server-sequence-exhausted'}[outcome]
  const result = new Error(code, { cause: error })
  Object.defineProperty(result, 'failure', { value: { code:'management-transport-failed',
    reasonId:'hathq://vocabulary/reason/operation-rejected/v1', class: outcome === 'Timeout' ? 'timeout'
      : ['InputTooLarge','FrameTooLarge','Backpressure','SequenceExhausted'].includes(outcome) ? 'limit'
        : applicationParse ? 'input' : 'availability',
    recovery:'none', responsibility:applicationParse ? 'hatter' : 'external-service', operation:'management/request',
    parameters:{transport:outcome,component:applicationParse ? 'hatter' : 'crowsi'},nextActionId:null } })
  return result
}
