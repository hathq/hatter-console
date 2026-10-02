// Modified by Hatter, 2026: bounded, non-evicting process-local identities.
import { createHmac, randomBytes } from 'node:crypto'

/** Prevents runtime identifiers from becoming browser route identifiers. */
export class OpaqueHandles {
  constructor(secret = randomBytes(32)) {
    if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error('handle-secret-invalid')
    this.secret = secret
    this.rawByHandle = new Map()
    this.handleByRaw = new Map()
  }

  issue(namespace, raw) {
    if (!/^[a-z][a-z-]{1,31}$/u.test(namespace)
      || typeof raw !== 'string' || !raw || raw.length > 512) {
      throw new Error('handle-input-invalid')
    }
    const key = `${namespace}\0${raw}`
    let handle = this.handleByRaw.get(key)
    if (!handle) {
      // Never evict a live route identity or silently alias a new raw object.
      if (this.rawByHandle.size >= 4096) throw Object.assign(new Error('handle-capacity-exceeded'), { code: 'ProjectionLimitExceeded' })
      const digest = createHmac('sha256', this.secret).update(key).digest('base64url')
      handle = `${namespace}_${digest.slice(0, 24)}`
      this.handleByRaw.set(key, handle)
      this.rawByHandle.set(handle, { namespace, raw })
    }
    return handle
  }

  resolve(namespace, handle) {
    const value = this.rawByHandle.get(handle)
    if (!value || value.namespace !== namespace) throw new Error('handle-not-found')
    return value.raw
  }
}
