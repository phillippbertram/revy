# Shippy

Shippy is a desktop application for reviewing the changes on a repository's current branch
before they ship.

The project is currently at its foundation stage. The Electron shell, React renderer, Tailwind
CSS, shadcn/ui, TypeScript, Biome, and pnpm workspace are wired together, while repository
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
| `pnpm build` | Type-check and build the desktop app |
| `pnpm start` | Preview the production build |
| `pnpm typecheck` | Check the main, preload, and renderer TypeScript projects |
| `pnpm check` | Run Biome and TypeScript checks |
| `pnpm check:fix` | Apply safe Biome fixes and run TypeScript checks |

## Workspace

```text
.
└── apps
    └── desktop
        └── src
            ├── main
            ├── preload
            └── renderer
```

The renderer owns its shadcn/ui configuration and checked-in component source. Add future
components from the repository root with:

```sh
pnpm dlx shadcn@4.19.0 add <component> -c apps/desktop
```

## Roadmap

The next product milestone is opening a local Git repository and presenting the changes on its
current branch for review. No file-system or Git access is exposed to the renderer in this initial
version.

Automated tests are intentionally not part of this project.

## License

Shippy is available under the [MIT License](LICENSE).
