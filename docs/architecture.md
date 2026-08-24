# Architecture

Shippy is a local, read-only Electron application in a pnpm workspace. Platform capabilities stay
behind Electron's security boundary; the renderer only receives validated product data.

```text
renderer UI
    │ narrow window.shippy API
    ▼
sandboxed preload
    │ typed, Zod-validated IPC
    ▼
Electron main process
    ├── system Git through simple-git
    ├── Codex App Server child process over JSONL stdio
    ├── repository source reads
    └── atomic JSON and Markdown below Electron userData
```

## Desktop ownership

`apps/desktop` owns the complete local product:

- `src/main/index.ts` creates the window, blocks navigation and popups, registers the narrow IPC
  surface, opens native file pickers, and publishes high-level review progress.
- `src/main/app-service.ts` coordinates the active repository, settings, reviews, and the single
  active run.
- `src/main/git-service.ts` uses `simple-git` with main-process-owned argument arrays to resolve Git
  roots, refs, merge bases, and status. It never accepts a command from the renderer.
- `src/main/codex-app-server.ts` implements the desktop-local `ReviewBackend`, owns one
  `codex app-server --stdio` process, and consumes only the required protocol events.
- `src/main/storage.ts` owns atomic settings, repository preferences, recents, and review files.
- `src/main/source-service.ts` resolves code references and project instruction files inside the
  canonical repository root.
- `src/shared/contracts.ts` is the app-local Zod source of truth for IPC inputs, persisted records,
  and renderer-facing types.
- `src/generated/codex-app-server` contains version-specific TypeScript bindings produced by Codex.
  Zod still validates incoming JSON because generated TypeScript types provide no runtime boundary.
- `src/preload/index.ts` exposes only repository, settings, review, and source-preview operations.
- `src/renderer` owns browser-safe composition and safe Markdown rendering.

The generated bindings use bundler module resolution because Codex emits extensionless TypeScript
imports. They are excluded from Biome formatting and linting; all maintained source remains under
the normal Biome rules.

## Repository model

A repository selection is canonicalized to its real Git root. Bare and non-Git directories are
rejected. Base detection follows this order:

1. `origin/HEAD`
2. `main` or `origin/main`
3. `master` or `origin/master`
4. the first available ref as a final local fallback

The displayed review scope is the union of:

- committed changes from the selected base's merge base to `HEAD`;
- staged changes;
- unstaged changes; and
- untracked, non-ignored files.

The repository fingerprint hashes `HEAD` and porcelain-v2 worktree status. Review metadata retains
that fingerprint so history can report when either the branch or worktree has changed.

## Review lifecycle

Only one run may be active. Shippy creates an ephemeral Codex thread rooted at the repository with
`read-only` sandboxing, no approvals, the selected model, and its supported reasoning effort. Codex
loads the normal `AGENTS.md` hierarchy itself.

The custom review instruction order is fixed:

1. non-overridable read-only, scope, Markdown, and `shippy://code` contracts;
2. the selected repository review skill, if any;
3. the selected output preset; and
4. personal style instructions.

The main process saves a review only after an `exitedReviewMode` Markdown item and a successful turn
completion. Failed and interrupted runs remain transient. Completed Markdown receives a stable
Shippy metadata header before persistence.

Codex App Server is experimental and external. Shippy feature-probes initialization, account, and
model discovery, validates the consumed event subset, and reports incompatible methods or payloads.
It does not automatically restart a crashed server; a later explicit retry may start a new process.

## Persistence

All writes stay under Electron `userData/storage-v1`:

```text
settings.json
repositories/<sha256-of-canonical-root>/
├── repository.json
├── preferences.json
└── reviews/<uuid>/
    ├── metadata.json
    └── review.md
```

Settings include recent repositories, an optional explicit Codex executable, model, reasoning
effort, format, and personal instructions. Repository preferences include the base branch and one
repository-relative Markdown instruction file. JSON files use write-then-rename replacement. There
is no database and no file is written to the selected repository.

## Code-reference security

Generated review links use `shippy://code/<repository-relative-path>?line=<line>&end=<line>`. The
renderer only parses the link into structured arguments. The main process then:

- rejects absolute paths, traversal, invalid identifiers, and missing files;
- canonicalizes both repository and target paths;
- rejects symlinks that escape the repository;
- accepts only regular, non-binary files up to 2 MiB; and
- returns a bounded source window around the requested lines.

Historical links intentionally show the current working-tree file. The review and source panel both
warn when the saved fingerprint is stale.

## Electron security boundary

The window preserves context isolation, renderer sandboxing, disabled Node integration, CSP,
popup denial, webview denial, and navigation blocking. Every renderer argument is parsed through a
strict Zod schema in the main process. Git, arbitrary filesystem APIs, subprocess handles, raw App
Server events, and internal reasoning are never exposed to the renderer.

Markdown is rendered as GitHub-flavoured Markdown without raw HTML. Repository code references are
handled as in-app actions; other links are displayed without navigation.

## Shared packages and deferred boundaries

`@shippy/ui` owns framework-neutral React components, theme tokens, and base styles that remain
usable by a future Next.js application. `@shippy/typescript-config` owns strict shared TypeScript
defaults. Packages never depend on applications, and consumers use declared package exports.

No provider-agnostic adapter package exists yet because Codex is the only backend. A later second
backend may justify extracting a stable adapter boundary for Claude, Hermes, or a Deep Agents and
LangSmith implementation. Packaging, signing, a web application, diff browsing, review editing,
agent fixes, concurrent reviews, CI, and automated tests remain out of scope.
