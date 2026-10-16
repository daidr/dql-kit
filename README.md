# dql-kit

[English](./README.md) | [简体中文](./README_zhs.md)

Type-safe, schema-driven filter / query AST library for dashboards.

> **Status**: pre-1.0, not published to npm. Used in-tree by story-verse
> via `file:` workspace links. See [DESIGN.md](./DESIGN.md) for
> architectural decisions.

## Packages

| Package | Description |
|---|---|
| [`@dql-kit/core`](./packages/core) | Schema builders (`f.*`), AST types, `analyze` / `prune` / `validate`, `parseAst` for untrusted input, URL serialization. Zero ORM / framework / i18n deps. |
| [`@dql-kit/drizzle`](./packages/drizzle) | Drizzle ORM translator, **PostgreSQL only**. Parsed AST → `SQL` WHERE fragment. Custom ops are passed at construction; no mutating `registerOp`. |
| [`@dql-kit/vue-headless`](./packages/vue-headless) | `useFilter` composable + `createDqlKit` Vue plugin. Pluggable URL sync via `UrlAdapter` (`vue-router` not imported here). |
| [`@dql-kit/vue-router-sync`](./packages/vue-router-sync) | `vueRouterUrlAdapter()` — `UrlAdapter` for vue-router apps. |
| [`@dql-kit/vue-ui`](./packages/vue-ui) | Reference `<FilterPanel>` / `<FilterButton>` + built-in input renderers. Optional — apps usually wrap `useFilter` in their own components. |

## Architecture

```
schema (core)
  ├─→ analyze (core)         draft → { ast, errors } in one walk
  ├─→ parseAst (core)        untrusted JSON → CheckedAST | errors (same walk + limits)
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
// filter.dropped         — Nodes dropped while reading the URL, with the reason
// filter.search.setQuery(fieldKey, q) — drive id autocomplete
// filter.actions.{addCondition, updateNode, removeNode, clear, ...}
```

### 4. Translate AST to SQL on the backend

The translator only accepts a `CheckedAST`, the output of `parseAst`. Never
hand a request body to it directly: `parseAst` checks every field, op, value
type and size limit against the schema, so a bad request becomes a 400
instead of a SQL error.

```ts
import { parseAst } from '@dql-kit/core'
import { createDrizzleTranslator, drizzleOps } from '@dql-kit/drizzle'
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
    keyword: table.articles.title,  // placeholder; overridden by ops below
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

**PostgreSQL only.** The built-in op handlers emit PG-specific SQL (`ILIKE`,
`= ANY(col)`, `@>`, `cardinality`, `NOW() - INTERVAL`).

**`date` fields compare in UTC days.** `'2024-01-01'` becomes midnight UTC. On
a PG `date` column that's exact; on a `timestamp` column, `eq` / `before` /
`after` / `between` cut days at UTC midnight. Map `date` fields to `date`
columns, or use `datetime` when the local day matters.

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
