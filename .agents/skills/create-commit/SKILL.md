---
name: create-commit
description: Create a focused Revy Git commit after explicit user authorization. Use when the user asks to stage and commit current changes; do not use for summaries, reviews, pushes, or pull requests alone.
---

# Create a Revy Commit

1. Confirm that the user explicitly requested a commit in the current conversation. A request to
   implement, review, or draft a message is not commit authorization.
2. Inspect `git status --short`, the staged diff, the unstaged diff, and recent commit subjects.
   Preserve unrelated user changes and never use destructive reset or checkout commands.
3. Identify the exact files belonging to the requested outcome. Run the validation required by
   `AGENTS.md` and report blockers before committing.
4. Stage only the intended files with explicit paths, then review the staged diff again.
5. Create an English Conventional Commit subject in the form `type(scope): summary`, omitting the
   scope when it adds no value. Add a concise body for non-trivial decisions or multiple outcomes.
6. Commit once, then report the commit hash and final status. Never amend, push, publish, or open a
   pull request unless separately and explicitly requested.
