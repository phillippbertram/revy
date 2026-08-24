# Desktop Application Instructions

- Keep Electron main, preload, and renderer code in their existing process-specific directories.
- The renderer is a browser environment: do not import Node.js or Electron APIs there.
- Keep `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- Keep the preload build as CommonJS for Electron sandbox compatibility while source code remains
  ESM TypeScript.
- Do not expose an IPC channel or context-bridge API without an explicit, typed contract, narrow
  input validation, and a concrete product requirement.
- Keep filesystem and future Git operations in the main process. Never pass unrestricted paths,
  commands, or Node capabilities to the renderer.
- Keep the restrictive Content Security Policy and deny unexpected navigation or new windows.
- Application composition belongs here; reusable components and styles belong in `@revy/ui`.
