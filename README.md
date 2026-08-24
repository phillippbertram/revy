# Shippy

Shippy is a desktop application for reviewing the changes on a repository's current branch
before they ship.

The project is currently at its foundation stage. The Electron shell consumes shared React,
Tailwind CSS, and shadcn/ui foundations from reusable workspace packages, while repository
selection and Git review functionality are intentionally not implemented yet.

## Requirements

- Node.js 22.12 or newer
- pnpm 11.15.1

## Getting started

```sh
pnpm install
pnpm dev
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Electron app in development mode |
| `pnpm dev:desktop` | Start the Electron app explicitly |
| `pnpm build` | Type-check and build the desktop app |
| `pnpm start` | Preview the production build |
| `pnpm start:desktop` | Preview the desktop production build explicitly |
| `pnpm typecheck` | Check the main, preload, and renderer TypeScript projects |
| `pnpm check` | Run Biome and TypeScript checks |
| `pnpm check:fix` | Apply safe Biome fixes and run TypeScript checks |

## Workspace

```text
.
├── apps
│   └── desktop              Electron main, preload, and renderer processes
└── packages
    ├── typescript-config    Shared strict TypeScript configurations
    └── ui                   Shared React components, styles, and shadcn source
```

Applications may depend on packages; packages never depend on applications. Shared workspace
dependencies use `workspace:*`, while external versions are pinned once in the pnpm catalog.
See [Architecture](docs/architecture.md) for the module boundaries.

The desktop workspace is the shadcn CLI entrypoint and routes reusable primitives into
`@shippy/ui`. Add components from the repository root with:

```sh
pnpm --filter @shippy/desktop exec shadcn add <component>
```

Consumers import shared modules through explicit package exports:

```tsx
import { Card } from '@shippy/ui/components/card'
import '@shippy/ui/globals.css'
```

## Agent support

Project rules live in `AGENTS.md` files and repository skills live under `.agents/skills`.
Claude Code receives the same instructions through lightweight `CLAUDE.md` adapters and shared
skill links; GitHub Copilot receives a repository adapter without duplicating the canonical rules.

## Roadmap

The next product milestone is opening a local Git repository and presenting the changes on its
current branch for review. No file-system or Git access is exposed to the renderer in this initial
version. A future Next.js application can be added under `apps/web` and reuse the existing UI and
TypeScript configuration packages without changing their platform-neutral contracts.

Automated tests are intentionally not part of this project.

## License

Shippy is available under the [MIT License](LICENSE).
