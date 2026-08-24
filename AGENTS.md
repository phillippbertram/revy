# Shippy Agent Instructions

## Project

- Shippy is a public desktop application for reviewing the changes on a repository's current
  branch before they ship.
- The product is currently a foundation only. Do not implement repository selection, Git access,
  IPC, persistence, packaging, or a web application unless the task explicitly requests it.
- Use English for source code, comments, documentation, commit messages, and pull-request copy.

## Toolchain

- Use Node.js 22.12 or newer and pnpm 11.15.1 through Corepack.
- Use pnpm only. Do not introduce npm, Yarn, Bun, Turbo, or a custom workspace dispatcher.
- External dependency versions belong in the strict catalog in `pnpm-workspace.yaml` and package
  manifests reference them with `catalog:`.
- Internal workspace dependencies must use `workspace:*`.
- Keep all packages private, ESM-based, and free of `author` and `license` manifest fields.

## Workspace Architecture

- Executable product surfaces live under `apps/*`.
- Reusable, application-independent modules live under `packages/*`.
- Applications may depend on packages. Packages must never depend on applications.
- Import shared code through a package's declared exports. Do not reach into another workspace by
  relative path.
- Do not create empty `core`, `contracts`, or similar packages in anticipation of future work.
  Introduce a package only when real shared code and a stable responsibility exist.
- Keep framework- or runtime-specific behavior in its application unless at least two consumers
  can share it without adapters.

## Implementation Rules

- Use TypeScript with strict settings and ESM source code throughout.
- Keep Biome as the single formatter and linter for supported files.
- Preserve the Electron security boundary described in `apps/desktop/AGENTS.md`.
- Shared UI must follow `packages/ui/AGENTS.md` and remain usable by a future Next.js application.
- Do not add tests, test scripts, test dependencies, test configuration, snapshots, or fixtures.
- Do not add CI workflows, release automation, hooks, MCP configuration, or agent permission rules
  unless explicitly requested.

## Validation

- Run `pnpm check` after source, configuration, or documentation changes.
- Run `pnpm build` when runtime code, build configuration, dependencies, or package boundaries
  change.
- Smoke-test `pnpm dev` or `pnpm start` when Electron startup or renderer behavior changes.
- Validate observable behavior directly; do not compensate for the no-tests policy with hidden test
  harnesses.

## Git and Documentation

- Inspect staged and unstaged changes separately and preserve unrelated user work.
- Do not stage, commit, amend, push, publish, or open a pull request unless explicitly requested.
- Use concise English Conventional Commit subjects when a commit is requested.
- Treat documentation updates as part of done when product capabilities or architecture boundaries
  change. Keep the current high-level feature set concise and user-facing in `README.md`.
- Keep architecture and module-placement rules canonical in `docs/architecture.md`. Explain the
  system for orientation, not as an implementation reference; avoid low-level protocol details and
  duplicated source-code documentation.
