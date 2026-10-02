# @hathq/hatter-console

Inspect Hatter state and submit declared interactions through a browser interface.

## What you can do

- View exact owner projections and readiness.
- Submit forms and actions tied to accepted source references.

## Current scope

Start through the verified Hatter launcher. Transport readiness is distinct from semantic-data readiness and product acceptance.

## Getting started

The manifest currently requires locally supplied package archives: `@hathq/delivery-server`, `@hathq/delivery-client`, `@hathq/delivery-contracts`, `@hathq/dom-renderer`, `@hathq/projection-contracts`, `@hathq/projection-client`, `@hathq/projection-runtime`, `@crowsi/transport-foundation`, `@crowsi/browser-security`, `@zixcel/interaction`, `@hathq/ihat-store-core`, `@hathq/ihat-store-source`, `@hathq/ihat-store-scenes`. These archives are excluded from Git. Obtain the exact approved dependency artifacts before installing; a fresh clone alone is not sufficient. Registry distribution remains pending.

Use the package manager matching the checked-in lockfile and the Node.js version declared in `engines` in `package.json`. Run from this repository:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## Documentation and source

[Interface reference](docs/interface-reference.md)

[Usage guide](docs/getting-started.md)

[Detailed documentation](docs) · [Verification cases](test) · [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [License](LICENSE) · [Attribution notices](NOTICE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
