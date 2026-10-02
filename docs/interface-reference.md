# hatter-console interface reference

Use the [usage guide](getting-started.md) for the first steps. This reference preserves the current interface details and operational limits. Run command examples from the repository root, after preparing the exact declared dependencies and registered configuration.

## Actual startup boundary

```text
hatter (no arguments)
  → shared Supervisor / canonical owners
  → verified Node delivery helper
  → borrowed Management RPC / owner operations
```

This describes current code, not the finished multiprocess design. Canonical Graph/Semantic owners are separate product children. Do not open their
DB/Repository in an additional process.
Product-level architecture and acceptance are maintained by the consuming Hatter project. This repository owns its declared delivery interfaces and local verification; source verification does not establish complete product acceptance.

The launcher validates the exact CLI digest and Node executable, binds
`http://localhost:4213/`, and advertises that URL only after its own readiness
probe succeeds. This proves transport readiness, not semantic data readiness.
Delivery failure/startup diagnostics remain on stderr; owner failures are
also available through the System projection.

A missing configured state directory is refused before listening. Explicit
`hatter state initialize` with the same `HATTER_HOME` prepares metadata only.
It does not install a HAT, create semantic definitions or produce user data.
Never use development-data replacement as a normal startup step.

## Current routes

| Route | Source and responsibility |
| --- | --- |
| `/` | Canonical Subject candidates and the selected projection |
| `/scenes` | Exact published Scene; declared source edit/confirmation |
| `/store` | External catalog observation and declared installation intent |
| `/models` | Provider catalog state and explicit refresh |
| `/system` | Derived publication state, diagnostics and explicit source-lease provisioning |

A missing/corrupt owner is not a valid empty result. The System provision
operation creates source-retention registries only after their canonical
prerequisites exist. It is not a complete first-use installer.

Source meaning remains in sem-lang. Hatter owns Role/Work/Grant orchestration.
ProjectionState, client PresentationState and renderer state are separate.
HAT input declarations never inject executable HTML, Vue or browser routes.
Provider credentials and inference execution are not owned by the renderer.

## Spatial operation and live state

The root displays adopted people as selectable objects with exact representative
labels. The initial world offers an Open people control; the in-space directory
selects a person, and their conversation presents published questions and
confirmations before record browsing. The source may publish no questions.
Person-linked records remain inside that person's Information view and open
bounded Details on demand, not as a cloud of duplicate world objects. Edge
controls open the menu and view settings; the connection indicator opens
notifications. System data retains exact owner diagnostics. An empty state
shows the missing setup state without inventing roles or personal information;
adding a HAT is not a substitute for first-use definition adoption and Role
binding.

CLI canonical source admission is reconciled by the existing bounded publisher.
Crowsi STATE delivers changed projections and current directory/configuration
observations. There is no browser polling loop. A configuration revision change
invalidates stale forms; unchanged declarations preserve input. External catalog
verification is not run on every realtime tick: it follows an explicit read or
an observed local source-configuration revision change.

`test/spatial-cli-acceptance.mjs` is an opt-in, real CLI/two-browser scenario against
the isolated operator-created sample. It verifies exact values, replay, settings
choices, mobile layout and no document reload. It is not a full installation,
HAT execution or all-producer acceptance claim.

## Focused validation

```sh
pnpm build
node --test test/launcher.test.mjs test/handoff.test.mjs test/delivery-owner-boundary.test.mjs
```

The compound Rust test
`installed_input_provider_browser_structural_apply` prepares isolated canonical
state and a real signed external input HAT. The current native `write` browser journey starts
the actual no-argument `hatter` command, edits a declared field, checks the exact
canonical receipt and all rendered values, reconnects Crowsi, restarts the
application, and checks that the same data remains without another mutation.
It also verifies observed child disposal. Retired Vue/browser modes are removed;
the current native fault matrix is separate. No mocked owner success establishes product acceptance.

The consuming product must supply configuration for its declared Cargo registries and retain exact command-journey acceptance evidence.
Final published-product acceptance, first-use completeness and MP-F1/MP-F2
closure must not be inferred from this prepared-state source scenario.
