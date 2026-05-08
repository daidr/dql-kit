import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

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
  },
})
