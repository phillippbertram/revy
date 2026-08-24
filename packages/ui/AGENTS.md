# Shared UI Instructions

- Keep this package independent of Electron, Next.js, routing, filesystem APIs, and application
  state.
- Prefer accessible semantic HTML and preserve keyboard, focus, and screen-reader behavior.
- Keep components compatible with browser rendering and React Server Component consumers. Add
  client-only directives only when a component actually requires browser state or effects.
- Add reusable shadcn primitives here and expose consumer-facing modules through `package.json`
  exports. Do not rely on undeclared deep imports.
- Use package-local `#components/*` and `#lib/*` imports inside this workspace.
- Keep shared theme tokens and base styles in `src/styles/globals.css`. Applications may add their
  own layout styles but must not fork the shared tokens.
- Keep React and React DOM as peer dependencies and add implementation dependencies to this package,
  not to a consuming application.
