import { describe, expect, test } from 'bun:test'
import { lex } from '../src/lex.ts'
import type { Token, TokenKind } from '../src/types.ts'

const kinds = (tokens: Token[]): TokenKind[] => tokens.map((t) => t.kind)
const values = (tokens: Token[]): Array<string | number | null> =>
  tokens.map((t) => t.value)

describe('lex — whitespace', () => {
  test('empty input produces zero tokens', () => {
    const r = lex('')
    expect(r.tokens).toEqual([])
    expect(r.diag).toEqual([])
  })

  test('whitespace and newlines are dropped', () => {
    const r = lex('  \t\n\r ')
    expect(r.tokens).toEqual([])
    expect(r.diag).toEqual([])
  })
})

describe('lex — punctuation', () => {
  test('parens / brackets / comma', () => {
    const r = lex('(),[]')
    expect(kinds(r.tokens)).toEqual([
      'LPAREN', 'RPAREN', 'COMMA', 'LBRACK', 'RBRACK',
    ])
    expect(r.diag).toEqual([])
  })

  test('eq and neq', () => {
    const r = lex('= !=')
    expect(kinds(r.tokens)).toEqual(['EQ', 'NEQ'])
  })

  test('range token .. is single-token, beats nothing else', () => {
    const r = lex('5..10')
    expect(kinds(r.tokens)).toEqual(['NUMBER', 'RANGE', 'NUMBER'])
    expect(values(r.tokens)).toEqual([5, null, 10])
  })

  test('lone dot is invalid (no `.` operator in DQL)', () => {
    const r = lex('.')
    expect(kinds(r.tokens)).toEqual(['INVALID'])
    expect(r.diag).toHaveLength(1)
    expect(r.diag[0]!.code).toBe('unexpected_token')
  })
})

describe('lex — reserved words (Q8: lowercase only)', () => {
  test('and / or / true / false / not are reserved', () => {
    const r = lex('and or true false not')
    expect(kinds(r.tokens)).toEqual(['AND', 'OR', 'TRUE', 'FALSE', 'NOT'])
    expect(values(r.tokens)).toEqual([null, null, null, null, null])
  })

  test('uppercase variants are NOT reserved (case-sensitive)', () => {
    const r = lex('AND And TRUE')
    expect(kinds(r.tokens)).toEqual(['IDENTIFIER', 'IDENTIFIER', 'IDENTIFIER'])
    expect(values(r.tokens)).toEqual(['AND', 'And', 'TRUE'])
  })
})

describe('lex — identifiers', () => {
  test('JS identifier subset', () => {
    const r = lex('title rating publishedAt _underscore camelCase123')
    expect(kinds(r.tokens)).toEqual(Array(5).fill('IDENTIFIER'))
    expect(values(r.tokens)).toEqual([
      'title', 'rating', 'publishedAt', '_underscore', 'camelCase123',
    ])
  })

  test('op names lex as identifier (parser disambiguates by position)', () => {
    const r = lex('contains startsWith between in inLast notIn')
    expect(kinds(r.tokens)).toEqual(Array(6).fill('IDENTIFIER'))
    expect(values(r.tokens)).toEqual([
      'contains', 'startsWith', 'between', 'in', 'inLast', 'notIn',
    ])
  })

  test('relative units lex as identifier', () => {
    const r = lex('day days week weeks month months hour hours minute minutes')
    expect(kinds(r.tokens).every((k) => k === 'IDENTIFIER')).toBe(true)
  })
})

describe('lex — numbers', () => {
  test('plain integers', () => {
    const r = lex('0 1 42 100')
    expect(kinds(r.tokens)).toEqual(Array(4).fill('NUMBER'))
    expect(values(r.tokens)).toEqual([0, 1, 42, 100])
  })

  test('negative integer is single token (Q7: leading `-` is part of the literal)', () => {
    const r = lex('-3')
    expect(kinds(r.tokens)).toEqual(['NUMBER'])
    expect(values(r.tokens)).toEqual([-3])
  })

  test('floats', () => {
    const r = lex('3.14 -0.5 0.0')
    expect(kinds(r.tokens)).toEqual(['NUMBER', 'NUMBER', 'NUMBER'])
    expect(values(r.tokens)).toEqual([3.14, -0.5, 0])
  })

  test('scientific notation', () => {
    const r = lex('1e3 1.5e-2 2E+10')
    expect(values(r.tokens)).toEqual([1000, 0.015, 2e10])
  })

  test('range with negative endpoints', () => {
    // `-5..-1` should lex as NUMBER(-5) RANGE NUMBER(-1) when the
    // second `-` follows immediately after `..`.
    const r = lex('-5..-1')
    expect(kinds(r.tokens)).toEqual(['NUMBER', 'RANGE', 'NUMBER'])
    expect(values(r.tokens)).toEqual([-5, null, -1])
  })

  test('integer dot integer disambiguates from range', () => {
    // `1.5` is a float, not `1 .. 5`. The lexer's range rule requires
    // two literal dots in a row.
    const r = lex('1.5')
    expect(kinds(r.tokens)).toEqual(['NUMBER'])
    expect(values(r.tokens)).toEqual([1.5])
  })
})

describe('lex — strings', () => {
  test('double-quoted simple', () => {
    const r = lex('"hello"')
    expect(kinds(r.tokens)).toEqual(['STRING'])
    expect(values(r.tokens)).toEqual(['hello'])
    expect(r.diag).toEqual([])
  })

  test('single-quoted simple (Q7: both quote forms accepted)', () => {
    const r = lex('\'world\'')
    expect(kinds(r.tokens)).toEqual(['STRING'])
    expect(values(r.tokens)).toEqual(['world'])
  })

  test('escape sequences', () => {
    const r = lex('"a\\nb\\tc\\\\d\\"e"')
    expect(values(r.tokens)).toEqual(['a\nb\tc\\d"e'])
    expect(r.diag).toEqual([])
  })

  test('unicode escape', () => {
    const r = lex('"\\u00e9"')
    expect(values(r.tokens)).toEqual(['é'])
  })

  test('unclosed string ending at EOF reports diag and yields partial value', () => {
    const r = lex('"hello')
    expect(kinds(r.tokens)).toEqual(['STRING'])
    expect(values(r.tokens)).toEqual(['hello'])
    expect(r.diag).toHaveLength(1)
    expect(r.diag[0]!.code).toBe('unclosed_string')
  })

  test('raw newline inside string is forbidden (Q7)', () => {
    const r = lex('"a\nb"')
    // String terminates at the newline; the trailing `b"` lexes as
    // identifier + unclosed-string.
    expect(r.tokens[0]!.kind).toBe('STRING')
    expect(r.diag.some((d) => d.code === 'unclosed_string')).toBe(true)
  })

  test('invalid escape reports diag but keeps token', () => {
    const r = lex('"a\\zb"')
    expect(kinds(r.tokens)).toEqual(['STRING'])
    expect(r.diag).toHaveLength(1)
    expect(r.diag[0]!.code).toBe('invalid_escape')
  })

  test('range with quoted endpoints (Q6.5 date range form)', () => {
    const r = lex('"2024-01-01".."2024-12-31"')
    expect(kinds(r.tokens)).toEqual(['STRING', 'RANGE', 'STRING'])
    expect(values(r.tokens)).toEqual(['2024-01-01', null, '2024-12-31'])
  })
})

describe('lex — token ranges', () => {
  test('ranges are precise and half-open', () => {
    const r = lex('title contains "hi"')
    expect(r.tokens[0]!.range).toEqual({ from: 0, to: 5 })   // "title"
    expect(r.tokens[1]!.range).toEqual({ from: 6, to: 14 })  // "contains"
    expect(r.tokens[2]!.range).toEqual({ from: 15, to: 19 }) // `"hi"`
  })
})

describe('lex — full-shape sanity (mini integration)', () => {
  test('a representative DQL document lexes cleanly', () => {
    const text = '(title contains "hello" or status in ["draft", "published"]) and rating between 1..10'
    const r = lex(text)
    expect(r.diag).toEqual([])
    expect(kinds(r.tokens)).toEqual([
      'LPAREN',
      'IDENTIFIER', 'IDENTIFIER', 'STRING',
      'OR',
      'IDENTIFIER', 'IDENTIFIER', 'LBRACK', 'STRING', 'COMMA', 'STRING', 'RBRACK',
      'RPAREN',
      'AND',
      'IDENTIFIER', 'IDENTIFIER', 'NUMBER', 'RANGE', 'NUMBER',
    ])
  })

  test('empty isEmpty op leaves no trailing tokens', () => {
    const r = lex('name isEmpty')
    expect(kinds(r.tokens)).toEqual(['IDENTIFIER', 'IDENTIFIER'])
    expect(r.diag).toEqual([])
  })

  test('inLast relative literal', () => {
    const r = lex('publishedAt inLast 7 days')
    expect(kinds(r.tokens)).toEqual([
      'IDENTIFIER', 'IDENTIFIER', 'NUMBER', 'IDENTIFIER',
    ])
    expect(values(r.tokens)).toEqual(['publishedAt', 'inLast', 7, 'days'])
  })
})
