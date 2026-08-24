import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const rendererSource = fileURLToPath(new URL('./src/renderer/src', import.meta.url))

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        output: {
          format: 'es',
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        output: {
          entryFileNames: '[name].cjs',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rendererSource,
      },
    },
  },
})
