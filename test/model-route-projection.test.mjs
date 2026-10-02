// Hatter downstream 2026: one compound UI contract scenario includes acceptance, identity, replay and rejection.
import assert from 'node:assert/strict'
import test from 'node:test'
import { modelRouteRemoveParameters, modelRouteWriteParameters, projectModelRoutes,
  projectModelRoutePublication } from '../server/lib/model-route-projection.mjs'
import { createPublicationIntent } from '../shared/commit-publication.mjs'
test('route controls and rich projections retain exact commit/account/HAT identity without numeric-CAS fallback', async () => {
  const empty={sequence:0,commit:null}, revision={sequence:1,commit:'a'.repeat(64)}
  const operationId='hathq://vocabulary/action/reconcile-ledger/v1'
  const input={routeId:'route-ledger',providerId:'openai',accountHandle:'account-'+'a'.repeat(24),
    modelId:'model-a',reasoningEffort:'low',serviceTier:null,repositoryId:'hat-accountant',operationId}
  const control=await createPublicationIntent('model/route/write',input,empty)
  assert.deepEqual(await createPublicationIntent('model/route/write',input,empty),control)
  assert.notDeepEqual(await createPublicationIntent('model/route/write',input,revision),control)
  assert.deepEqual(modelRouteWriteParameters({...input,control}),{...input,control})
  assert.deepEqual(modelRouteRemoveParameters({routeId:input.routeId,control}),{routeId:input.routeId,control})
  assert.throws(()=>modelRouteWriteParameters({...input,expectedRevision:0}),/control-reference-invalid/)
  const route={schema:'hathq://hatter/model-route/v1',route_id:input.routeId,provider_id:input.providerId,
    account_handle:input.accountHandle,model_id:input.modelId,reasoning_effort:input.reasoningEffort,service_tier:null,
    repository_id:input.repositoryId,operation_id:input.operationId,accepted_operation_id:control.operation_id}
  const registry=routes=>({registryJson:JSON.stringify({schema:'hathq://hatter/model-route-registry/v1',revision,routes})})
  const view=projectModelRoutes(registry([route]))
  assert.deepEqual(view.revision,revision)
  assert.equal(view.routes[0].acceptedOperationId,control.operation_id)
  assert.equal(view.routes[0].accountHandle,input.accountHandle)
  assert.equal(view.routes[0].operationId,operationId)
  assert.equal(projectModelRoutes(registry([{...route,account_handle:null,provider_id:'owner-runtime'}])).routes[0].accountHandle,null)
  const commit={domain:'hatter/package/control/models',operation_id:control.operation_id,commit_ref:revision.commit,
    prepared_ref:'b'.repeat(64),parent_refs:[],previous_revision:empty,committed_revision:revision,payload_digest:'c'.repeat(64)}
  const publication={publicationJson:JSON.stringify({commit,route})}
  const projected=projectModelRoutePublication(publication)
  assert.deepEqual(projected.commit,commit)
  assert.deepEqual(projected.route,view.routes[0])
  for(let i=0;i<100;i++) assert.deepEqual(projectModelRoutePublication(publication),projected)
  assert.equal(projectModelRoutePublication({publicationJson:JSON.stringify({commit,route:null})}).route,null)
  for (const value of [{...route,provider_id:'bad provider'},{...route,account_handle:'wrong'},
    {...route,operation_id:'free text'},{...route,accepted_operation_id:undefined}])
    assert.throws(()=>projectModelRoutes(registry([value])),/model-route-invalid/)
  assert.throws(()=>projectModelRoutes(registry([route,{...route,route_id:'duplicate'}])),/model-route-invalid/)
  assert.throws(()=>projectModelRoutePublication({publicationJson:JSON.stringify({commit})}),/model-route-invalid/)
  assert.throws(()=>projectModelRoutePublication({publicationJson:JSON.stringify({commit:{...commit,committed_revision:empty},route})}),/model-route-invalid/)
  assert.equal(JSON.stringify(projected).includes('credential'),false)
})
