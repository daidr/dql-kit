// Hover-tooltip extension powered by `@dql-kit/dql`'s `provideHover`.
//
// CM6 contributes `hoverTooltip` from `@codemirror/view` — we wrap
// our async hover provider into that contract. The DOM node is
// rendered with the markdown-ish `contents` field as plain text;
// consumers wanting fancier rendering can override the `format`
// option to inject markdown-it / rehype / etc.

import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { provideHover, type FetcherMap } from '@dql-kit/dql'
import type { FilterSchema } from '@dql-kit/core'

export type DqlHoverOptions = {
  schema: FilterSchema
  /**
   * Field-key → IdFetcher map. When provided, hovering an id-typed
   * value calls `fetcher.resolve([id])` and renders the returned
   * label in the tooltip (Q11). Without it, hovers fall back to
   * showing the raw id.
   */
  fetchers?: FetcherMap
  /**
   * Custom DOM-node renderer. Receives the raw `contents` string from
   * `provideHover` (plain text / lightweight markdown). Default
   * implementation places the text in a `<div class="dql-hover">`
   * with whitespace preserved.
   */
  format?: (contents: string) => HTMLElement
}

export const dqlHover = (opts: DqlHoverOptions): Extension =>
  hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const text = view.state.doc.toString()
    const h = await provideHover(text, pos, opts.schema, {
      fetchers: opts.fetchers,
    })
    if (!h) return null
    const create = opts.format ?? defaultFormat
    return {
      pos: h.range.from,
      end: h.range.to,
      above: true,
      create: () => ({ dom: create(h.contents) }),
    }
  })

const defaultFormat = (contents: string): HTMLElement => {
  const dom = document.createElement('div')
  dom.className = 'dql-hover'
  // Preserve newlines from our markdown-lite contents — sufficient for
  // the limited formatting we emit (heading lines + key/value lines).
  dom.style.whiteSpace = 'pre-wrap'
  dom.style.padding = '6px 10px'
  dom.style.font = '12px ui-sans-serif, system-ui, sans-serif'
  dom.textContent = contents
  return dom
}
