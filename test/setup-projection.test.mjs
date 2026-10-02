import assert from 'node:assert/strict'
import test from 'node:test'
import { projectSetupTasks } from '../server/lib/hat-package-projection.mjs'

const task = { schema: 'hatter://hat/setup-task/v2',
  repositoryId: 'hat-github-operator', packageId: 'hat/github-operator',
  version: '1.1.0', packageSha256: 'a'.repeat(64), templateId: 'github-connection',
  title: 'GitHubとの接続を設定する', summary: 'Crowsi custodyへ分離します。',
  actionLabel: 'GitHub接続を設定', contextNamespace: 'github-connection',
  projectionSchema: 'hathq://hat-github-operator/connection/v1', revision: 0,
  projectionRef: null, status: 'unresolved' }

test('accepts the exact Hatter setup schema without widening general schema IDs', () => {
  const value = projectSetupTasks({ setupTasks: [task] })
  assert.equal(value.tasks[0].schema, 'hatter://hat/setup-task/v2')
  assert.equal(value.tasks[0].contextNamespace, 'github-connection')
})

test('rejects a substituted setup schema', () => {
  assert.throws(() => projectSetupTasks({ setupTasks: [{ ...task,
    schema: 'hatter://hat/setup-task/v1' }] }), /hat-input-invalid/u)
})

test('accepts exact provider-confirmed completion', () => {
  const value = projectSetupTasks({ setupTasks: [{ ...task, revision: 1,
    projectionRef: 'zixcel://github/connection-catalog/v1', status: 'completed' }] })
  assert.equal(value.tasks[0].status, 'completed')
  assert.equal(value.tasks[0].revision, 1)
})
