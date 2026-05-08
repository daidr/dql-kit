// Public surface of @dql-kit/dql.
//
// The package is layered:
//   - `lex`    : text → Token[]                                 (schema-free)
//   - `parse`  : Token[] → { draft, ranges, syntaxDiag }        (schema-free, TODO)
//   - `format` : DraftAST → string                              (TODO)
//   - lsp/*    : provideDiagnostics / provideCompletions / provideHover (TODO)
//
// During v1 rollout, this file re-exports incrementally as each layer
// lands. Anything not yet exported is an internal implementation
// detail — do not import from `./xxx.ts` directly.

export type {
  TextRange,
  Token,
  TokenKind,
  ConditionRanges,
  GroupRanges,
  RangeMap,
  SyntaxDiag,
  SyntaxDiagCode,
  ParseResult,
  Severity,
  Diagnostic,
  CompletionKind,
  CompletionItem,
  Hover,
  DqlContext,
  DqlOptions,
  FetcherMap,
} from './types.ts'

export { DEFAULT_DQL_OPTIONS, pathKey } from './types.ts'
export { lex } from './lex.ts'
export { parse } from './parse.ts'
export { format } from './format.ts'
export {
  provideDiagnostics,
  provideCompletions,
  provideHover,
} from './lsp/index.ts'
