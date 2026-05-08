// LSP-shaped API surface (Q10): in-process, schema-aware functions
// that return LSP-style data. Each function takes a `DqlContext`
// (text + cursor + schema + optional AbortSignal) and returns a
// Promise of the appropriate response type.

export { provideDiagnostics } from './diagnostics.ts'
export { provideCompletions } from './completions.ts'
export { provideHover } from './hover.ts'
