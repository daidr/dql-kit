// Syntax + semantic highlighting via a ViewPlugin that reuses the
// dql package's lex / parse / analyze pipeline (Q10: same single
// source of truth for tokens that lint / completion / hover use).
//
// Layered decoration:
//   1. Token-level: each lexed token gets a base tag.
//   2. Slot-level: IDENTIFIER tokens are upgraded to field / op / unit
//      tags based on which sub-range of the RangeMap they fall in.
//   3. Semantic: ranges flagged by `analyze` as `unknown_field` /
//      `op_not_allowed` / `value_type_mismatch` are overridden with
//      the `invalid` tag so they paint red (Q13). `incomplete` is
//      excluded — painting red while typing is hostile.

import {
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
  Decoration,
} from '@codemirror/view'
import { Prec, RangeSetBuilder } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { bracketMatching } from '@codemirror/language'
import { analyze, type FilterSchema, type ValidationError } from '@dql-kit/core'
import {
  lex,
  parse,
  pathKey,
  type ConditionRanges,
  type RangeMap,
  type TextRange,
  type Token,
  type TokenKind,
} from '@dql-kit/dql'
import type { Tag } from '@lezer/highlight'
import {
  classFromTag,
  tagField,
  tagFor,
  tagInvalid,
  tagOp,
  tagUnit,
} from './highlight.ts'

export type DqlExtensionOptions = {
  schema: FilterSchema
}

/**
 * Top-level extension factory — combines syntax+semantic decoration
 * with bracketMatching. Wire it into your `EditorView.extensions`.
 */
export const dql = (opts: DqlExtensionOptions): Extension => [
  syntaxDecorations(opts),
  bracketMatching(),
]

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

const syntaxDecorations = (opts: DqlExtensionOptions): Extension => {
  const buildSet = (view: EditorView): DecorationSet =>
    buildDecorations(view.state.doc.toString(), opts.schema)

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildSet(view)
      }
      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.decorations = buildSet(update.view)
        }
      }
    },
    { decorations: (v) => v.decorations },
  )

  // Run before the default highlight precedence so a user-supplied
  // syntaxHighlighting() can still pick up our tags.
  return Prec.high(plugin)
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

const buildDecorations = (
  text: string,
  schema: FilterSchema,
): DecorationSet => {
  if (text.length === 0) return Decoration.none

  const tokens = lex(text).tokens
  const { draft, ranges } = parse(text)
  const slotMap = buildSlotMap(ranges)

  const builder = new RangeSetBuilder<Decoration>()

  // ---- token-level pass -------------------------------------------
  // Tokens are emitted in left-to-right order by the lexer, which
  // RangeSetBuilder requires.
  for (const tok of tokens) {
    const tag = tagForToken(tok, slotMap)
    if (tag === null) continue
    builder.add(
      tok.range.from,
      tok.range.to,
      Decoration.mark({ class: classFromTag(tag), inclusive: false }),
    )
  }

  // RangeSetBuilder must add ranges in increasing `from` order. The
  // semantic pass produces ranges that may interleave with token
  // ranges, so we collect them and merge into a second set.
  const tokenSet = builder.finish()

  // ---- semantic invalid override ----------------------------------
  const semanticBuilder = new RangeSetBuilder<Decoration>()
  const errors = analyze(draft, schema).errors
  const invalidRanges = collectInvalidRanges(errors, ranges)
  for (const r of invalidRanges) {
    semanticBuilder.add(
      r.from,
      r.to,
      Decoration.mark({ class: classFromTag(tagInvalid), inclusive: false }),
    )
  }
  const semanticSet = semanticBuilder.finish()

  // CodeMirror's `update` merges multiple sets; both contribute marks.
  // We return one combined set by re-emitting via a third builder
  // ordered by `from` (semantic ranges always after the token-level
  // ones at the same start).
  return mergeSets([tokenSet, semanticSet])
}

const tagForToken = (tok: Token, slotMap: SlotMap): Tag | null => {
  if (tok.kind === 'IDENTIFIER') {
    const slot = slotMap.lookup(tok.range)
    switch (slot) {
      case 'field': return tagField
      case 'op':    return tagOp
      case 'value': return tagUnit
      default:      return tagField
    }
  }
  return tagFor(tok.kind)
}

// ---------------------------------------------------------------------------
// SlotMap — maps a token range back to which sub-range of which
// condition contains it.
// ---------------------------------------------------------------------------

type Slot = 'field' | 'op' | 'value' | 'whole'

class SlotMap {
  private entries: Array<{ from: number, to: number, slot: Slot }>
  constructor(entries: SlotMap['entries']) { this.entries = entries }

  lookup(r: TextRange): Slot | null {
    for (const e of this.entries) {
      if (e.from <= r.from && r.to <= e.to) return e.slot
    }
    return null
  }
}

const buildSlotMap = (ranges: RangeMap): SlotMap => {
  const entries: Array<{ from: number, to: number, slot: Slot }> = []
  for (const r of ranges.values()) {
    if (!('field' in r || 'op' in r || 'value' in r)) continue
    const cr = r as ConditionRanges
    if (cr.field) entries.push({ ...cr.field, slot: 'field' })
    if (cr.op)    entries.push({ ...cr.op,    slot: 'op'    })
    if (cr.value) entries.push({ ...cr.value, slot: 'value' })
  }
  // Order doesn't matter for lookup correctness, but stable order
  // makes debugging easier.
  entries.sort((a, b) => a.from - b.from)
  return new SlotMap(entries)
}

// ---------------------------------------------------------------------------
// Semantic invalid range collection
// ---------------------------------------------------------------------------

const collectInvalidRanges = (
  errors: ValidationError[],
  ranges: RangeMap,
): TextRange[] => {
  const out: TextRange[] = []
  for (const e of errors) {
    if (e.code === 'incomplete') continue
    const r = ranges.get(pathKey(e.path))
    if (!r) continue
    if (!('field' in r || 'op' in r || 'value' in r)) continue
    const cr = r as ConditionRanges
    let pick: TextRange | undefined
    switch (e.code) {
      case 'unknown_field':       pick = cr.field ?? cr.whole; break
      case 'op_not_allowed':      pick = cr.op    ?? cr.whole; break
      case 'value_type_mismatch': pick = cr.value ?? cr.whole; break
      case 'value_shape_mismatch':
        pick = cr.value ?? cr.op ?? cr.whole; break
    }
    if (pick) out.push(pick)
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to)
  return out
}

// ---------------------------------------------------------------------------
// Decoration set helpers
// ---------------------------------------------------------------------------

const mergeSets = (sets: DecorationSet[]): DecorationSet => {
  // Collect all decorations into a flat array, sort by `from` ascending,
  // then by `to` *descending* so the larger range is added first when
  // starts tie — RangeSetBuilder requires same-`from` decorations be
  // added outer-before-inner so the inner one can layer on top.
  type Entry = { from: number, to: number, deco: Decoration }
  const flat: Entry[] = []
  for (const s of sets) {
    const cursor = s.iter()
    while (cursor.value !== null) {
      flat.push({ from: cursor.from, to: cursor.to, deco: cursor.value })
      cursor.next()
    }
  }
  flat.sort((a, b) => a.from - b.from || b.to - a.to)

  const builder = new RangeSetBuilder<Decoration>()
  for (const e of flat) builder.add(e.from, e.to, e.deco)
  return builder.finish()
}

// Re-export TokenKind for convenience.
export type _TokenKind = TokenKind
