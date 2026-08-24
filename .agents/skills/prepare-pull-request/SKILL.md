---
name: prepare-pull-request
description: Prepare a Shippy pull-request title and description from committed branch changes. Use when the user asks for PR wording or a branch summary; keep uncommitted work separate and do not publish without explicit authorization.
---

# Prepare a Shippy Pull Request

1. Inspect Git status and identify the requested base branch, defaulting to `main` only when no
   other base is established.
2. Ground the scope in committed changes using the merge-base range `<base>...HEAD`: review the log,
   diff stat, and diff. Describe staged and unstaged work separately and exclude it from PR scope.
3. Write an English Conventional Commit-style title: `type(scope): summary`, with a scope only when
   it materially clarifies the change.
4. Write a concise Markdown body with outcome-focused `Summary` and `Changes` sections. Add an
   actionable `How to test` only when it helps a reviewer; do not list internal lint, type-check, or
   build commands as a generic testing section.
5. Call out compatibility or security boundaries only when the committed change affects them.
6. Return the draft by default. Do not push a branch, create a pull request, or mutate GitHub state
   without explicit authorization.
