// DQL language registration for Monaco — registers the language id,
// monarch tokenizer (fallback / first-pass token classification), and
// language configuration (brackets, auto-closing pairs, on-enter rules).
//
// The "real" highlighting comes from a SemanticTokensProvider in
// `./contribution.ts` that re-uses our lex+parse+analyze pipeline so
// IDENTIFIER tokens are correctly disambiguated into field / op / unit
// (Q9 — slot-aware highlighting). The Monarch grammar is the
// flicker-free first-pass that paints the document until the semantic
// tokens are ready.

import type * as monacoNs from 'monaco-editor'

export const DQL_LANGUAGE_ID = 'dql'

/**
 * Idempotent registration of the DQL language on a Monaco namespace.
 * Safe to call multiple times — `register()` no-ops if the language
 * already exists, and we re-set tokenizer / configuration regardless
 * (cheap, and useful for hot-reload scenarios).
 */
export const registerDqlLanguage = (
  monaco: typeof monacoNs,
): void => {
  const existing = monaco.languages
    .getLanguages()
    .some((l) => l.id === DQL_LANGUAGE_ID)
  if (!existing) {
    monaco.languages.register({
      id: DQL_LANGUAGE_ID,
      extensions: ['.dql'],
      aliases: ['DQL', 'dql'],
    })
  }

  monaco.languages.setMonarchTokensProvider(DQL_LANGUAGE_ID, monarchTokenizer())
  monaco.languages.setLanguageConfiguration(
    DQL_LANGUAGE_ID,
    languageConfiguration(),
  )
}

// ---------------------------------------------------------------------------
// Monarch grammar
// ---------------------------------------------------------------------------

const monarchTokenizer = (): monacoNs.languages.IMonarchLanguage => ({
  defaultToken: '',
  ignoreCase: false,
  keywords: ['and', 'or', 'true', 'false', 'not'],
  // Monarch handles brackets specially via `@brackets`.
  brackets: [
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
    { open: '[', close: ']', token: 'delimiter.square' },
  ],
  tokenizer: {
    root: [
      // strings (double / single) — full-line, escape-aware
      [/"/, { token: 'string.quote', bracket: '@open', next: '@stringDouble' }],
      [/'/, { token: 'string.quote', bracket: '@open', next: '@stringSingle' }],

      // range — must beat the dot-leading number rule
      [/\.\./, 'operator'],

      // numbers (incl. leading -)
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],

      // identifiers / reserved keywords
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        },
      ],

      // operators
      [/!=/, 'operator'],
      [/=/, 'operator'],

      // punctuation
      [/,/, 'delimiter'],
      [/[\[\]\(\)]/, '@brackets'],

      // whitespace
      [/[ \t\r\n]+/, ''],
    ],
    stringDouble: [
      [/[^"\\]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
    stringSingle: [
      [/[^'\\]+/, 'string'],
      [/\\./, 'string.escape'],
      [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
  },
})

const languageConfiguration = (): monacoNs.languages.LanguageConfiguration => ({
  brackets: [
    ['(', ')'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: '\'', close: '\'', notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
    { open: '\'', close: '\'' },
  ],
  // No comments in DQL (Q3 — lossless not pursued).
})
