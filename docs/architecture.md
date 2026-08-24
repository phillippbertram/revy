# Architecture

Shippy is a pnpm workspace organized around executable applications and reusable packages.

```text
apps/desktop ────────┐
                     ├──> packages/ui
future apps/web ─────┘

apps/* and packages/ui ──> packages/typescript-config
```

Dependencies flow from applications to packages. Packages do not import application code, and
workspace consumers use declared package exports instead of relative cross-workspace paths.

## Applications

`apps/desktop` owns Electron-specific behavior:

- `main` owns operating-system, window, future filesystem, and future Git access.
- `preload` is an isolated, sandbox-compatible boundary and currently exposes no API.
- `renderer` owns browser-safe application composition and consumes shared UI exports.

A future Next.js surface belongs in `apps/web`. It may consume shared packages but must keep
server-, routing-, and framework-specific behavior inside the web application.

## Shared packages

`@shippy/ui` owns framework-neutral React components, shadcn source, utilities, theme tokens, and
base styles. Its public surface is:

- `@shippy/ui/components/*`
- `@shippy/ui/lib/*`
- `@shippy/ui/globals.css`

`@shippy/typescript-config` owns strict TypeScript defaults for base, Node.js, and React projects.
Consumers extend its exported JSON files and keep workspace-specific includes, references, aliases,
and runtime types locally.

Create another shared package only when real code has at least one stable responsibility and is
independent of its consumers. Do not create speculative domain, contract, or adapter packages.

## Dependency management

- External versions are exact and centralized in the pnpm catalog.
- Internal packages use `workspace:*`.
- All workspaces are private ESM packages under the `@shippy/*` namespace.
- Native pnpm recursive commands orchestrate shared validation and builds; no separate task runner
  is required.

## Current boundaries

The foundation has no IPC channels, context-bridge API, repository selection, Git execution,
persistence, tests, installer, release automation, or web application. Add those capabilities only
with a concrete product requirement and update this document when their ownership is established.
