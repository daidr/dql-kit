import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  // The workspace publishes the `development` export condition (see each
  // package.json). Vite respects this automatically, so playground imports
  // resolve to source `.ts` files for hot-reload.
  resolve: {
    conditions: ['development', 'import', 'module', 'browser', 'default'],
  },
  server: {
    port: 5173,
    open: true,
    fs: {
      // Bun stores resolved packages in a content-addressed cache that
      // sits outside the workspace root (and on Windows often on a
      // different drive). With Vite's default fs guard, /@fs/ requests
      // for monaco's codicon font are rejected and Vite returns the
      // SPA index.html — which the browser tries to decode as a font,
      // hence "OTS parsing error: invalid sfntVersion 1008813135"
      // (`0x3C212D2D` = ASCII `<!--`).
      //
      // `strict: false` disables the check entirely. The `allow` field
      // takes absolute filesystem paths (not globs), so listing it here
      // would be a no-op. Acceptable for a local dev playground; if
      // this config is ever ported to a hosted preview, switch back to
      // `strict: true` and list explicit roots.
      strict: false,
    },
  },
})