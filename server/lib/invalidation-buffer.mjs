/** Retains only refetch notifications. This is neither durable state nor an event journal. */
export class InvalidationBuffer {
  constructor(capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity < 2 || capacity > 4096) {
      throw new Error('hatter-console-invalidation-capacity-invalid')
    }
    this.capacity = capacity
    this.revision = 0
    this.events = []
    this.listeners = new Set()
  }

  snapshot() {
    return { revision: this.revision,
      topics: [...new Set(this.events.map(value => value.topic))].sort() }
  }

  publish(topic) {
    if (!/^[a-z][a-z-]{1,31}$/u.test(topic)) {
      throw new Error('hatter-console-invalidation-topic-invalid')
    }
    const event = Object.freeze({ revision: ++this.revision, topic })
    this.events.push(event)
    if (this.events.length > this.capacity) this.events.shift()
    for (const listener of this.listeners) listener(event)
    return event
  }

  resume(afterRevision) {
    const after = Number(afterRevision)
    const oldest = this.events[0]?.revision ?? this.revision + 1
    const gap = Number.isSafeInteger(after) && after >= 0 && after < oldest - 1
    return { gap, revision: this.revision,
      events: gap ? [] : this.events.filter(value => value.revision > after) }
  }

  subscribe(listener) {
    if (this.listeners.size >= 32) throw new Error('hatter-console-invalidation-subscriber-limit')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
