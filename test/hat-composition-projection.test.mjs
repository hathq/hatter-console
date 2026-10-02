import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compositionPrepareParameters, projectCompositionPreview
} from '../server/lib/hat-package-projection.mjs'

const digest = 'a'.repeat(64)
const wireProposal = {
  schema: 'hathq://hat/composition-proposal/v1', proposal_id: 'proposal-1',
  subject_ref: 'subject-owner', scope_ref: 'scope-personal',
  expected_composition_revision: null, members: [{ repository_id: 'hat-example',
    package_id: 'hat/example', package_digest_sha256: digest,
    catalog_digest_sha256: digest, fitting_digest_sha256: digest,
    policy_digest_sha256: digest, expected_binding_revision: null,
    dependency_repository_ids: [], incompatible_repository_ids: [],
    operation_ids: ['hathq://vocabulary/action/example/v1'] }]
}
const projectedProposal = {
  schema: wireProposal.schema, proposalId: 'proposal-1', subjectRef: 'subject-owner',
  scopeRef: 'scope-personal', expectedCompositionRevision: null,
  members: [{ repositoryId: 'hat-example', packageId: 'hat/example',
    packageDigestSha256: digest, catalogDigestSha256: digest,
    fittingDigestSha256: digest, policyDigestSha256: digest,
    expectedBindingRevision: null, dependencyRepositoryIds: [],
    incompatibleRepositoryIds: [], operationIds: ['hathq://vocabulary/action/example/v1'] }]
}

test('prepares owner choices while catalog identity and relationships remain package-derived', () => {
  const value = compositionPrepareParameters({ proposalId: 'proposal-1',
    subjectRef: 'subject-owner', scopeRef: 'scope-personal', members: [{
      repositoryId: 'hat-example', fittingDigestSha256: digest,
      policyDigestSha256: digest }] })
  const parsed = JSON.parse(value.requestJson)
  assert.equal(parsed.members[0].repository_id, 'hat-example')
  assert.throws(() => compositionPrepareParameters({ ...parsed, members: [] }),
    /hat-input-invalid/u)
  assert.throws(() => compositionPrepareParameters({ proposalId: 'proposal-1',
    subjectRef: 'subject-owner', scopeRef: 'scope-personal', members: [{
      repositoryId: 'hat-example', fittingDigestSha256: digest, policyDigestSha256: digest,
      dependencyRepositoryIds: [] }] }), /hat-input-invalid/u)
})

test('keeps the approved wire proposal exact across the Console boundary', () => {
  const source = { preview: { proposal: projectedProposal,
    proposalDigestSha256: digest }, proposalJson: JSON.stringify(wireProposal) }
  const value = projectCompositionPreview(source)
  assert.equal(value.plan.proposalJson, source.proposalJson)
  assert.throws(() => projectCompositionPreview({ ...source,
    proposalJson: JSON.stringify({ ...wireProposal, scope_ref: 'scope-other' }) }),
  /hat-input-invalid/u)
})
