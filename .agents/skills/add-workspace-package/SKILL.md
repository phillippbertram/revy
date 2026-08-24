---
name: add-workspace-package
description: Add or restructure a Revy pnpm workspace app or package. Use when introducing a workspace, moving shared code across package boundaries, or defining package exports and dependencies.
---

# Add a Revy Workspace

1. Read the root and nearest `AGENTS.md`, `docs/architecture.md`, `pnpm-workspace.yaml`, and the
   manifests of direct consumers.
2. Confirm that the proposed workspace owns real code and one stable responsibility. Do not create
   speculative placeholder packages.
3. Place executable surfaces in `apps/*` and reusable application-independent code in `packages/*`.
   Keep dependencies directed from apps to packages and never from packages to apps.
4. Create a private ESM manifest named under `@revy/*`. Use `catalog:` for external versions and
   `workspace:*` for internal dependencies. Do not add `author` or `license` fields.
5. Export every cross-workspace entrypoint explicitly. Update consumers to use package imports
   instead of relative cross-workspace paths.
6. Extend `@revy/typescript-config` and add only the scripts the workspace can meaningfully run.
   Do not add tests or a test command.
7. Update `docs/architecture.md` and the README when the public workspace map or commands change.
8. Run `pnpm install`, `pnpm check`, and `pnpm build` when runtime or build boundaries changed.
   Report any validation that cannot run; do not commit unless explicitly requested.
