// DQL lexer. Schema-free (Q9).
//
// Outputs a flat token stream plus any lexical diagnostics (unclosed
// strings, invalid escapes, stray characters). The parser layer
// consumes both — lexical errors are first-class in the diagnostic
// stream rather than thrown.
//
// Reserved words (`and`, `or`, `true`, `false`, `not`) are recognised
// case-sensitively in their lowercase form (Q8). Op names, units, and
// field names all surface as `IDENTIFIER` — disambiguation is the
// parser's job (positional context).

import type { SyntaxDiag, Token, TokenKind } from './types.ts'

const RESERVED: Record<string, TokenKind> = {
  and: 'AND',
  or: 'OR',
  true: 'TRUE',
  false: 'FALSE',
  not: 'NOT',
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isIdentStart = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c)

/**
 * Scan `text` into a flat token stream. Always succeeds — lexical
 * errors are surfaced via the returned `diag` list, never thrown.
 *
 * Whitespace and the (currently unsupported) comment forms are
 * dropped; their existence between tokens does not change the token
 * stream.
 */
export const lex = (text: string): { tokens: Token[], diag: SyntaxDiag[] } => {
  const tokens: Token[] = []
  const diag: SyntaxDiag[] = []
  let i = 0
  const len = text.length

  const peek = (offset = 0): string => text[i + offset] ?? ''

  while (i < len) {
    const start = i
    const c = peek()

    // ---- whitespace --------------------------------------------------
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++
      continue
    }

    // ---- single-char punctuation ------------------------------------
    if (c === '(') { tokens.push({ kind: 'LPAREN',  range: { from: start, to: ++i }, value: null }); continue }
    if (c === ')') { tokens.push({ kind: 'RPAREN',  range: { from: start, to: ++i }, value: null }); continue }
    if (c === '[') { tokens.push({ kind: 'LBRACK',  range: { from: start, to: ++i }, value: null }); continue }
    if (c === ']') { tokens.push({ kind: 'RBRACK',  range: { from: start, to: ++i }, value: null }); continue }
    if (c === ',') { tokens.push({ kind: 'COMMA',   range: { from: start, to: ++i }, value: null }); continue }

    // ---- = and != ---------------------------------------------------
    if (c === '=') {
      i++
      tokens.push({ kind: 'EQ', range: { from: start, to: i }, value: null })
      continue
    }
    if (c === '!' && peek(1) === '=') {
      i += 2
      tokens.push({ kind: 'NEQ', range: { from: start, to: i }, value: null })
      continue
    }

    // ---- range ..  (must beat number's leading `.` rule) ------------
    if (c === '.' && peek(1) === '.') {
      i += 2
      tokens.push({ kind: 'RANGE', range: { from: start, to: i }, value: null })
      continue
    }

    // ---- numbers ----------------------------------------------------
    // -? digits (.digits)? (e[+-]?digits)? — `-` is part of the literal,
    // not a unary operator (Q7). However the parser sometimes wants
    // `-` to be standalone (e.g. range with a negative endpoint after
    // `..`); we make `-` a number prefix only when a digit follows
    // immediately.
    if (c === '-' && isDigit(peek(1))) {
      i++ // consume `-`
      i = scanNumber(text, i)
      tokens.push(makeNumber(text, start, i, diag))
      continue
    }
    if (isDigit(c)) {
      i = scanNumber(text, i)
      tokens.push(makeNumber(text, start, i, diag))
      continue
    }

    // ---- strings ----------------------------------------------------
    if (c === '"' || c === '\'') {
      const result = scanString(text, i, c)
      tokens.push({
        kind: 'STRING',
        range: { from: start, to: result.end },
        value: result.value,
      })
      if (result.diag) diag.push(result.diag)
      i = result.end
      continue
    }

    // ---- identifiers & reserved words -------------------------------
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < len && isIdentPart(text[j]!)) j++
      const lex = text.slice(i, j)
      const reserved = RESERVED[lex]
      tokens.push({
        kind: reserved ?? 'IDENTIFIER',
        range: { from: i, to: j },
        value: reserved ? null : lex,
      })
      i = j
      continue
    }

    // ---- unknown character: emit INVALID + diag, advance by 1 -------
    i++
    tokens.push({
      kind: 'INVALID',
      range: { from: start, to: i },
      value: text.slice(start, i),
    })
    diag.push({
      range: { from: start, to: i },
      code: 'unexpected_token',
      message: `Unexpected character ${JSON.stringify(text.slice(start, i))}`,
    })
  }

  return { tokens, diag }
}

// ---------------------------------------------------------------------------
// Number scanner
// ---------------------------------------------------------------------------

/**
 * Consume a JSON-shape number starting at offset `i` (digit already
 * confirmed). Returns the offset *after* the last consumed character.
 *
 * Tolerates malformed shapes like `1.` or `1e` — the caller validates
 * by attempting `Number(slice)` and emits `invalid_number` if needed.
 */
const scanNumber = (text: string, i: number): number => {
  const len = text.length
  while (i < len && isDigit(text[i]!)) i++
  if (text[i] === '.' && isDigit(text[i + 1] ?? '')) {
    i++
    while (i < len && isDigit(text[i]!)) i++
  }
  if (text[i] === 'e' || text[i] === 'E') {
    i++
    if (text[i] === '+' || text[i] === '-') i++
    while (i < len && isDigit(text[i]!)) i++
  }
  return i
}

const makeNumber = (
  text: string,
  start: number,
  end: number,
  diag: SyntaxDiag[],
): Token => {
  const slice = text.slice(start, end)
  const n = Number(slice)
  if (!Number.isFinite(n)) {
    diag.push({
      range: { from: start, to: end },
      code: 'invalid_number',
      message: `Invalid number literal ${JSON.stringify(slice)}`,
    })
    return { kind: 'NUMBER', range: { from: start, to: end }, value: 0 }
  }
  return { kind: 'NUMBER', range: { from: start, to: end }, value: n }
}

// ---------------------------------------------------------------------------
// String scanner
// ---------------------------------------------------------------------------

/**
 * Scan a quoted string starting at the opening quote character. Bails
 * out gracefully on raw newlines / EOF — the resulting token still
 * has a sensible value (the partial content) so parser error
 * recovery can keep going.
 */
const scanString = (
  text: string,
  start: number,
  quote: string,
): { end: number, value: string, diag: SyntaxDiag | null } => {
  const len = text.length
  let i = start + 1 // skip opening quote
  let out = ''
  let diag: SyntaxDiag | null = null

  while (i < len) {
    const c = text[i]!
    if (c === quote) {
      // Closing quote — done.
      return { end: i + 1, value: out, diag }
    }
    if (c === '\n' || c === '\r') {
      // Raw newline forbidden (Q7). Terminate string at the newline,
      // leaving the newline for the next iteration.
      diag = {
        range: { from: start, to: i },
        code: 'unclosed_string',
        message: `Unterminated string literal — newlines must be escaped as \\n`,
      }
      return { end: i, value: out, diag }
    }
    if (c === '\\') {
      const esc = text[i + 1]
      if (esc === undefined) {
        diag = {
          range: { from: i, to: i + 1 },
          code: 'invalid_escape',
          message: 'Trailing backslash before end of input',
        }
        return { end: i + 1, value: out, diag }
      }
      switch (esc) {
        case '\\': out += '\\'; break
        case '"':  out += '"';  break
        case '\'': out += '\''; break
        case 'n':  out += '\n'; break
        case 't':  out += '\t'; break
        case 'r':  out += '\r'; break
        case 'u': {
          const hex = text.slice(i + 2, i + 6)
          if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16))
            i += 6
            continue
          }
          diag = diag ?? {
            range: { from: i, to: Math.min(i + 6, len) },
            code: 'invalid_escape',
            message: 'Invalid \\u escape (expected 4 hex digits)',
          }
          out += text.slice(i, Math.min(i + 6, len))
          i = Math.min(i + 6, len)
          continue
        }
        default:
          diag = diag ?? {
            range: { from: i, to: i + 2 },
            code: 'invalid_escape',
            message: `Unknown escape \\${esc}`,
          }
          out += esc
      }
      i += 2
      continue
    }
    out += c
    i++
  }

  // Reached EOF without closing quote.
  diag = {
    range: { from: start, to: len },
    code: 'unclosed_string',
    message: 'Unterminated string literal — missing closing quote',
  }
  return { end: len, value: out, diag }
}
