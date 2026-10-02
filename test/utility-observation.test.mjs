import assert from 'node:assert/strict'
import test from 'node:test'
import { HatterRuntime } from '../server/runtime/hatter-runtime.mjs'

test('identical concurrent utility observations share only the in-flight owner read; failure and completion never become cached state', async () => {
  const runtime=Object.create(HatterRuntime.prototype),pending=[]
  runtime.rpc=(method,params)=>new Promise((resolve,reject)=>pending.push({method,params,resolve,reject}))
  const a=runtime.hatCapabilities(),b=runtime.hatCapabilities()
  assert.equal(pending.length,1);assert.equal(pending[0].method,'hat/capability/list')
  pending[0].resolve({capabilities:[]});assert.deepEqual(await a,await b)
  assert.equal(runtime.capabilityRead,null)
  const c=runtime.hatCapabilities();assert.equal(pending.length,2)
  pending[1].reject(Error('owner-unavailable'));await assert.rejects(c,/owner-unavailable/)
  const d=runtime.hatCapabilities(),e=runtime.hatCapabilities({repositoryId:'hat-source-curator'})
  await assert.rejects(e)
  assert.equal(pending.length,3,'unsupported selectors must be rejected before transport')
  pending[2].resolve({capabilities:[]});await d
  assert.equal(runtime.capabilityRead,null)
})
