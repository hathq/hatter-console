<!-- Hatter downstream 2026: current delivery source boundary; not release acceptance. -->
# Console delivery architecture — 0.10.0

The Wonderland canonical architecture and active migration ledger govern this
repository. This page describes the current production build entrypoints, not
the retired Nuxt application or an assertion of completed D1–D3 acceptance.

## Ownership

The no-argument Hatter CLI composes the control Graph, admission Graph, Semantic
and Management owners using the shared Supervisor. It then launches one external
Node delivery helper. Console borrows the exact private Management endpoint.
Closing a browser or an RPC observer does not own or stop that service.

Meaning and restoration belong to sem-lang. Hatter owns Roles, grants and work
orchestration; Graph owns structural/revision persistence. Projection packages
derive exact-source Data/Scene state. Console presents those contracts and invokes
declared operations. It neither repairs canonical data on reads nor creates
meaning, identity, permissions or a second process registry.

## Current entrypoints

`delivery/server.mjs` and `delivery/client.mjs` build framework-neutral delivery.
The build rejects Nuxt, Vue and Nitro runtime inputs and enforces explicit byte
and dependency budgets. Package inputs remain exact local-registry archives.

- `/`: available Subject projections or original missing-prerequisite details.
- `/scenes`: selected exact projection and declared interactions.
- `/store`: externally owned catalog selection and exact package installation.
- `/models`: configured provider/model observation and explicit catalog refresh.
- `/system`: original owner observations, projection/publication status,
  bounded diagnostics and explicit storage/source-retention operations.

System displays `hatter/status/read` through the existing safe projector.
Canonical readiness and physical liveness remain distinct. Missing observations
are errors, not zero process counts. Provider configuration is not runtime
liveness. The old synthetic runtime-topology DTO/API/component is removed.

## Transport and updates

The local browser boundary uses the existing Crowsi security/connection
mechanism; it is not provider login or semantic authority. Mutations use the
same Management operations as CLI consumers. A missing reply is uncertain,
not authorization to replay an effect. Reconnection does not retarget an
accepted operation to a new owner identity.

The projection runtime publishes current exact snapshots through Crowsi STATE.
Canonical commit and derived publication readiness are independent; failures
retain the original owner and receipt information. Scene selection never
substitutes a current record for an unavailable exact revision.

## Acceptance limits

Explicit empty-store initialization has actual CLI/browser coverage; it creates
no semantic definitions or Role. Initial definition-package selection/adoption
and first Role binding remain unfinished. Test definitions are not product
onboarding data. Remaining old application surfaces are migration remnants, not
additional supported routes; their physical retirement requires replacement
coverage. Helpers, all execution classes, full producer fences, final browser
acceptance and immutable release inputs remain in the root migration plan.

`test/product-contract.test.mjs` distinguishes current delivery constraints from
retained, unmigrated view-source guards. Its source assertions are not browser
acceptance of those old views. `test:e2e` runs `test/product-root-browser.mjs`
against explicit current binaries selected by `HATTER_TEST_BINARY_DIRECTORY`;
it uses Playwright and isolated state, never an implicit installed executable.
