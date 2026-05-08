// DQL parser. Schema-free (Q9). Produces a DraftAST + RangeMap with
// error recovery — never throws; malformed input becomes diagnostics
// plus a best-effort partial tree.
//
// Grammar (informal):
//
//   document := group_body? trailing_garbage?
//   group_body := node ((AND | OR) node)*    -- mixed AND/OR is a diagnostic, parser still produces output
//   node := condition | '(' group_body ')'
//   condition := IDENTIFIER op_token value_part?
//   op_token := IDENTIFIER | EQ | NEQ
//   value_part := list_value | range_value | relative_value | scalar_value
//   list_value := '[' (scalar (',' scalar)* ','?)? ']'
//   range_value := scalar '..' scalar
//   relative_value := NUMBER IDENTIFIER       -- only valid after `inLast`-ish op; parser accepts any
//   scalar := STRING | NUMBER | TRUE | FALSE
//
// The parser does NOT validate that an op is in `field.ops`, that a
// field exists in the schema, or that types match. Those checks are
// `core.analyze`'s job (Q9).

import type {
  Combinator,
  DraftAST,
  DraftCondition,
  DraftGroup,
  DraftNode,
  NodePath,
} from '@dql-kit/core'
import { lex } from './lex.ts'
import {
  pathKey,
  type ConditionRanges,
  type GroupRanges,
  type ParseResult,
  type RangeMap,
  type SyntaxDiag,
  type SyntaxDiagCode,
  type TextRange,
  type Token,
  type TokenKind,
} from './types.ts'

// Plural-tolerant unit normalisation. Source-side `days` becomes the
// AST-side `day` that core.RELATIVE_UNITS uses.
const UNIT_NORMALIZE: Record<string, string> = {
  minute: 'minute', minutes: 'minute',
  hour: 'hour',     hours: 'hour',
  day: 'day',       days: 'day',
  week: 'week',     weeks: 'week',
  month: 'month',   months: 'month',
}

// `=` and `!=` are spelt forms of these op names.
const SYMBOLIC_OP: Partial<Record<TokenKind, string>> = {
  EQ: 'eq',
  NEQ: 'neq',
}

export const parse = (text: string): ParseResult => {
  const { tokens, diag: lexDiag } = lex(text)
  const diag: SyntaxDiag[] = [...lexDiag]
  const ranges: RangeMap = new Map()
  let pos = 0

  // ---- helpers ------------------------------------------------------

  const peek = (offset = 0): Token | undefined => tokens[pos + offset]
  const peekKind = (offset = 0): TokenKind | undefined =>
    tokens[pos + offset]?.kind
  const eat = (): Token | undefined => tokens[pos++]
  const isAtEnd = (): boolean => pos >= tokens.length

  const report = (
    range: TextRange,
    code: SyntaxDiagCode,
    message: string,
  ): void => {
    diag.push({ range, code, message })
  }

  const eofRange = (): TextRange => {
    const last = tokens[tokens.length - 1]
    const at = last ? last.range.to : 0
    return { from: at, to: at }
  }

  // Skip tokens until we land on something that looks like a node /
  // group boundary. Used after a parse error to keep going.
  const recoverToBoundary = (): void => {
    while (!isAtEnd()) {
      const k = peekKind()
      if (k === 'AND' || k === 'OR' || k === 'RPAREN') return
      eat()
    }
  }

  // ---- entry point --------------------------------------------------

  const parseDocument = (): DraftAST => {
    if (isAtEnd()) {
      ranges.set(pathKey([]), { whole: { from: 0, to: text.length } })
      return { combinator: 'and', children: [] }
    }
    const root = parseGroupBody([], /* isRoot */ true)
    ranges.set(pathKey([]), { whole: { from: 0, to: text.length } })
    return root
  }

  // ---- group body ---------------------------------------------------

  /**
   * Parse a sequence of `node ((AND|OR) node)*`. Returns a DraftGroup.
   *
   * `path` is the path of the *resulting group* (so child paths are
   * `[...path, i]`). `isRoot` controls whether parseGroupBody stops at
   * RPAREN (nested) or at EOF (root).
   */
  const parseGroupBody = (
    path: NodePath,
    isRoot: boolean,
  ): DraftGroup => {
    const children: DraftNode[] = []
    let firstConn: Combinator | null = null

    // First child.
    if (!atGroupBoundary(isRoot)) {
      const child = parseNode([...path, children.length])
      if (child !== null) children.push(child)
    }

    // Connectors and subsequent children.
    while (!isAtEnd() && !atGroupBoundary(isRoot)) {
      const k = peekKind()
      if (k === 'AND' || k === 'OR') {
        const tok = eat()!
        const conn: Combinator = k === 'AND' ? 'and' : 'or'
        if (firstConn === null) {
          firstConn = conn
        } else if (conn !== firstConn) {
          report(
            tok.range,
            'mixed_combinator',
            `Cannot mix \`and\` and \`or\` at the same level — wrap one side in parentheses`,
          )
        }
        if (atGroupBoundary(isRoot) || isAtEnd()) {
          report(tok.range, 'expected_field', 'Expected another condition after connector')
          break
        }
        const child = parseNode([...path, children.length])
        if (child !== null) children.push(child)
      } else if (k === 'IDENTIFIER' || k === 'LPAREN') {
        // Implicit connector — user forgot `and` / `or`. Start a new
        // node and surface a diagnostic; don't lose the data.
        const tokAt = peek()!
        report(
          { from: tokAt.range.from, to: tokAt.range.from },
          'unexpected_token',
          'Expected `and` / `or` between conditions',
        )
        if (firstConn === null) firstConn = 'and'
        const child = parseNode([...path, children.length])
        if (child !== null) children.push(child)
      } else if (k === 'RPAREN' && isRoot) {
        const tok = eat()!
        report(tok.range, 'unmatched_paren', 'Unexpected `)` — no matching `(`')
      } else {
        // Garbage between conditions — skip the offender.
        const tok = eat()!
        report(
          tok.range,
          'trailing_garbage',
          `Unexpected token: ${tokenLabel(tok)}`,
        )
      }
    }

    const combinator: Combinator = firstConn ?? 'and'
    return { combinator, children }
  }

  const atGroupBoundary = (isRoot: boolean): boolean => {
    if (isAtEnd()) return true
    if (isRoot) return false
    return peekKind() === 'RPAREN'
  }

  // ---- node (condition | nested group) -----------------------------

  const parseNode = (path: NodePath): DraftNode | null => {
    const k = peekKind()
    if (k === 'LPAREN') return parseNestedGroup(path)
    if (k === 'IDENTIFIER') return parseCondition(path)
    if (k === 'RPAREN' || k === undefined) {
      // Empty slot — caller (parseGroupBody) will recover from / wrap
      // RPAREN with the right diagnostic.
      return null
    }
    if (k === 'AND' || k === 'OR') {
      // Connector at field-position: missing left-hand operand.
      const tok = eat()!
      report(
        tok.range,
        'expected_field',
        `Expected field name before ${tokenLabel(tok)}`,
      )
      return null
    }

    // Anything else here (NUMBER, STRING, EQ, TRUE, FALSE, NOT, ...)
    // starts no valid node. Report and skip.
    const tok = eat()!
    if (tok.kind === 'TRUE' || tok.kind === 'FALSE' || tok.kind === 'NOT') {
      report(
        tok.range,
        'reserved_word_as_field',
        `Reserved word ${tokenLabel(tok)} cannot be used as a field name`,
      )
    } else {
      report(tok.range, 'expected_field', `Expected field name, got ${tokenLabel(tok)}`)
    }
    return null
  }

  // ---- nested group `( ... )` --------------------------------------

  const parseNestedGroup = (path: NodePath): DraftNode | null => {
    const lparen = eat()! // consume LPAREN
    const inner = parseGroupBody(path, /* isRoot */ false)
    let closingTo = lparen.range.to
    if (peekKind() === 'RPAREN') {
      closingTo = eat()!.range.to
    } else {
      // Synthesize a closing paren at EOF / sync point.
      const end = peek()?.range.from ?? text.length
      report(
        { from: lparen.range.from, to: end },
        'unmatched_paren',
        'Unmatched `(` — missing closing `)`',
      )
      closingTo = end
    }
    const ranges_: GroupRanges = {
      whole: { from: lparen.range.from, to: closingTo },
    }
    ranges.set(pathKey(path), ranges_)
    return inner
  }

  // ---- condition ----------------------------------------------------

  /**
   * Parse `IDENTIFIER op_token value_part?` with tolerance for
   * mid-edit gaps. Returns a `DraftCondition` (possibly with null op
   * or undefined value) or `null` when nothing usable can be made.
   */
  const parseCondition = (path: NodePath): DraftNode | null => {
    const fieldTok = eat()!
    const field = fieldTok.value as string
    const condRanges: ConditionRanges = {
      whole: { ...fieldTok.range },
      field: { ...fieldTok.range },
    }
    const condition: DraftCondition = { field, op: null }

    // op slot
    const k = peekKind()
    if (k === 'IDENTIFIER' || k === 'EQ' || k === 'NEQ') {
      const opTok = eat()!
      condRanges.op = { ...opTok.range }
      condRanges.whole.to = opTok.range.to
      if (opTok.kind === 'EQ' || opTok.kind === 'NEQ') {
        condition.op = SYMBOLIC_OP[opTok.kind]!
      } else {
        condition.op = opTok.value as string
      }
    } else if (k === undefined || k === 'AND' || k === 'OR' || k === 'RPAREN' || k === 'COMMA' || k === 'RBRACK') {
      // No op token — emit incomplete condition.
      ranges.set(pathKey(path), condRanges)
      return condition
    } else {
      const tok = eat()!
      report(tok.range, 'expected_op', `Expected operator after field \`${field}\`, got ${tokenLabel(tok)}`)
      condRanges.whole.to = tok.range.to
      ranges.set(pathKey(path), condRanges)
      return condition
    }

    // value slot — only if more tokens before group boundary.
    if (canStartValue()) {
      const v = parseValue()
      if (v !== undefined) {
        condition.value = v.value
        condRanges.value = v.range
        condRanges.whole.to = v.range.to
      }
    }

    ranges.set(pathKey(path), condRanges)
    return condition
  }

  const canStartValue = (): boolean => {
    const k = peekKind()
    if (k === undefined) return false
    return (
      k === 'STRING' ||
      k === 'NUMBER' ||
      k === 'TRUE' ||
      k === 'FALSE' ||
      k === 'LBRACK'
    )
  }

  // ---- value --------------------------------------------------------

  type ValueResult = { value: unknown, range: TextRange }

  /**
   * Parse a value token sequence. Returns `undefined` if no value can
   * be parsed (caller leaves `condition.value` as undefined →
   * downstream `incomplete` diagnostic).
   */
  const parseValue = (): ValueResult | undefined => {
    const k = peekKind()

    if (k === 'LBRACK') return parseListValue()

    // Otherwise expect a scalar; could be followed by RANGE or unit.
    const first = parseScalar()
    if (first === undefined) return undefined

    if (peekKind() === 'RANGE') {
      const rangeTok = eat()!
      const second = parseScalar()
      if (second === undefined) {
        report(
          { from: rangeTok.range.from, to: rangeTok.range.to },
          'expected_range_endpoint',
          'Expected a value after `..`',
        )
        return {
          value: [first.value, undefined],
          range: { from: first.range.from, to: rangeTok.range.to },
        }
      }
      return {
        value: [first.value, second.value],
        range: { from: first.range.from, to: second.range.to },
      }
    }

    if (peekKind() === 'IDENTIFIER' && typeof first.value === 'number') {
      // Relative form: NUMBER IDENTIFIER
      const unitTok = eat()!
      const raw = unitTok.value as string
      const unit = UNIT_NORMALIZE[raw] ?? raw
      return {
        value: { amount: first.value, unit },
        range: { from: first.range.from, to: unitTok.range.to },
      }
    }

    return first
  }

  const parseListValue = (): ValueResult => {
    const lbrack = eat()! // LBRACK
    const items: unknown[] = []
    let lastTo = lbrack.range.to

    if (peekKind() === 'RBRACK') {
      const rb = eat()!
      return { value: items, range: { from: lbrack.range.from, to: rb.range.to } }
    }

    while (true) {
      if (isAtEnd()) {
        report(
          { from: lbrack.range.from, to: lastTo },
          'unmatched_bracket',
          'Unmatched `[` — missing closing `]`',
        )
        break
      }
      const k = peekKind()
      if (k === 'RBRACK') {
        lastTo = eat()!.range.to
        break
      }
      if (k === 'AND' || k === 'OR' || k === 'RPAREN') {
        report(
          { from: lbrack.range.from, to: lastTo },
          'unmatched_bracket',
          'Unmatched `[` — missing closing `]`',
        )
        break
      }
      const item = parseScalar()
      if (item === undefined) {
        // Couldn't parse — skip one token to avoid infinite loop.
        const skipped = eat()
        if (skipped) {
          report(
            skipped.range,
            'expected_value',
            `Expected list element, got ${tokenLabel(skipped)}`,
          )
        }
        continue
      }
      items.push(item.value)
      lastTo = item.range.to
      if (peekKind() === 'COMMA') {
        lastTo = eat()!.range.to
        // trailing comma: `[1, 2,]` is allowed (formatter never emits one,
        // but we tolerate user input).
        if (peekKind() === 'RBRACK') {
          lastTo = eat()!.range.to
          break
        }
        continue
      }
      if (peekKind() === 'RBRACK') {
        lastTo = eat()!.range.to
        break
      }
      // Missing comma between items.
      const next = peek()
      if (next) {
        report(
          { from: lastTo, to: next.range.from },
          'unexpected_token',
          'Expected `,` between list elements',
        )
      }
    }

    return {
      value: items,
      range: { from: lbrack.range.from, to: lastTo },
    }
  }

  const parseScalar = (): ValueResult | undefined => {
    const k = peekKind()
    if (k === 'STRING') {
      const tok = eat()!
      return { value: tok.value as string, range: tok.range }
    }
    if (k === 'NUMBER') {
      const tok = eat()!
      return { value: tok.value as number, range: tok.range }
    }
    if (k === 'TRUE') {
      const tok = eat()!
      return { value: true, range: tok.range }
    }
    if (k === 'FALSE') {
      const tok = eat()!
      return { value: false, range: tok.range }
    }
    return undefined
  }

  // ---- run ----------------------------------------------------------

  const draft = parseDocument()
  return { draft, ranges, syntaxDiag: diag }
}

// ---------------------------------------------------------------------------
// Token labels for human-readable diagnostics
// ---------------------------------------------------------------------------

const tokenLabel = (tok: Token): string => {
  switch (tok.kind) {
    case 'AND':        return '`and`'
    case 'OR':         return '`or`'
    case 'TRUE':       return '`true`'
    case 'FALSE':      return '`false`'
    case 'NOT':        return '`not`'
    case 'EQ':         return '`=`'
    case 'NEQ':        return '`!=`'
    case 'RANGE':      return '`..`'
    case 'COMMA':      return '`,`'
    case 'LPAREN':     return '`(`'
    case 'RPAREN':     return '`)`'
    case 'LBRACK':     return '`[`'
    case 'RBRACK':     return '`]`'
    case 'IDENTIFIER': return `identifier \`${tok.value as string}\``
    case 'NUMBER':     return `number ${tok.value as number}`
    case 'STRING':     return `string ${JSON.stringify(tok.value as string)}`
    case 'INVALID':    return `\`${tok.value as string}\``
  }
}
