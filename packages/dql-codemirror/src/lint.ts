// CodeMirror linter source — adapts our `Diagnostic` shape to
// `@codemirror/lint`'s.
//
// Note: `@codemirror/lint`'s `Diagnostic` has a slightly different
// shape (`from` / `to` instead of `range`, severity is the literal
// 'error' / 'warning' / 'info'). We translate, also mapping 'hint'
// down to 'info' since lint has no hint level.

import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { provideDiagnostics } from '@dql-kit/dql'
import type { DqlOptions } from '@dql-kit/dql'
import type { FilterSchema } from '@dql-kit/core'

export type DqlLinterOptions = {
  schema: FilterSchema
  /** Override the default `incompleteSeverity` (defaults to 'hint'). */
  options?: DqlOptions
}

/**
 * CodeMirror linter source for DQL. Wire it into your extensions:
 *
 *   extensions: [dql({ schema }), dqlLinter({ schema })]
 */
export const dqlLinter = (opts: DqlLinterOptions): Extension =>
  linter(async (view) => {
    const text = view.state.doc.toString()
    const ours = await provideDiagnostics(text, opts.schema, opts.options)
    return ours.map(toCmDiagnostic)
  })

const toCmDiagnostic = (d: import('@dql-kit/dql').Diagnostic): CmDiagnostic => ({
  from: d.range.from,
  to: d.range.to,
  severity:
    d.severity === 'error'   ? 'error'
    : d.severity === 'warning' ? 'warning'
    : 'info', // 'hint' has no CM6 equivalent
  message: d.message,
  source: d.code,
})
