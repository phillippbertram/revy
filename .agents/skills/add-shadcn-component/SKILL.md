---
name: add-shadcn-component
description: Add or update shadcn components in the Revy monorepo. Use when the user requests a shared UI primitive, shadcn block, component dependency, or theme-compatible component change.
---

# Add a shadcn Component

1. Read `packages/ui/AGENTS.md` and inspect both `apps/desktop/components.json` and
   `packages/ui/components.json`.
2. From the repository root, run:

   ```sh
   pnpm --filter @revy/desktop exec shadcn add <component>
   ```

3. Inspect the resulting diff immediately. Reusable primitives, their utilities, and their direct
   dependencies belong to `@revy/ui`; application composition belongs to `apps/desktop`.
4. Keep the style, icon library, base color, aliases, and shared stylesheet aligned across both
   shadcn configurations.
5. Ensure every shared consumer import uses an exported `@revy/ui/...` subpath. Add or adjust the
   package export when the CLI creates a new public directory.
6. Preserve accessibility and framework neutrality. Do not introduce Electron or Next.js imports
   into the UI package.
7. Run `pnpm check`, `pnpm build`, and a renderer smoke test when appearance or interaction changed.
   Do not add tests or commit unless explicitly requested.
