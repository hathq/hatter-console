# Console lightweight build policy

Hatter Console is a local control and observation surface, not an application runtime for HATs,
models, databases, telemetry exporters, media processors, provider-auth adapters or browser
automation. Those implementations remain behind Hatter, installed HAT, Zixcel or Crowsi contracts.
Console therefore admits only reviewed presentation and loopback HTTP dependencies directly.

`build-policy.json` is the executable policy. It fixes the exact direct dependency boundary and
rejects database, telemetry, container, browser-engine, image-processing and model-runtime packages.
Changing that list is an architecture decision rather than an incidental package installation.

The production build must also satisfy independent budgets for the complete `.output` tree, the
server tree, aggregate client JavaScript and CSS, the largest client JavaScript chunk, file count,
source maps and emitted `node_modules`. `pnpm build`, release staging and
`scripts/verify-build-budget.mjs` all apply the same verifier. Development-only packages and the
pnpm store are never release inputs.

The 2026-09-01 baseline before removing source maps was 10,099,604 bytes across 482 files:
8,437,962 server bytes, 1,402,918 client JavaScript bytes and 258,314 client CSS bytes. Generated
source maps alone accounted for 1,886,267 bytes. Release source maps are now forbidden; detailed
diagnostics remain a development artifact.

After removing release maps, the server-side icon collection, seven superseded provider-specific
HTTP routes and the remaining packaged GitHub auth adapter, the measured output is 7,218,408 bytes
across 264 files: 5,546,149 server bytes, 1,409,413 client JavaScript bytes and 262,436 client CSS
bytes. This remains below the audited baseline without changing the user-visible icon set or the
provider-neutral connection surface.

The largest retained costs are intentional:

- Native bounded DOM/CSS delivery provides the application shell.
- HATs provide declared data and inputs, never executable presentation code.
- the Lucide collection is scanned and reduced to icons referenced by the application; no icon
  collection or remote Iconify provider is emitted into the server.
- provider-specific adapters are forbidden as direct Console dependencies; they must enter through
  installed HAT declarations and externally owned packages.

An increase must first be assigned to the owning ecosystem service. Raise a byte budget only when a
measured product requirement cannot be represented through the existing declarative contracts.
