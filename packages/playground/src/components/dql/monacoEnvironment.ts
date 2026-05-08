// Monaco bootstrap for Vite — registers a `MonacoEnvironment.getWorker`
// so the editor's worker companion loads cleanly. Without this,
// monaco-editor falls back to an importScripts() URL that 404s in our
// dev / build setup.
//
// Codicon font handling lives in `vite.config.ts`
// (`optimizeDeps.exclude: ['monaco-editor']` + `assetsInclude`); see
// the comment there for rationale.
//
// This file has side effects — import once, before any monaco-editor
// surface mounts.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite injects the type at build time; not all type
// servers know about ?worker.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

if (typeof globalThis !== 'undefined') {
  const env = globalThis as unknown as {
    MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker }
  }
  env.MonacoEnvironment = {
    getWorker: () => new (EditorWorker as new () => Worker)(),
  }
}

export {}
