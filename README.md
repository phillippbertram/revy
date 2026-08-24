# Shippy

Shippy is a local Electron application for reviewing every change on the current Git branch before
it ships. It combines committed branch changes with staged, unstaged, and untracked work, then asks
an existing local Codex installation for a focused Markdown review.

The MVP provides:

- native repository selection, canonical Git-root detection, recent repositories, and selectable
  base branches;
- read-only change discovery through the system Git installation;
- one cancellable Codex review at a time, using models and reasoning efforts discovered from Codex
  App Server;
- immutable Markdown review history stored in Electron app data;
- safe `shippy://code` links that open current working-tree files in a read-only source panel; and
- global format, model, reasoning, and personal-style settings plus repository-specific review
  instructions.

## Requirements

- Node.js 22.12 or newer
- pnpm 11.15.1 through Corepack
- Git available on `PATH`
- an installed and authenticated Codex CLI (`codex login`)

Codex App Server is an experimental external dependency. Shippy does not install, update,
authenticate, or modify the configuration of Codex. See the
[official App Server documentation](https://developers.openai.com/codex/app-server).

## Development

```sh
pnpm install
pnpm dev
```

Open a repository, confirm its detected base branch, optionally choose a project review skill, and
start the review. Completed reviews remain available after restart; cancelled and failed runs are
not saved.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Electron app in development mode |
| `pnpm build` | Type-check and build the desktop app |
| `pnpm start` | Preview the production build |
| `pnpm check` | Run Biome and TypeScript checks |
| `pnpm check:fix` | Apply safe Biome fixes and run TypeScript checks |

Automated tests are intentionally not part of this project.

## Privacy and storage

Repositories are treated as read-only. Git, filesystem, persistence, and Codex subprocess access
stay in Electron's main process and are exposed through a narrow validated preload API. Reviews and
settings are written below Electron's platform-specific `userData` directory, never inside the
selected repository.

See [Architecture](docs/architecture.md) for the canonical process, security, storage, and module
boundaries.

## Workspace

```text
apps/desktop              Electron application and app-local contracts
packages/typescript-config
packages/ui               Shared React components, styles, and shadcn source
```

External versions are exact and centralized in the pnpm catalog. Shared UI components are added
through the desktop shadcn entrypoint:

```sh
pnpm --filter @shippy/desktop exec shadcn add <component>
```

The checked-in Codex protocol bindings reflect the development CLI version. Regenerate them after
an intentional Codex protocol update:

```sh
cd apps/desktop
codex app-server generate-ts --experimental --out ./src/generated/codex-app-server
```

## License

Shippy is available under the [MIT License](LICENSE).
