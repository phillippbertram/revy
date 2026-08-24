# Architecture

Revy is a local, read-only Electron application in a pnpm workspace. Platform capabilities stay
behind Electron's security boundary; the renderer only receives validated product data.

```text
renderer UI
    │ narrow window.revy API
    ▼
sandboxed preload
    │ typed, Zod-validated IPC
    ▼
Electron main process
    ├── system Git through simple-git
    ├── Codex App Server child process over JSONL stdio
    ├── repository source reads
    ├── atomic review and activity records below Electron userData
    └── rotating local diagnostics below Electron logs
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
  `codex app-server --stdio` process, and projects the required protocol events into safe activity.
- `src/main/storage.ts` owns atomic settings, repository preferences, recents, reviews, and
  append-only run activity.
- `src/main/logger.ts` owns scoped, rotating, local-only diagnostics and their privacy boundary.
- `src/main/source-service.ts` resolves code references and project instruction files inside the
  canonical repository root.
- `src/shared/contracts.ts` is the app-local Zod source of truth for IPC inputs, persisted records,
  and renderer-facing types.
- `src/shared/review-formats.ts` validates structured agent output, derives review status and
  priority, and generates portable Markdown without platform-specific links.
- `src/generated/codex-app-server` contains version-specific TypeScript bindings produced by Codex.
  Zod still validates incoming JSON because generated TypeScript types provide no runtime boundary.
- `src/preload/index.ts` exposes only repository, settings, review, activity, diagnostics,
  source-preview, bounded clipboard, and validated external-link operations.
- `src/renderer` owns browser-safe composition, structured review cards, and safe Markdown
  rendering inside finding bodies.

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

Only one run may be active. Revy creates an ephemeral Codex thread rooted at the repository with
`read-only` sandboxing, no approvals, the selected model, and its supported reasoning effort. Codex
loads the normal `AGENTS.md` hierarchy itself.

The custom review instruction order is fixed:

1. non-overridable read-only, scope, structured JSON, priority, and reference contracts;
2. optional user-story context, explicitly isolated as untrusted requirement data;
3. the selected repository review skill, if any;
4. personal style instructions.

When supplied, the user story applies to one run. Codex must assess the story and its acceptance
criteria in the summary and report concrete unmet requirements through the normal finding model.
Ambiguous or unassessable requirements stay in the summary rather than becoming invented findings.

Every attempt creates a repository-scoped run record before Codex starts. The UI receives curated
lifecycle, command, tool, search, subagent, and warning metadata while prompts, reasoning, tool
arguments, patches, and command output stay out of activity. Started and completed updates for one
action resolve to one timeline entry. Unfinished records are recovered as interrupted after a
restart.

The main process accepts the `exitedReviewMode` text only when it contains a valid versioned review
object. A single outer JSON fence is tolerated; any remaining parse or schema error fails the run
without creating a review. Valid findings require a P0–P3 priority, concise Markdown body, and at
least one repository-relative code location. The structured record is authoritative and Revy
generates portable Markdown for copying into GitHub or GitLab. Deleting a completed run or review
removes both linked records; unsuccessful runs have activity only.

Codex App Server is experimental and external. Revy feature-probes initialization, account, and
model discovery, validates the consumed event subset, and reports incompatible methods or payloads.
It does not automatically restart a crashed server; a later explicit retry may start a new process.

## Persistence

All writes stay under Electron `userData/storage-v1`:

```text
settings.json
repositories/<sha256-of-canonical-root>/
├── repository.json
├── preferences.json
├── reviews/<uuid>/
│   ├── context.json
│   ├── metadata.json
│   ├── review.json
│   └── review.md
└── runs/<uuid>/
    ├── metadata.json
    └── activity.jsonl
```

Settings include recent repositories, an optional explicit Codex executable, model, reasoning
effort, personal instructions, and the persistent debug-logging switch. Obsolete persisted format
preferences are discarded without resetting the remaining settings. Repository preferences include
the base branch and one repository-relative Markdown instruction file. JSON files use
write-then-rename replacement; activity is appended immediately so an interrupted run remains
inspectable. Review context stores the normalized user story only for successful reviews; a missing
`context.json` is treated as an empty context for compatibility. Review directories without
`review.json` remain readable as legacy Markdown. There is no database and no file is written to the
selected repository.

Diagnostics use `electron-log` in the main process. `main.log` rotates at 5 MiB to one archive;
normal logging starts at `info`, while the persisted setting enables `debug`. Debug may include
local paths and stack traces, but logs never include repository contents, prompts, reasoning, raw
App Server messages, user stories, tool arguments, or command output. Revy does not upload logs.

## Code-reference security

Structured reviews carry repository-relative path and line records. Legacy reviews may use
`revy://code/<repository-relative-path>?line=<line>&end=<line>`. The renderer converts either form
into structured arguments. The main process then:

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

Activity IPC carries only validated Revy records. Opening the log directory is a pathless main
process action, and renderer diagnostics accept only bounded error metadata. Clipboard writes are
bounded text operations. External references must be absolute HTTPS URLs and are opened by the main
process in the system browser; the renderer never receives general navigation capability.

Finding bodies and legacy reviews are rendered as GitHub-flavoured Markdown without raw HTML.
Repository code references are handled as in-app actions. HTTPS links use the validated main-process
operation; unsupported link schemes remain non-interactive.

## Shared packages and deferred boundaries

`@revy/ui` owns framework-neutral React components, theme tokens, and base styles that remain
usable by a future Next.js application. `@revy/typescript-config` owns strict shared TypeScript
defaults. Packages never depend on applications, and consumers use declared package exports.

No provider-agnostic adapter package exists yet because Codex is the only backend. A later second
backend may justify extracting a stable adapter boundary for Claude, Hermes, or a Deep Agents and
LangSmith implementation. Packaging, signing, a web application, diff browsing, review editing,
agent fixes, concurrent reviews, CI, and automated tests remain out of scope.
