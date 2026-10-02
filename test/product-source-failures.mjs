// Consume real Rust owner failure serialization, not a hand-written JS taxonomy.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {projectManagementFailure,managementFailureError,failureFromError} from '../server/lib/management-failure.mjs'
const failures=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
assert.ok(failures.length>=15)
const inventory=JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[2]),'pending-feedback-retention.json')))
for(const kind of ['missing','corrupt']){
  const failure=inventory[kind].error.data
  assert.equal(failure.parameters.sourceOwner,'hatter/admission')
  assert.equal(failure.parameters.sourceRetention,undefined)
  failures.push(failure)
}
for(const data of failures){
  const expected={...data};delete expected.schema
  const wire={code:-32000,message:data.code,data}
  assert.deepEqual(projectManagementFailure(wire),expected,JSON.stringify(data))
  assert.deepEqual(failureFromError(managementFailureError(wire)),expected)
}
process.stdout.write(JSON.stringify({status:'PASS',failures:failures.length,ownerKinds:failures.map(f=>f.parameters)})+'\n')
