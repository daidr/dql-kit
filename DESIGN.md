# dql-kit Design Document

This document captures the architectural decisions that shaped dql-kit's day-1 API.
All decisions are explicit trade-offs; alternatives considered are recorded so future
contributors understand *why* the current shape exists, not just what it is.

## Vision

A type-safe, schema-driven filter library for dashboard list pages. Users declare
fields once, get: validated AST, URL state sync, type-safe SQL WHERE fragments,
and a Vue 3 UI — all sharing the same schema as source of truth.

Three pillars:

1. **Schema as single source of truth** — declare once, consumed by validator /
   serializer / SQL translator / UI renderer.
2. **AST is plain serializable data** — no functions, no class instances. Goes
   through URL, JSON, network without ceremony.
3. **Strict layering** — `core` knows nothing about ORMs or frameworks; adapters
   live in dedicated packages.

## Package boundaries

```
@dql-kit/core              ──► pure logic, zero deps beyond TS
   ├── builder/            f.string, f.number, ..., f.custom (delegateTo)
   ├── ast/                types, analyze, prune, validate, astEqual
   ├── url/                toUrl, fromUrl, version sniffer
   └── ops/                op metadata registry (no implementations)

@dql-kit/drizzle           ──► peerDeps: @dql-kit/core, drizzle-orm
   ├── translator          AST → SQL WHERE fragment (immutable, ops-as-option)
   └── ops                 op name → drizzle SQL builder (delegateTo-aware)

@dql-kit/vue-headless      ──► peerDeps: @dql-kit/core, vue
   ├── useFilter()         composable (analyze + astEqual + effectScope)
   ├── createDqlKit()      Vue plugin (renderers / opLabels / unitLabels)
   ├── UrlAdapter          generic URL sync contract (no router assumed)
   └── createMemoryUrlAdapter  reference adapter for tests / no-router setups

@dql-kit/vue-router-sync   ──► peerDeps: @dql-kit/vue-headless, vue-router
   └── vueRouterUrlAdapter()   `UrlAdapter` backed by useRoute / useRouter

@dql-kit/vue-ui            ──► peerDeps: @dql-kit/vue-headless, vue
   ├── <FilterBuilder>     reference UI (vertical-stack, popover-trigger)
   ├── built-in renderers  StringInput, NumberPairInput, IdAutocompleteInput, ...
   ├── builtinRenderers    per-typeId catalogue with default + per-shape entries
   └── resolveRenderer     (typeId, shape, { overrides, delegateTo })
```

`@dql-kit/core` MUST NOT import any ORM, Vue, or Node-only API. It runs in
browser, Node, edge runtimes alike.

`@dql-kit/vue-headless` MUST NOT import `vue-router`. URL sync is opt-in via
the `UrlAdapter` contract; vue-router integration lives in
`@dql-kit/vue-router-sync` so apps without vue-router (Nuxt, Next-style
file routing, hand-rolled history, no router at all) don't take the
dependency.

**No module-level shared state.** All registries (renderers, op labels,
relative-unit labels) live on a `DqlKitInstance` created via
`createDqlKit(...)` and provided through `app.use(...)`. Multiple Vue apps
(SSR, microfrontends, Storybook) install their own instances without
contaminating one another.

**Core is language-neutral.** Built-in op labels default to the op key
(`'eq'`, `'gt'`, ...). Localised labels are registered by the consuming
app via `createDqlKit({ opLabels: { eq: '等于', ... } })`. dql-kit ships
zero translated strings.

## Decisions (Q1–Q14)

### Q1 — Combinator semantics

**Decision**: `Group(combinator, children)` where `combinator ∈ {'and', 'or'}`.
Children may be either nested groups or leaf conditions. **No NOT operator.**

**Why**: AND/OR cover virtually all dashboard filter UX. NOT introduces:
mental complexity (users frequently misunderstand "NOT (A AND B)"), UI ambiguity
(toggle vs operator?), and SQL adapter burden. When a "not" semantic is needed,
op-level negation (`neq`, `notIn`, `notContains`) is sufficient and clearer.

### Q6 — Built-in field types (β tier + custom)

**Decision**: 8 built-in types + an extension hook.

| Type | Default ops |
|---|---|
| `string` | eq, neq, contains, startsWith, endsWith, isEmpty, notEmpty, in, notIn |
| `number` | eq, neq, gt, gte, lt, lte, between, in |
| `boolean` | eq |
| `enum<T>` | eq, neq, in, notIn |
| `date` | eq, before, after, between |
| `datetime` | before, after, between, inLast |
| `id<T>` | eq, neq, in, notIn (requires `search` + `resolve`) |
| `array<U>` | contains, notContains, containsAll, isEmpty, notEmpty |

`f.custom({ typeId, ops, ... })` for project-specific types (money, duration, etc.).

**Why split `date` vs `datetime`**: different SQL semantics, different UI controls
(calendar vs date-time picker), different relative-time semantics ("inLast 7d"
makes sense for datetime, less so for date). Mixing them is a perpetual timezone-
bug source.

**Why `id<T>` is first-class**: dashboard FK fields are extremely common. `id` differs
from `string` because the value flow is "display label, store id" — two-form rendering
is mandatory, not optional.

**Excluded** from day-1 built-ins: `bigint`, `decimal`, `json`, `duration`, `range`.
These are project-specific; force them through `f.custom(...)`. Avoid SQL-dialect
explosion in core.

### Q7 — Operator model

**Decisions**:

- **(a2)** Operator is a **string literal** in AST, with metadata in a central registry.
  AST stays pure data; metadata centralised for validation/UI/SQL.
- **(b3)** Each type owns its **default ops + renderers**. `f.string().withOps([...])`
  for incremental additions. `f.custom(...)` must declare its own op list.
- **(d2)** **SQL translation lives in the SQL adapter package**, not in `core`.
  Op name is the contract; implementations are swappable per dialect.

`valueShape ∈ { 'none', 'single', 'pair', 'list', 'relative' }` — purely a
*data-shape* descriptor. UI control selection is `(typeId, op) → component`,
owned by the type's renderer (so `date + between` → `<DateRangePicker>`,
`number + between` → two number inputs).

### Q8 — Schema declaration & cross-package contract

**Decisions**:

- **(a3)** Flat field record + group metadata: `defineFilterSchema({ fields, groups })`.
  AST keys are **always flat strings**; `groups` are UI-only.
- **(b1)** AST references fields **by string key**, not by reference. Required for
  serialization (URL, DB).
- **(c1)** AST does **not** carry type tags. Type info is looked up from schema.
- **(d)** `f.id` requires both `search(query, signal)` and `resolve(ids, signal)`.
  Both may be sync or async (return `Awaitable<T>`).
- URL serialization lives **in core**; pure logic, no deps.

```ts
const articleFilter = defineFilterSchema({
  fields: {
    title:       f.string({ label: '标题', group: 'basic' }),
    status:      f.enum(['draft', 'published', 'archived'], { group: 'basic' }),
    authorId:    f.id({ label: '作者', search: searchAuthors, resolve: resolveAuthors }),
    publishedAt: f.datetime({ group: 'time' }),
    tags:        f.array(f.string()),
  },
  groups: {
    basic: { label: '基本' },
    time:  { label: '时间' },
  },
})
```

### Q9 — DB column mapping & cross-table filtering

**Decisions**:

- **(a2)** Filter library produces a **WHERE fragment** only. User keeps control
  over `select`, joins, other where conditions, ordering, pagination.
- **(b2) + (b3)** Column mapping in adapter call, with auto-by-name + explicit override:

  ```ts
  const t = createDrizzleTranslator({ schema: articleFilter, table: articles })
  // Or with overrides for joined fields:
  const t = createDrizzleTranslator({
    schema: articleFilter,
    columns: {
      title:      articles.title,
      authorId:   articles.authorId,
      authorName: authors.name,   // joined column
    },
  })
  ```
- **(c)** Joins are the user's responsibility. Library exposes `astRefersTo(ast, fieldKey)`
  helper for conditional joins.
- **(d)** Core never sees ORM types. Translator is generic over `AnyColumn`.

Day-1 ships **only the Drizzle adapter**. Other adapters (Kysely, raw SQL) can
ship as separate packages following the same pattern.

### Q10 — Draft vs Valid AST

**Decisions**:

- **(a2)** Two AST type layers:

  ```ts
  // Editing state — fields/ops/values may be missing.
  type DraftCondition = { field: string | null, op: string | null, value?: unknown }
  type DraftGroup     = { combinator: 'and' | 'or', children: DraftNode[] }

  // Executable state — fully populated.
  type ValidCondition = { field: string, op: string, value: unknown }
  type ValidGroup     = { combinator: 'and' | 'or', children: ValidNode[] }
  ```
- Two transition functions:
  - `prune(draft) → ValidAST` — silently drops incomplete nodes; for live UI use.
  - `validate(draft) → { ok: true, ast } | { ok: false, errors }` — for explicit error reporting.
- **Empty AST** = empty root group `{ combinator: 'and', children: [] }`. Top-level
  group is the only Group exempt from flatten/prune — it persists even when empty.
- **Group flattening rules**:
  - Empty non-root group → drop.
  - Single-child group → hoist child to parent.
- **(c2)** URL synchronizes **only Valid AST**, never drafts. Drafts can be
  optionally persisted to sessionStorage via `useFilter({ persistDraft: 'session' })`.
- **(d3)** Deserialization is **lenient with reporting**:
  ```ts
  fromUrl(url, schema) → { ast: ValidAST, dropped: DroppedNode[] }
  ```
  Schema-incompatible nodes are dropped; UI may surface a notice.
- **(e)** ValidationError shape — 5 codes:

  ```ts
  type ValidationError =
    | { path: number[], code: 'unknown_field',        field: string }
    | { path: number[], code: 'op_not_allowed',       field: string, op: string }
    | { path: number[], code: 'value_type_mismatch',  expected: string, got: string }
    | { path: number[], code: 'value_shape_mismatch', op: string, expected: ValueShape }
    | { path: number[], code: 'incomplete',           missing: 'field' | 'op' | 'value' }
  ```

### Q11 — Vue UI binding

**Decisions**:

- **(a2)** Empty AST = empty root group. Top-level always exists.
- **(b3)** Two-stack API: low-level `useFilter` composable + high-level `<FilterBuilder>`.
- **(c)** Three customization layers:
  - **Slots**: `#condition`, `#operator`, `#value` for granular replacement.
  - **Type renderer registry**: `registerFieldRenderer(typeId, component)` — required
    for `f.custom(...)` types; optional override for built-ins.
  - **Variants**: day-1 ships **`vertical-stack`** and **`popover-trigger`**.
    Other layouts can be community contributions.
- **(d1)** URL sync defaults to using `useRoute / useRouter` (auto-imported).
  `useFilter({ sync: 'none' })` opts out. Per-instance `queryKey` for multi-filter
  pages.
- **(f)** Day-1 only supports static schema, but `useFilter` signature accepts
  `Schema | Ref<Schema | undefined>` for forward compatibility (no breaking change
  when async-schema support lands).

```ts
const filter = useFilter({
  schema: articleFilter,
  sync: 'url',          // default
  queryKey: 'filter',   // default
  debounceMs: 250,      // default
})

// Reactive surface:
filter.draft         // Ref<DraftAST>
filter.valid         // ComputedRef<ValidAST>  (deep cloned, no proxy leak)
filter.errors        // ComputedRef<ValidationError[]>
filter.search        // Ref<{ fieldKey, query, loading, error, results }>
filter.labelOf(fieldKey, id) → { status, label?, meta? }

// Imperative actions:
filter.actions.addCondition(parentPath, condition)
filter.actions.removeNode(path)
filter.actions.updateNode(path, partial)
filter.actions.addGroup(parentPath, combinator)
filter.actions.setCombinator(path, combinator)
filter.actions.clear()
filter.applyAst(ast)        // replace entire valid AST
filter.toJSON(): ValidAST   // snapshot for persistence
filter.invalidateLabels(fieldKey?)  // bust resolve cache
```

### Q12 — URL serialization format

**Decisions**:

- **(a2)** Compact-key JSON + URI encoding. Mapping:
  | full | compact |
  |---|---|
  | `combinator` | `c` |
  | `children`   | `n` |
  | `field`      | `f` |
  | `op`         | `o` |
  | `value`      | `v` |
- Combinator values stay as `'and' / 'or'` (readability > 2 bytes).
- **(c3)** Day-1 emits **bare AST** (no envelope). `fromUrl` includes a sniffer:
  ```ts
  if ('v' in parsed) return parseV1(parsed)  // future
  return parseV0(parsed)                       // day-1
  ```
  Future versions can add envelope `{ v: 1, ast: ... }` without breaking old URLs.
- **(d)** Value encoding conventions:
  - `date` → `"YYYY-MM-DD"` (ISO calendar date)
  - `datetime` → `"YYYY-MM-DDTHH:mm:ssZ"` (ISO instant)
  - `relative datetime` → `{ amount, unit }` object
  - `id<T>` → **id only**; label is async-resolved by UI via `resolve()`. URL stays
    short and shareable; recipient sees the filter activate immediately, labels fill in.
  - `array<U>` → JSON array
  - `none`-shape op → `v` field omitted entirely
- **(e)** Library does NOT manage `page` / `sort` / other query params. Each
  `useFilter` reserves its own `queryKey`; rest is the application's concern.

### Q13 — Async fetcher contract for `f.id`

**Decisions**:

- **Signature**:
  ```ts
  type Item<ID> = { id: ID, label: string, meta?: unknown }
  search:  (query: string,  signal: AbortSignal) => Awaitable<Item<ID>[]>
  resolve: (ids:   ID[],    signal: AbortSignal) => Awaitable<Item<ID>[]>
  ```
- **Search is debounced** in `useFilter` — default `250ms`, configurable via
  `debounceMs`. Set to `0` to disable.
- **Take-latest** with epoch + AbortController. Stale resolutions are dropped
  even when fetcher implementations don't honour the signal.
- **Resolve is invoked eagerly**: after schema/URL settle, `useFilter` collects
  every `id`-typed value in the AST, batches per-field, and fires `resolve(ids)`
  in parallel. Labels fill in within one round-trip.
- **Single search slot**: `filter.search` is one reactive object. Editing UI is
  expected to focus one field at a time (popover, inline editor). Resolve cache
  is global per-`useFilter`-instance, indexed by `(fieldKey, id)`.
- **Caching**:
  - Search results: NOT cached (input-driven, low hit rate, user can wrap in their
    own fetcher if needed).
  - Resolve results: in-memory, lifetime-of-instance, never expires. `invalidateLabels(fieldKey?)`
    busts manually.
- **Errors**:
  - Search failure → `filter.search.error` set; AST unaffected; UI offers retry.
  - Resolve failure → that id's `labelOf` returns `{ status: 'error' }`; UI falls
    back to displaying `'#' + id` unless type renderer overrides.
  - Partial resolve failures → returned `Item[]` simply omits failed ids; missing
    ids surface as `{ status: 'error' }` per id.
- **Sync fast path**: if fetcher returns a non-Promise, hook bypasses async
  scheduling — zero loading flicker for in-memory enums-as-ids.

### Q14 — i18n, AST mutability, saved filters, packaging

**Decisions**:

- **(a2)** Labels accept `string | (() => string)`. Reactive locale support comes
  for free via vue-i18n's reactive `t`. Core itself depends on no i18n library.
  Applies to all user-facing text: field labels, group labels, op labels,
  enum value labels.
- **(b3)** AST mutability strategy: **mutable inside, immutable outside**.
  - `filter.draft` is a deep-reactive `ref<DraftAST>` — UI can `v-model` directly.
  - `filter.valid` is `computed(() => structuredClone(toRaw(prune(draft.value))))`
    — translator/serializer always receive plain frozen-shape data, never proxies.
  - 7 actions methods (see Q11) cover all mutations the UI needs.
- **(c2)** Day-1 ships NO saved-filter persistence or preset UI. The hook exposes
  `applyAst(ast) / toJSON() / clear()` — sufficient primitives for any preset
  storage strategy (localStorage / backend / URL share). Persistence target and
  UI shape are application-layer concerns.
- **Packaging**:
  - New repo at `D:\devFolder\dql-kit\` (Bun workspaces).
  - Three packages: `@dql-kit/core`, `@dql-kit/drizzle`, `@dql-kit/vue`.
  - **Day-1 NOT published to npm**; consumed via `file:` workspace reference from
    story-verse. Publish after stabilisation.
  - Each package independent vitest. Core targets 100% coverage (pure functions).
- **Op registry** (final shape):
  ```ts
  // @dql-kit/core/src/ops/registry.ts
  export type OpDef = {
    name: string
    valueShape: ValueShape
    label: string | (() => string)
  }
  export const builtinOps: Record<string, OpDef>
  ```
  Drizzle adapter holds its own translator map keyed by op name. Custom ops
  require dual registration (schema-side `withOps` + translator-side
  `registerOp`) — explicit boundary, no hidden coupling.

## Excluded from day-1 (deliberate)

These are NOT shortcuts; they are decisions that something belongs at a different
layer or a later phase, with API hooks already preserved:

- NOT operator → use `neq` / `notIn` / `notContains` / `notEmpty`.
- `bigint` / `decimal` / `json` / `duration` / `range` field types → use `f.custom`.
- Tuple-N value shapes (N ≥ 3) → `between` is the only common pair op.
- Saved filter UI / persistence → application layer; primitives provided.
- Async schema (`Schema | Promise<Schema>`) → signature accepts the union but
  reconciliation logic ships in a later phase.
- Multi-search-slot UI (editing many id fields concurrently) → single-slot
  matches typical popover/dialog UX.
- Search result caching → users wrap own fetcher.
- Kysely / Prisma / raw-SQL adapters → separate packages, post-Drizzle stabilisation.

## Open questions for post-day-1

- Aggregations (HAVING-style filters)?
- Cross-row predicates (e.g., "articles with at least one comment containing X")?
- Field-level permissions (hide some fields per user role)?
- Server-side parsing API (`fromJSON` on Node without core's URL helper)?

These are intentionally not designed yet — wait for real usage before committing.
