# dql-kit

[English](./README.md) | [简体中文](./README_zhs.md)

Type-safe, schema-driven filter / query AST library for dashboards.

> **Status**: pre-1.0, not published to npm. Used in-tree by story-verse
> via `file:` workspace links. See [DESIGN.md](./DESIGN.md) for
> architectural decisions.

## Packages

| Package | Description |
|---|---|
| [`@dql-kit/core`](./packages/core) | Schema builders (`f.*`), AST types, `analyze` / `prune` / `validate`, `parseAst` for untrusted input, `toJsonSchema` for request bodies, URL serialization, `createMatcher` for in-memory filtering. Zero ORM / framework / i18n deps. |
| [`@dql-kit/drizzle-pg`](./packages/drizzle-pg) | Drizzle ORM translator for PostgreSQL. Parsed AST → `SQL` WHERE fragment. Custom ops are passed at construction; no mutating `registerOp`. |
| [`@dql-kit/drizzle-sqlite`](./packages/drizzle-sqlite) | The same translator for SQLite (arrays as JSON text, instants as ISO text or integer timestamps). |
| [`@dql-kit/drizzle-mysql`](./packages/drizzle-mysql) | The same translator for MySQL 8 (arrays as JSON columns, collation-driven case folding). |
| [`@dql-kit/typebox`](./packages/typebox) | `toTypeBox(schema)` — the `toJsonSchema` output as a TypeBox schema, e.g. for an Elysia route body. |
| [`@dql-kit/vue-headless`](./packages/vue-headless) | `useFilter` composable + `createDqlKit` Vue plugin. Pluggable URL sync via `UrlAdapter` (`vue-router` not imported here). |
| [`@dql-kit/vue-router-sync`](./packages/vue-router-sync) | `vueRouterUrlAdapter()` — `UrlAdapter` for vue-router apps. |
| [`@dql-kit/vue-ui`](./packages/vue-ui) | Reference `<FilterPanel>` / `<FilterButton>` / `<FilterChips>` + built-in input renderers. Optional — apps usually wrap `useFilter` in their own components. |

## Architecture

```
schema (core)
  ├─→ analyze (core)         draft → { ast, errors } in one walk
  ├─→ parseAst (core)        untrusted JSON → CheckedAST | errors (same walk + limits)
  ├─→ toJsonSchema (core)    request-body JSON Schema (→ TypeBox via @dql-kit/typebox)
  ├─→ URL serializer (core)
  ├─→ SQL translator (drizzle)
  └─→ UI renderer (vue-ui / app)
```

See [DESIGN.md](./DESIGN.md) for the full architecture rationale.

## Quickstart

### 1. Define a schema

```ts
import { defineFilterSchema, f, builtinOps } from '@dql-kit/core'

export const articleFilterSchema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    status: f.enum(['draft', 'published'] as const, { label: 'Status' }),
    authorId: f.id<number>({ label: 'Author' }),
    publishedAt: f.datetime({ label: 'Published at' }),
    tags: f.array(f.string()),
    keyword: f.custom({
      typeId: 'fulltext',
      // delegateTo: inherit string ops/UI/value-type checks; only the
      // SQL handler actually differs (cross-column ILIKE).
      delegateTo: 'string',
      ops: [builtinOps.contains],
    }),
  },
})
```

### 2. Install the Vue plugin

```ts
// main.ts
import { createApp } from 'vue'
import { createDqlKit } from '@dql-kit/vue-headless'

const dqlKit = createDqlKit({
  // Localise op names. Pass plain strings for static, or thunks for
  // reactive i18n (e.g. () => i18n.global.t('dql.op.eq')).
  opLabels: { eq: '等于', neq: '不等于', contains: '包含', /* ... */ },
  relativeUnitLabels: { day: '天', week: '周', month: '月' },
  // inPeriod input: this / previous / next / custom offset, and the units.
  periodLabels: { current: '本', previous: '上一', next: '下一', month: '月', quarter: '季度' },
  // Override built-in renderers or register custom typeId components.
  renderers: { fulltext: { default: MyFulltextInput } },
})

createApp(App).use(dqlKit).mount('#app')
```

### 3. Use the filter in a page

```ts
// posts.vue
import { useFilter } from '@dql-kit/vue-headless'
import { vueRouterUrlAdapter } from '@dql-kit/vue-router-sync'
import { articleFilterSchema } from './schema'

const filter = useFilter({
  schema: articleFilterSchema,
  // URL sync is opt-in. Default `'none'` keeps useFilter router-agnostic.
  sync: vueRouterUrlAdapter({ queryKey: 'filter' }),
  // 'manual' batches edits inside a popover until commit() runs.
  // 'auto' (default) writes through every keystroke.
  commitMode: 'manual',
  fetchers: {
    // Strict per-IdField fetchers — typed against the schema.
    authorId: {
      async search(query, signal) { /* hit /api/authors?q=... */ },
      async resolve(ids, signal)   { /* hit /api/authors?ids=... */ },
    },
  },
})

// filter.valid           — live ValidAST (auto) / pre-commit (manual)
// filter.committedValid  — what the URL / list-fetch should observe
// filter.errors          — ValidationError[]
// filter.dropped         — Nodes dropped while reading the URL (or on a schema switch), with the reason
// filter.search.setQuery(fieldKey, q) — drive id autocomplete
// filter.actions.{addCondition, updateNode, removeNode, clear, ...}
// filter.fieldGroups     — fields in the schema's `groups`, for a field picker
// filter.describe(ast?)  — human-readable summary (default: committedValid)
```

**Id fields.** A fetcher may give `searchPage(query, cursor, signal)` instead
of (or besides) `search`, returning `{ items, nextCursor? }`. The first page gets
`cursor: undefined`. Then `filter.search` has `hasMore` and `loadMore()`, and
the built-in id inputs show a "Load more" row. Picked ids are kept per field
(`recentIds: { limit: 8, persist: 'session' }`) and offered while the search
box is empty. Pasting a list (commas, semicolons, spaces or new lines) into the
multi-id input looks the ids up through `resolve`, which gets them as strings.
The ids it returns are added, up to the list limit, and the rest are listed as
not found. Texts are set with `createDqlKit({ idInputLabels })`.

**Field groups.** Give fields a `group` and declare `groups: { key: { label,
order } }` on the schema; `<FilterPanel>` then shows one `<optgroup>` per group
(ungrouped fields last, no headings when there is only one group).

**Schemas that load or change.** Pass `schema` as a ref to load it later or to
switch it (say, per role with `omitFields`). While the ref is `undefined`,
nothing is read or overwritten; the first schema reads the URL and the saved
draft. A switch removes conditions on fields the new schema lacks, reports
them in `filter.dropped` and keeps other uncommitted edits.

**Saved presets.** `usePresets({ filter, storage })` saves the committed filter
as `{ id, name, version, ast }` and applies it back through the schema's
migrations; conditions that no longer validate show up in `filter.dropped`.
`storage` is any `{ list, save, remove, rename }` (sync or async), e.g.
`createLocalPresetStorage('my-app:presets')` or calls to your API. vue-ui's
`<FilterPresets :presets="presets">` is a reference dropdown.

**Summaries and chips.** `describeAst(ast, schema)` from core returns a tree
mirroring the AST with field / op labels, the values split into parts, and a
`text` such as `Status in Draft, Published AND (Rating gt 3 OR …)`; it runs
anywhere, e.g. for audit logs. `filter.describe()` adds the plugin's op, unit
and period labels and id labels from the fetchers (`status: 'loading'` while
one is resolving). `<FilterChips :filter="filter">` from vue-ui lists the
committed root-level conditions as removable chips; removing one applies the
filter without it.

### 4. Translate AST to SQL on the backend

The translator only accepts a `CheckedAST`, the output of `parseAst`. Never
hand a request body to it directly: `parseAst` checks every field, op, value
type and size limit against the schema, so a bad request becomes a 400
instead of a SQL error.

```ts
import { parseAst } from '@dql-kit/core'
import { createDrizzleTranslator, drizzleOps } from '@dql-kit/drizzle-pg'
import { articleFilterSchema } from '@/schema'
import { table } from './db'

const translator = createDrizzleTranslator({
  schema: articleFilterSchema,
  columns: {
    title: table.articles.title,
    status: table.articles.status,
    authorId: table.articles.authorId,
    publishedAt: table.articles.publishedAt,
    tags: table.articles.tags,
    keyword: null,  // no column of its own: handled by the `contains` op below
  },
  // Custom op handlers passed at construction — no mutating `registerOp`.
  ops: {
    contains: (col, v, ctx) => {
      if (ctx.field.typeId === 'fulltext') {
        // Cross-column ILIKE for the keyword field.
        return sql`(${table.articles.title} ILIKE ${'%' + String(v) + '%'}
                    OR ${table.articles.content} ILIKE ${'%' + String(v) + '%'})`
      }
      // Other fields fall through to the built-in string handler.
      return drizzleOps.contains!(col, v, ctx)
    },
  },
})

// Use in a query. `body.filter` is untrusted JSON from the request.
// Limits default to { maxDepth: 8, maxNodes: 200, maxListLength: 100 }.
const parsed = parseAst(body.filter, articleFilterSchema)
if (!parsed.ok) throw new BadRequest(parsed.errors)
const rows = await db.select().from(table.articles).where(translator.toWhere(parsed.ast))
```

**Request body schema.** `toJsonSchema(schema)` describes the AST a schema
accepts (fields, their ops, value types, nesting unrolled to `maxDepth`) for
request validation and OpenAPI; `toTypeBox` from `@dql-kit/typebox` gives the
same as a TypeBox schema. It is never stricter than `parseAst` with the same
limits, but cannot express everything (total node count, datetime
parseability), so still run `parseAst` on the validated body.

```ts
import { toTypeBox } from '@dql-kit/typebox'

app.post('/articles/query', handler, {
  // `error` keeps Elysia's dev-mode validation message small; without it
  // Elysia expands every branch of every failed union.
  body: t.Object({
    filter: toTypeBox(articleFilterSchema, { schemaOptions: { error: 'Invalid filter' } }),
  }),
})
```

**PostgreSQL SQL.** The built-in op handlers emit PG-specific SQL (`ILIKE`,
`= ANY(col)`, `@>`, `&&`, `cardinality`, `NOW() - INTERVAL`). For SQLite and
MySQL use `@dql-kit/drizzle-sqlite` / `@dql-kit/drizzle-mysql` (below); the
API is the same.

**Strings ignore case by default.** Every string op, `eq` and `in` included,
compares case-insensitively (`lower(col) = lower(v)`, `ILIKE`). Pass
`f.string({ caseSensitive: true })` for exact comparison, which also lets `eq`
use a plain index; otherwise index `lower(col)` if you filter on it often.

**Nullable fields.** `f.number({ nullable: true })` (and every other builder
except `array`) adds `isEmpty` / `notEmpty`, which translate to `IS NULL` /
`IS NOT NULL`.

**`date` fields compare whole days.** `eq '2024-01-31'` becomes
`col >= 2024-01-31 AND col < 2024-02-01`, and `between` keeps all of its last
day, so a `date` field gives the same rows on a PG `date` column and on a
`timestamp` column. Days start at UTC midnight unless you pass a time zone
(below).

**Time zones and calendar periods.** `inPeriod` (on `date` and `datetime`
fields) matches a calendar period around today: `{ unit: 'month', offset: 0 }`
is this month, `{ unit: 'week', offset: -1 }` last week. Units are `day`,
`week`, `month`, `quarter` and `year`. Pass the zone where days start, and
optionally the first day of the week:

```ts
const translator = createDrizzleTranslator({
  schema: articleFilterSchema,
  table: articles,
  timeZone: 'Asia/Shanghai',  // IANA name; default UTC
  weekStartsOn: 1,            // 0 = Sunday … 6; default Monday
})
```

The zone sets the bounds of `inPeriod`, of "today" for relative ops on `date`
fields, and of `date` comparisons on timestamp columns; PG `date` columns hold
plain days and are not shifted. Bounds are computed in JS and sent as
parameters, so daylight-saving days have their real length (23 or 25 hours)
and the database session zone doesn't matter. `now()` pins the clock for these
bounds. Give `createMatcher` the same `timeZone` and `weekStartsOn`.

**Related rows.** `existsOp(build)` turns a subquery into `EXISTS (…)`, and
`notExistsOp` into `NOT EXISTS (…)`, for filters such as "has a comment
containing X". Give the field a custom op and map it to `null`:

```ts
import { existsOp } from '@dql-kit/drizzle-pg'

// schema
const anyCommentContains = defineOp('anyCommentContains', 'single', 'Any comment contains')
comments: f.custom({ typeId: 'relation', delegateTo: 'string', ops: [anyCommentContains] }),

// translator
columns: { /* … */ comments: null },
ops: {
  anyCommentContains: existsOp((v) =>
    db.select({ one: sql`1` }).from(table.comments).where(and(
      eq(table.comments.articleId, table.articles.id),
      ilike(table.comments.body, `%${String(v)}%`),
    ))),
},
```

A field mapped to `null` needs a custom handler for each of its ops (checked
when the translator is built), and those handlers get `col` as `undefined`.
`delegateTo: 'string'` gives the field a text input in the UI.

Counts and sums over related rows work the same way: the handler returns a
correlated scalar subquery, such as
``sql`(SELECT count(*) FROM ${comments} WHERE ${comments.articleId} = ${articles.id}) >= ${v}` ``
on a field with `delegateTo: 'number'`. Filters on grouped results (`HAVING`)
aren't modelled; see [ADR 0001](./docs/adr/0001-aggregate-filters.md).

**Negated ops keep NULL rows.** `neq`, `notIn` and `notContains` match rows
whose column is NULL ("status is not draft" includes rows with no status),
the same way `notEmpty` treats NULL as empty. See "Op semantics" in
[DESIGN.md](./DESIGN.md) for every op.

**Schema versions and renamed fields.** Old links and stored filters keep
working when the schema changes:

```ts
const schema = defineFilterSchema({
  version: 2,
  migrations: {
    // long-key JSON from version 1 to 2; runs on untrusted input
    1: (ast) => renameEnumValue(ast, 'status', 'live', 'published'),
  },
  fields: {
    title: f.string({ aliases: ['name'] }), // was `name`
    status: f.enum(['draft', 'published'] as const),
  },
})
```

With `version` set, `toUrl(ast, schema)` writes `{ v, a }` (`useFilter` passes
the schema). `fromUrl` reads bare links as version 0 and runs the remaining
migrations; a link from a newer version is `unsupported_version`. Pass
`{ fromVersion }` to `parseAst` for stored filters. `aliases` are read by
`parseAst` / `fromUrl`, not listed by `toJsonSchema`.

**Fields per role.** `pickFields(schema, keys)` and `omitFields(schema, keys)`
return a schema with a subset of the fields (unused groups dropped). Parse with
the role's schema and translate with the full one; render the same subset on
the front end. Out-of-role fields are rejected as `unknown_field`:

```ts
import { omitFields, parseAst } from '@dql-kit/core'

const forRole = (user: User) =>
  user.isAdmin ? articleFilterSchema : omitFields(articleFilterSchema, ['authorId'])

const parsed = parseAst(body.filter, forRole(user))
if (!parsed.ok) throw new BadRequest(parsed.errors)
const rows = await db.select().from(table.articles).where(translator.toWhere(parsed.ast))
```

Build each role's subset once at startup rather than per request: some
lookups are cached per schema object.

### SQLite and MySQL

`@dql-kit/drizzle-sqlite` and `@dql-kit/drizzle-mysql` export the same
`createDrizzleTranslator`, `drizzleOps`, `existsOp` / `notExistsOp` and
`columns: { field: null }` as the PG adapter, and pass the same op-semantics
suite. An op a dialect can't translate fails when the translator is built.
Relative ops on instants (`inLast` / `inNext` on `datetime` fields) are computed
from the translator's clock (`now`), not the database's.

**SQLite**
- Store instants as `toISOString()` text, or in `integer({ mode: 'timestamp' | 'timestamp_ms' })` columns.
- A `date` field on a text column holds `YYYY-MM-DD` days. Put a `date` field on a timestamp column to cut days in the translator's `timeZone`.
- Arrays are JSON text columns (`text({ mode: 'json' })`), queried with `json_each`.
- Case-insensitive ops use `lower()` / `LIKE`, which fold ASCII letters only. `caseSensitive` fields use `=`, `instr` and `substr`.

**MySQL 8.0.17+**
- Instants are sent as UTC literals, so store `DATETIME` values in UTC. `TIMESTAMP` columns need a UTC session (`SET time_zone = '+00:00'`, and a driver set to UTC). `DATE` columns hold plain days.
- Arrays are `JSON` columns, queried with `JSON_CONTAINS` / `JSON_OVERLAPS`.
- String ops follow the column's collation. With a `_ci` collation (the default), strings ignore case as on the other dialects; on a `_bin` or `_cs` column they don't. `caseSensitive` fields always compare as binary.

### 5. Filter rows in memory

`createMatcher` applies a parsed AST to rows you already have (a client-side
list, an optimistic update, a test fixture). It follows the same op
semantics as the SQL translator: a shared case suite runs both against the
same data.

```ts
import { createMatcher, parseAst } from '@dql-kit/core'

const matcher = createMatcher({ schema: articleFilterSchema })
const parsed = parseAst(filter, articleFilterSchema)
if (parsed.ok) {
  const visible = matcher.filter(parsed.ast, rows)  // or matcher.matches(ast, row)
}
```

Rows are read the way a database driver returns them: `null` / `undefined`
is NULL, `date` / `datetime` values may be `Date` objects or ISO strings.
Options: `get(row, fieldKey)` for other row shapes, `now()` to pin the clock
for relative ops and `inPeriod`, `timeZone` / `weekStartsOn` (as on the
translator), and `ops` for custom op matchers (the counterpart of the
translator's `ops`). On a `date` field a bare `YYYY-MM-DD` string is that day
and any other value is an instant cut to its day in `timeZone`; with a
non-UTC zone, read PG `date` columns as strings (`mode: 'string'`) rather than
as UTC-midnight `Date`s.

### 6. Typed ASTs

`ValidAST<typeof schema>` checks `field`, `op` and `value` together at
compile time. `analyze`, `prune`, `validate`, `fromUrl`, `parseAst` and
`useFilter().valid` / `committedValid` return ASTs typed by the schema they
checked against, and `translator.toWhere` only takes a `CheckedAST` of its
own schema (or of a subset of its fields).

```ts
import { defineOp, type ValidAST } from '@dql-kit/core'

const ast: ValidAST<typeof articleFilterSchema> = {
  combinator: 'and',
  children: [
    { field: 'status', op: 'in', value: ['draft'] },
    { field: 'authorId', op: 'eq', value: 42 },                // id<number>
    { field: 'publishedAt', op: 'inLast', value: { amount: 7, unit: 'day' } },
    // { field: 'status', op: 'contains', value: 'x' },        // error: op not allowed
    // { field: 'status', op: 'eq', value: 'archived' },       // error: not an enum value
  ],
}

// Narrowing on field, then op, narrows value:
// if (c.field === 'status' && c.op === 'in') c.value // ('draft' | 'published')[]
```

Op names and shapes are only known when the op keeps its literal type:
builtins do, and so does `defineOp('scoreAbove', 'single')`. An op list
annotated as `OpDef[]` still works but types that field loosely
(`op: string`, `value?: unknown`). Without a type argument, `ValidAST` is
the loose structural form, and typed ASTs are assignable to it.

## Development

```bash
bun install
bun run build        # core and drizzle dist are consumed by story-verse at runtime
bun run type-check
bun run test
```

CI (`.github/workflows/ci.yml`) runs the same build, type-check and test steps.

## Key design choices (short)

- **No NOT operator** — `neq` / `notIn` / `notContains` cover the use case; nesting NOT is a UX trap.
- **AST is plain JSON** — no functions, no class instances. Round-trips through URL / `JSON.parse`.
- **Two AST layers** — `DraftAST` (editing) and `ValidAST` (executable). `analyze` produces both at once.
- **One set of rules for every entry point** — `analyze` (drafts), `parseAst` (request bodies) and `fromUrl` (links) share one walker; `fromUrl` never throws.
- **`f.custom({ delegateTo })`** — custom typeIds inherit a builtin's UI / SQL / value-type behaviour by default; the typeId is only a routing tag for adapter overrides.
- **Single instance, no globals** — `createDqlKit({...})` returns a Vue plugin; per-app state lives there. Safe for SSR / multi-tenant.
- **URL sync is pluggable** — `useFilter({ sync })` accepts any `UrlAdapter` (memory, vue-router, custom). vue-router is in its own package.

## License

TBD
