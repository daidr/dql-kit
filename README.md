# dql-kit

Type-safe, schema-driven filter / query AST library for dashboards.

> **Status**: scaffold (Q1–Q14 design decisions locked, see [DESIGN.md](./DESIGN.md))

## Packages

| Package | Description |
|---|---|
| [`@dql-kit/core`](./packages/core) | Schema builders, AST types, validation, URL serialization. Zero ORM / framework dependencies. |
| [`@dql-kit/drizzle`](./packages/drizzle) | Drizzle ORM translator: AST → `SQL` WHERE fragment. |
| [`@dql-kit/vue`](./packages/vue) | Vue 3 composable + components: `useFilter`, `<FilterBuilder>`. |

## Architecture

```
schema (core)
  ├─→ AST validator / prune (core)
  ├─→ URL serializer (core)
  ├─→ SQL translator (drizzle)
  └─→ UI renderer (vue)
```

See [DESIGN.md](./DESIGN.md) for the full architecture rationale.

## Development

```bash
bun install
bun run type-check
bun run test
```

## License

TBD
