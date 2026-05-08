# ADR 0002 — DQL (Dou Query Language): a textual surface syntax for filter ASTs

This ADR captures the decisions that shaped `@dql-kit/dql` (the parser /
LSP package), `@dql-kit/dql-codemirror` (the CodeMirror 6 integration),
and `@dql-kit/dql-monaco` (the Monaco editor integration).

DQL ("Dou Query Language") is a textual language for the same
`DraftAST` / `ValidAST` already defined by `@dql-kit/core` — it adds a
*human-typeable* edge to the existing UI / URL / SQL surfaces.

All decisions are explicit trade-offs; alternatives considered are
recorded so future contributors understand *why* the current shape
exists, not just what it is.

## Vision

A SQL-ish textual language that round-trips to `DraftAST` semantically
(not lossless), with an LSP-shaped completion / diagnostic surface and a
CodeMirror 6 editor that stays in sync with the same `filter.draft` ref
that drives `<FilterBuilder>`. The DQL editor is a *parallel* editing
input to the UI — not a replacement for it.

## Package boundaries

```
@dql-kit/dql               ──► parser + LSP API, peerDeps: @dql-kit/core
   ├── lex                 text → Token[]                 (schema-free)
   ├── parse               Token[] → { draft, ranges, syntaxDiag }
   ├── format              DraftAST → string
   ├── analyze integration core analyze + RangeMap → Diagnostic[]
   └── lsp/                provideDiagnostics / provideCompletions / provideHover

@dql-kit/dql-codemirror    ──► CodeMirror 6 extension
   ├── peerDep:            @dql-kit/dql
   ├── peerDep:            @codemirror/state, /view, /language,
   │                       /autocomplete, /lint, /highlight
   └── exports             dql() / dqlLinter() / dqlCompletion() / dqlHover()
```

`@dql-kit/dql` MUST NOT import CodeMirror. `@dql-kit/dql-codemirror`
MUST NOT add new language semantics — it is purely a CM6 adapter.

No `@dql-kit/vue-dql` package — Vue users mount CM6 with a 30-line
snippet documented in dql-codemirror's README (consistent with
`vue-router-sync` being separate from `vue-headless`: heavy peer deps
get isolated, light glue stays in user code).

## Decisions (Q1–Q15)

### Q1 — Role of DQL in the dql-kit surface

**Decision**: DQL is a **parallel editing input** that synchronises with
the same `filter.draft` ref as the UI's `<FilterBuilder>`. Not a
replacement, not just a debug format, not just a wire format.

**Why**: A pure replacement is unrealistic — id fields, date pickers,
enum dropdowns are far better in UI. A debug-only format wouldn't need
LSP, contradicting the stated requirement. A wire format is already
covered by the compact-JSON URL serializer. Parallel editing gives DQL
the strongest justification for LSP / completion / highlighting
investment.

**Constraint imposed**: Because DQL must reflect mid-edit state, the
parser must produce `DraftAST` (Q4), not just `ValidAST`.

### Q2 — Surface syntax style

**Decision**: SQL-ish infix with keyword operators.

```
title contains "hello"
title contains "hello" and status in ["draft", "published"]
(title contains "hello" or title startsWith "foo") and rating gte 4
```

**Why**: KQL/Lucene are too operator-poor for the 19-op registry.
JSON-shaped syntax has no human-typeability advantage. S-expressions
alienate dashboard users. SQL-ish gives the highest familiarity / op
expressiveness ratio.

**Sub-decisions**:
- `=` is sugar for `eq`; `!=` is sugar for `neq`. No other symbolic op
  aliases — 19 distinct op names as keywords would create excessive
  symbolic noise and documentation burden.
- `and` / `or` are keywords; nesting is **explicit parentheses only**,
  no implicit precedence (see Q5).
- **No NOT** — matches `core`'s decision (DESIGN.md Q1). Negation goes
  through `neq` / `notIn` / `notContains` / `notEmpty`.
- The root `combinator` is determined by the top-level keyword between
  conditions (or defaults to `and` for empty / single-condition docs).
- Whitespace and newlines are non-semantic.

### Q3 — DQL ↔ AST round-trip semantics

**Decision**: **(c) DQL text is the document source; AST is derived.**
AST → DQL re-rendering happens only at specific moments, not every
keystroke. No CST / trivia tree. Comments and quote-style preferences
are not preserved.

**Why**: Lossless round-trip would require a separate concrete syntax
tree with attached trivia, multiplying engineering and test surface for
benefits that don't exist in the dashboard-filter domain (no one
comments a status filter, no one cares about single vs double quotes
when sharing a URL). Aggressive immediate normalisation (option b)
makes the cursor jump while typing.

**Specific protocol**:
- DQL → DraftAST runs on every keystroke (debounced 100ms).
- DraftAST → DQL runs only when external state writes the draft *and*
  the editor is unfocused (Q14).
- The buffer is never reformatted while the user is typing.

### Q4 — Parser output shape

**Decision**: **(α) Parser produces `DraftAST` directly**, with error
recovery. Schema is *not* consulted during parse.

**Why**: Reuses `core`'s existing `analyze(draft, schema)` pipeline —
DQL package does not re-implement schema validation. Aligns DQL editor
state with `useFilter.draft`, so both editing surfaces share the same
reactive object. Error recovery is mandatory anyway (LSP must function
mid-edit), and producing DraftAST is the natural recovery target.

**Implications**:
- Unknown fields / ops are *not* parser errors. They become
  `ValidationError` codes in the analyze step.
- Truly malformed input (unclosed strings, mixed `and`/`or` at one
  level, garbage tokens) produces parser errors with text ranges.
- Mid-edit incompleteness (`title contains ` with no value yet) is not
  an error — produces a `DraftCondition` with `value: undefined`,
  surfaced as a `Hint` (not `Error`) diagnostic.

### Q5 — Mixed `and`/`or` at the same level

**Decision**: **(i) Strict — mixed combinators at one level is a
syntax error**, with quick fixes that wrap the prefix or suffix in
parentheses.

```
a and b or c    →    syntax error
(a and b) or c  →    OK
a and (b or c)  →    OK
```

**Why**: Each `Group` in the AST has exactly one combinator. Forcing
explicit parentheses makes grammar isomorphic to AST structure (zero
ambiguity), avoids the SQL `AND > OR` precedence footgun for non-SQL
users, and makes formatter behaviour fully deterministic.

**Specific rules**:
- Top-level combinator is determined by whichever connective appears.
  Single-condition documents default to `and`.
- Single-child parenthesised groups `(a) and b` are flattened to
  `a and b` (matches `core`'s prune behaviour).
- The empty document has an empty `and` root group, consistent with
  `emptyDraft()`.

### Q6 — valueShape literal forms

| valueShape | Literal form | Example |
|---|---|---|
| `none` | nothing follows the op | `name isEmpty` |
| `single` | infix value | `count = 5` / `name contains "ali"` |
| `pair` | range literal `lo..hi` | `count between 1..10` |
| `list` | array literal `[a, b, c]` | `status in ["draft", "published"]` |
| `relative` | natural-language quantity | `publishedAt inLast 7 days` |

**Why these specifically**:
- `pair` uses `..` instead of SQL's `between A and B` because the
  latter introduces grammar ambiguity with the logical `and` keyword
  (`count between 5 and 10 and status = "x"`). Range literals are
  unambiguous and visually consistent with the language.
- `list` uses `[...]` instead of SQL's `(...)` to avoid clashing with
  grouping parentheses; matches JS array syntax (frontend-friendly).
- `relative` reads naturally; units (`day` / `days` / `week` / etc.)
  are normalised to `core`'s singular form on parse and re-pluralised
  by the formatter based on `amount`.
- `none` op forbids any trailing token — a stray value is a syntax
  error, not a `value_shape_mismatch` (parser catches it before
  analyze).

### Q6.5 — Date / datetime range literals

**Decision**: **Quoted-string literals on both sides of `..`**:

```
publishedAt between "2024-01-01".."2024-12-31"
createdAt   between "2024-01-01T00:00:00Z".."2024-12-31T23:59:59Z"
```

**Why**: Keeps the lexer schema-free (no context-sensitive date
tokenisation). Aligns with single-value date literals which are also
quoted strings. ISO format validity is enforced by `core`'s
`checkPrimitive` at analyze time, not by the lexer.

**Range rules** (apply to all types):
- `..` is a closed interval `[lo, hi]`. No exclusive variants.
- One-sided ranges (`5..`, `..10`) are syntax errors.
- Whitespace around `..` is optional on input; the formatter emits no
  whitespace.
- `..` is only valid after `between`. Standalone use is a syntax error.
- Type symmetry of the two endpoints is enforced by the analyze step
  (`value_type_mismatch`), not by the parser.

### Q7 — Literal rules

| Literal | Form |
|---|---|
| String | `"..."` preferred, `'...'` accepted; JSON escape subset (`\\` `\"` `\'` `\n` `\t` `\r` `\uXXXX`); raw newlines forbidden; formatter emits double-quoted |
| Number | JSON number literal, `-?\d+(\.\d+)?([eE][+-]?\d+)?`; the leading `-` is part of the literal, no unary minus operator |
| Boolean | `true` / `false` lowercase only |
| Enum value | String literal (`"published"`) for string enums, number literal for number enums; **never bare identifiers** |
| Id value | Number literal or quoted string; **no label sugar** (`@alice` etc.) |
| `null` | **Does not exist**. "No value" is expressed via `isEmpty` / `notEmpty` (none-shape ops) |

**Why enum values are quoted strings, not bare identifiers**: Bare
identifiers force the lexer to know schema fields' enum values to
distinguish them from field names — destroying the schema-free lexer
property (Q9) and creating edge cases when enum values clash with
keywords (`f.enum(['and', 'or'])`). Quoting also matches SQL's
`WHERE status = 'published'` convention.

**Why no `null` literal**: dql-kit AST condition values are never
null — they're either `undefined` (none-shape) or a real value.
Introducing `null` would make `name = null` vs `name isEmpty` an
eternal bug source.

### Q8 — Identifier rules, reserved words, and the no-escape principle

**Decision**: Zero-escape syntax. Field names obey strict JS identifier
rules; reserved words are off-limits; no backtick escape mechanism.

**Reserved words** (lowercase only, lexer is case-sensitive on these):
`and`, `or`, `true`, `false`, `not` (the last is reserved for future
use to prevent breaking changes if NOT is ever introduced).

**Field names** (unquoted):
```
[a-zA-Z_][a-zA-Z0-9_]*
```

**Op names and relative units** are lexed as plain identifiers;
parser-position (slot) determines whether an identifier is an op, a
unit, or a field reference.

**Why no backticks / no other escape**: Every escape mechanism imposes
a "do I need to escape this?" decision on every field name the user
types. The cost of *forbidding* schema-incompatible field names
(extremely rare in practice — every dql-kit schema in this repo uses
camelCase) is much smaller than the cost of every user keeping the
escape rule in mind.

**Schema-author constraint** (documented in `@dql-kit/dql/README.md`):
field keys must match `/^[a-zA-Z_][a-zA-Z0-9_]*$/` and must not be one
of the 5 reserved words. Violations cause the DQL parser to emit
`unsupported field name` diagnostics. `@dql-kit/dql` exports
`validateSchemaForDql(schema): string[]` for opt-in startup validation.

### Q9 — Compilation pipeline and source-map (RangeMap)

**Decision**: Three layers, schema enters at exactly one boundary.

```
1. Lex      text → Token[]                                   schema-free
2. Parse    Token[] → { draft, ranges, syntaxDiag }          schema-free
3. Analyze  { draft, schema } → { ast, errors }              core analyze()
```

**RangeMap**: A side-channel `Map<string, ConditionRanges | GroupRanges>`
keyed by `path.join('.')` (matching `core`'s `ValidationError.path`).
For conditions, four sub-ranges are tracked — `whole`, `field`, `op`,
`value` — so that `unknown_field` highlights the field token,
`op_not_allowed` highlights the op token, etc.

```ts
type ConditionRanges = {
  whole: TextRange
  field?: TextRange
  op?:    TextRange
  value?: TextRange
}
type GroupRanges = { whole: TextRange }
```

**Why a side-channel and not an attribute on AST nodes**: Keeps
`DraftAST` plain serialisable data — same shape that
`<FilterBuilder>` consumes via `useFilter.draft`. The RangeMap exists
only in the DQL editing context.

**Other decisions**:
- Full reparse on every keystroke (debounced 100ms). At <1KB documents
  it costs <1ms; incremental parse (lezer-style) is v2.
- `incomplete` errors map to `Hint` severity by default — does not
  paint red while the user types. Toggleable via LSP options.

### Q10 — "LSP" delivery: in-process functions, not a wire protocol

**Decision**: Define LSP-shaped APIs (`provideDiagnostics`,
`provideCompletions`, `provideHover`) returning `Promise<T>` of
custom-defined types, called as plain functions by the CodeMirror
extension. **No real LSP / jsonrpc / Web Worker boundary in v1.**

**Why**:
1. Filter schemas contain closures (`field.search`, `field.resolve`)
   which can't cross Worker / network boundaries. Any out-of-process
   transport would require schema serialisation / function reification
   pipeline that doesn't exist.
2. Dashboard filter documents are <1KB; full parse + analyze runs in
   <1ms on the main thread. postMessage overhead would *exceed* the
   work being offloaded.
3. The LSP vocabulary (`CompletionItem`, `Diagnostic`, `Hover`) is
   useful prior art; using it as the API shape preserves future
   migration paths to real LSP / Monaco / VSCode webviews via a thin
   adapter.

**Type definitions live in `@dql-kit/dql`**, not `vscode-languageserver-types`,
to keep the `@dql-kit/core` zero-dependency tradition.

### Q11 — Completion: slots, sources, ranking, insertion

Five slots are recognised by inspecting the cursor offset against the
RangeMap and surrounding tokens:

| Slot | Trigger | Source |
|---|---|---|
| **field** | doc start / after `and` / `or` / `(` / partial identifier in lvalue position | `Object.keys(schema.fields)` |
| **op** | after a recognised field token | `field.ops` |
| **value** | after `field op` / inside a value literal | typeId × valueShape × op derived |
| **continuation** | after a complete condition | `['and', 'or']` |
| **unit** | after `inLast NUMBER ` | `RELATIVE_UNITS` (with both singular and plural variants) |

**Sort** uses zero-padded indexes from each source's natural order
(schema declaration order for fields, `field.ops` order for ops,
`enumValues` order for enums, fetcher's return order for ids,
`['and', 'or']` for continuations). LSP `sortText` prevents client
re-ordering.

**Insertion behaviour** uses CM6 snippet placeholders `${0}` `${1}` so
that selecting an op immediately surfaces the value literal shape
(`between ${0}..${1}` etc.). The user learns the syntax by typing,
without needing docs.

**Field selection inserts a trailing space and auto-triggers the next
completion (op slot)** — flow continues without manual invocation.

**Id-field search** is debounced **150ms** (separate from
`useFilter.debounceMs` 250ms — different cost profile, different UX
target). Each call aborts the prior `AbortController`, consistent with
`IdFetcher`'s contract.

### Q12 — Two packages, no Vue wrapper

**Decision**: Two packages — `@dql-kit/dql` (parser + LSP) and
`@dql-kit/dql-codemirror` (CM6 extensions). No `@dql-kit/vue-dql`.

**Why**: CodeMirror brings 6 peer dependencies; isolating them in a
separate package mirrors `vue-router-sync`'s separation from
`vue-headless`. Splitting further (parser / lsp / codemirror as three
packages) is over-engineering — the LSP API has no heavy deps.

A Vue wrapper is omitted because mounting CM6 from Vue is a 30-line
`onMounted` / `onBeforeUnmount` boilerplate that would cost more in
maintained surface area than it saves users.

### Q13 — Syntax + semantic highlighting

**Decision**: Map our token kinds to `@lezer/highlight` `Tag`
constants; *additionally*, after analyze runs, paint
`unknown_field` / `unknown_op` / `value_type_mismatch` ranges with
`tags.invalid` so they stand out.

**Excluded from semantic override**: `incomplete` ranges. Painting red
text mid-typing is hostile; the (Hint-severity) diagnostic gutter is
sufficient signal.

**Default highlight style**: Exported as `defaultDqlHighlightStyle`
but **not** wired into the default extension array. Users opt in.
Themes are app-level concerns.

**Editor-shell defaults**: Bracket matching on; line numbers, folding,
indentation guides off (filter editor is single-line / few-line, not
a code editor).

### Q14 — Bidirectional sync protocol

**Decision**: **Focus arbitration** decides which side is the source
of truth at any instant.

| Editor focus state | Source of truth | Derived side |
|---|---|---|
| DQL editor has focus | CM buffer | `draft` ref (DQL → draft, debounced 100ms) |
| DQL editor has no focus | `draft` ref | CM buffer (draft → DQL, immediate, no debounce) |

**Specifics**:
- `DQL → draft`: every CM transaction triggers a debounced re-parse;
  if the new DraftAST differs structurally from `draft.value`, the
  ref is written. Debounce 100ms (cheaper than 150ms completion
  debounce because parse has no I/O).
- `draft → DQL`: a Vue `watch(draft)` on the consumer side fires
  `format(draft, schema)` and dispatches a CM full-replace transaction
  *only when* `view.hasFocus` is false. Mid-typing draft writes are
  swallowed — the buffer is the truth while focused.
- Focus loss: an immediate (non-debounced) parse flushes any pending
  buffer state to `draft`. The buffer is **not** auto-reformatted on
  blur — preserves the user's literal text. Reformatting is reserved
  for an explicit "Format" action (v2).
- Conflict (`draft` mutated externally while DQL is focused): swallow.
  Documented as application-level constraint that two simultaneous
  editing surfaces should not target the same filter.
- Empty buffer ⇄ empty draft (root group with no children).

### Q15 — Format (unparse) rules

**Decision**: Single-line compact output for v1. Pretty-print is v2.

| Aspect | Rule |
|---|---|
| Layout | Single line, no newlines |
| Keywords | Lowercase always |
| Strings | Double quotes always; JSON escape subset; embedded `\n` for raw newlines |
| Numbers | JSON number literal |
| Boolean | `true` / `false` |
| Enum values | Quoted strings (string enums) or bare numbers (number enums) |
| Id values | Numbers bare; strings quoted |
| Date / datetime | ISO strings, double-quoted |
| Pair `..` | `lo..hi` (no spaces around `..`) |
| List `[]` | `[a, b, c]` (single space after comma; no padding inside brackets; no trailing comma) |
| Relative | `7 days` (singular for amount === 1, plural otherwise) |
| Spacing | One space between `field`, op, value; one space around `and` / `or` |
| Parentheses | Root group never; non-root groups always (always different combinator from parent under Q5's strict mixed rule) |

**Incomplete conditions** (`field == null`, `op == null`, or
non-none-shape `value === undefined`): **dropped from the output**.
This is a v1 limitation, documented in the DQL editor's README. UI →
DQL transitions lose half-typed conditions; users complete them in
the FilterBuilder UI. Justification: introducing placeholder syntax
(`???`, `_`) breaks the "every formatted string is legal DQL"
invariant and forces parser tolerance for non-DQL tokens.

**Idempotence**: `parse(format(prune(draft))) ≡ prune(draft)`
structurally. `format` is *not* required to round-trip the original
text byte-for-byte (that's Q3's "lossless" alternative, deliberately
declined).

## Excluded from day-1 (deliberate)

These are NOT shortcuts; they are decisions that something belongs at
a later phase, with API hooks already preserved:

- **Lossless round-trip / comments / trivia preservation** (Q3) — would
  require a CST + trivia attachment + edit-time reconciliation.
- **Pretty-print multi-line formatter** (Q15) — single-line is fine for
  the typical 1–5-condition document.
- **Incomplete-condition placeholder syntax** (Q15) — UI is the
  authoritative editor for partial states in v1.
- **Web Worker-hosted LSP** (Q10) — needed only if document size or
  fetcher latency degrades main-thread responsiveness.
- **Real LSP over jsonrpc / Monaco / VSCode-webview adapter** (Q10) —
  thin adapters can be added when concrete need arises.
- **Backtick-escape for non-identifier field names** (Q8) — would
  contradict the zero-escape principle that earned the most user
  consensus.
- **`@dql-kit/vue-dql` package** (Q12) — boilerplate is small enough
  to keep in user code.
- **Incremental parse** (Q9) — full reparse is fast enough for the
  domain.
- **Formatter `--style=multiline`, syntax option for SQL `between A and B`,
  bare date literals**, etc. — explicitly considered, declined.

## Open questions for post-day-1

- Should `@dql-kit/dql-codemirror` ship a default keymap (e.g.
  Cmd+Shift+F for "Format")? Probably yes once Format-on-demand lands.
- Should the formatter expose a `pretty: boolean` option earlier than
  v2 if user feedback demands it?
- Cursor-stable AST → DQL writes (CM `ChangeSet` minimal-diff instead
  of full-replace) — needed if focus arbitration is loosened.

These are intentionally not designed yet — wait for real usage before
committing.
