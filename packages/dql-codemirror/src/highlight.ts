// Token-class → colour mapping for DQL.
//
// The syntax ViewPlugin (see ./syntax.ts) emits `Decoration.mark` with
// stable `tok-*` class names. We pair that with an `EditorView.theme`
// that styles those classes — bypassing CM's `HighlightStyle` (which
// requires a Lezer syntax tree we don't produce).
//
// `tagFor` / `tagField` etc. are kept for symmetry with `@lezer/highlight`
// in case a future caller wants to wire in a real syntax-tree
// highlighting layer (Q13 — left as v2).

import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { tags as t, type Tag } from '@lezer/highlight'
import type { TokenKind } from '@dql-kit/dql'

// Stable class names (matches the ones emitted by ./syntax.ts).
export const TOK_CLASS = {
  controlKeyword: 'tok-controlKeyword',  // and / or
  keyword:        'tok-keyword',         // not (reserved)
  bool:           'tok-bool',            // true / false
  fieldName:      'tok-fieldName',
  operatorKeyword:'tok-operatorKeyword', // op identifiers
  unit:           'tok-unit',            // day / week / ...
  number:         'tok-number',
  string:         'tok-string',
  punctuation:    'tok-punctuation',     // .. , = !=
  paren:          'tok-paren',
  squareBracket:  'tok-squareBracket',
  invalid:        'tok-invalid',
} as const

/** Lezer Tag for a primitive token kind. Used by syntax.ts. */
export const tagFor = (kind: TokenKind): Tag | null => {
  switch (kind) {
    case 'AND':
    case 'OR':       return t.controlKeyword
    case 'TRUE':
    case 'FALSE':    return t.bool
    case 'NOT':      return t.keyword
    case 'NUMBER':   return t.number
    case 'STRING':   return t.string
    case 'RANGE':    return t.punctuation
    case 'COMMA':    return t.separator
    case 'LPAREN':
    case 'RPAREN':   return t.paren
    case 'LBRACK':
    case 'RBRACK':   return t.squareBracket
    case 'EQ':
    case 'NEQ':      return t.operator
    case 'IDENTIFIER':
    case 'INVALID':  return null
  }
}

export const tagField: Tag = t.variableName
export const tagOp: Tag = t.operatorKeyword
export const tagUnit: Tag = t.unit
export const tagInvalid: Tag = t.invalid

/**
 * Map a Lezer Tag to one of our stable `tok-*` class names. The
 * ViewPlugin uses this to label each decoration; the theme below
 * styles those class names.
 */
export const classFromTag = (tag: Tag): string => {
  if (tag === t.controlKeyword)  return TOK_CLASS.controlKeyword
  if (tag === t.keyword)         return TOK_CLASS.keyword
  if (tag === t.bool)            return TOK_CLASS.bool
  if (tag === tagField)          return TOK_CLASS.fieldName
  if (tag === tagOp)             return TOK_CLASS.operatorKeyword
  if (tag === tagUnit)           return TOK_CLASS.unit
  if (tag === t.number)          return TOK_CLASS.number
  if (tag === t.string)          return TOK_CLASS.string
  if (tag === t.punctuation)     return TOK_CLASS.punctuation
  if (tag === t.separator)       return TOK_CLASS.punctuation
  if (tag === t.operator)        return TOK_CLASS.punctuation
  if (tag === t.paren)           return TOK_CLASS.paren
  if (tag === t.squareBracket)   return TOK_CLASS.squareBracket
  if (tag === tagInvalid)        return TOK_CLASS.invalid
  return TOK_CLASS.fieldName // safe fallback
}

/**
 * Default colour theme. Exported but **not** included by `dql()` —
 * users opt in (Q13: themes are app-level concerns).
 *
 *   import { defaultDqlTheme } from '@dql-kit/dql-codemirror'
 *   extensions: [dql({schema}), defaultDqlTheme]
 */
export const defaultDqlTheme: Extension = EditorView.theme({
  ['.' + TOK_CLASS.controlKeyword]: {
    color: '#9c5cdc',
    fontWeight: 'bold',
  },
  ['.' + TOK_CLASS.keyword]: {
    color: '#9c5cdc',
  },
  ['.' + TOK_CLASS.bool]: {
    color: '#0f6e78',
    fontWeight: '500',
  },
  ['.' + TOK_CLASS.fieldName]: {
    color: '#1a5fb4',
  },
  ['.' + TOK_CLASS.operatorKeyword]: {
    color: '#3b7cca',
  },
  ['.' + TOK_CLASS.unit]: {
    color: '#856820',
    fontStyle: 'italic',
  },
  ['.' + TOK_CLASS.number]: {
    color: '#b85c00',
  },
  ['.' + TOK_CLASS.string]: {
    color: '#0f792b',
  },
  ['.' + TOK_CLASS.punctuation]: {
    color: '#9c8c7c',
  },
  ['.' + TOK_CLASS.paren]: {
    color: '#666',
  },
  ['.' + TOK_CLASS.squareBracket]: {
    color: '#666',
  },
  ['.' + TOK_CLASS.invalid]: {
    color: '#d61a35',
    textDecoration: 'underline wavy',
    textDecorationColor: '#d61a35',
  },
})

// Back-compat re-export (the previous identifier).
export const defaultDqlHighlightStyle = defaultDqlTheme
