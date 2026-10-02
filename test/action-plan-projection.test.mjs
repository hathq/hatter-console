import assert from 'node:assert/strict'
import test from 'node:test'
import {
  actionPlanApproveParameters, actionPlanWriteParameters, projectActionPlanCatalog,
  projectActionPlanRegistry
} from '../server/lib/action-plan-projection.mjs'

const digest = 'a'.repeat(64)
const operation = 'hathq://vocabulary/action/review-source/v1'
const input = 'hathq://hat-source-curator/review-source-input/v1'
const output = 'hathq://hat-source-curator/review-source-output/v1'
const capability = { contextPartitionId: 'personal', repositoryId: 'hat-source-curator',
  packageId: 'hat/source-curator', packageSha256: digest, version: '1.0.0',
  operationId: operation, inputSchema: input, outputSchema: output,
  handlerKind: 'hat-service', handlerReference: 'source-curator-worker', state: 'available' }
const details = { installation: { repositoryId: 'hat-source-curator',
  packageId: 'hat/source-curator', packageSha256: digest, version: '1.0.0' },
descriptor: { manifestName: 'Source Curator', operations: [{ id: operation,
  inputSchema: input, outputSchema: output, handlerKind: 'hat-service', effects: [],
  procedure: { id: 'review-source-procedure', steps: [{ actionId: operation,
    inputSchema: input, outputSchema: output }] } }] } }

test('projects one selectable action interface including its internal procedure', () => {
  const catalog = projectActionPlanCatalog({ capabilities: { capabilities: [capability] },
    packages: [details] })
  assert.equal(catalog.actions.length, 1)
  assert.equal(catalog.actions[0].procedure.steps[0].actionId, operation)
  assert.equal(catalog.actions[0].state, 'available')
})

test('owner and inference proposals share one strict parameter shape', () => {
  const base = { planId: 'source-review', title: 'Review source', expectedRevision: 0,
    steps: [{ stepId: 'review', contextPartitionId: 'personal',
      repositoryId: 'hat-source-curator', packageSha256: digest, operationId: operation,
      inputSchema: input, outputSchema: output, dependsOn: [], inputFromStepId: null }] }
  assert.equal(actionPlanWriteParameters({ ...base, source: 'owner' }).source, 'owner')
  assert.equal(actionPlanWriteParameters({ ...base, source: 'inference' }).source, 'inference')
  assert.throws(() => actionPlanWriteParameters({ ...base, source: 'inference', approved: true }),
    /action-plan-input-invalid/u)
})

test('projects approval separately and rejects guessed plan state', () => {
  const registry = projectActionPlanRegistry({ registry: {
    schema: 'hathq://hatter/action-plan-registry/v1', revision: 1, plans: [{
      schema: 'hathq://hatter/action-plan/v1', planId: 'source-review', title: 'Review source',
      source: 'inference', acceptedRevision: 1, planDigestSha256: digest,
      steps: [{ stepId: 'review', contextPartitionId: 'personal',
        repositoryId: 'hat-source-curator', packageSha256: digest, operationId: operation,
        inputSchema: input, outputSchema: output, dependsOn: [], inputFromStepId: null }],
      approved: false, ownerDecisionId: null }] } })
  assert.equal(registry.plans[0].approved, false)
  assert.deepEqual(actionPlanApproveParameters({ planId: 'source-review', expectedRevision: 1,
    ownerDecisionId: 'owner-decision-1' }), { planId: 'source-review', expectedRevision: 1,
    ownerDecisionId: 'owner-decision-1' })
  assert.throws(() => projectActionPlanRegistry({ registry: { ...registry, plans: [{
    ...registry.plans[0], approved: true, ownerDecisionId: null }] } }),
  /action-plan-projection-invalid/u)
})
