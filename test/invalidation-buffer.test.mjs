import assert from 'node:assert/strict'
import test from 'node:test'
import { InvalidationBuffer } from '../server/lib/invalidation-buffer.mjs'

test('retains bounded refetch notifications without becoming a state journal', () => {
  const buffer = new InvalidationBuffer(2)
  assert.deepEqual(buffer.snapshot(), { revision: 0, topics: [] })
  assert.equal(buffer.publish('hats').revision, 1)
  assert.equal(buffer.publish('models').revision, 2)
  assert.deepEqual(buffer.resume(0).events.map(value => value.revision), [1, 2])
  buffer.publish('diagnostics')
  assert.equal(buffer.resume(0).gap, true)
  assert.equal(buffer.resume(2).events[0].revision, 3)
  assert.equal('payload' in buffer.resume(2).events[0], false)
})
