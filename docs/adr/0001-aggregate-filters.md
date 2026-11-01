# ADR 0001: Aggregate (HAVING-style) filters

- **Status:** Deferred. Revisit when one of the triggers below is met.
- **Date:** 2026-11-01
- **Issue:** #40

## Context

A filter AST describes a predicate on **one row**. Every adapter turns it into a
`WHERE` fragment, and `createMatcher` applies it to one row at a time. Two kinds
of request reach past that:

1. **Aggregates over related rows, per parent row.** For example, "articles with
   at least 3 comments" or "customers whose total order amount is over 1000".
   The result is still a list of parent rows, and the predicate is still
   per parent row. It only needs data from other tables.
2. **Filters on grouped results.** For example, a report grouped by author that
   keeps only authors with more than 10 published articles. The query has a
   `GROUP BY`, and the filter applies to each group through `HAVING`, not to
   rows.

The roadmap asked whether dql-kit should model either kind. Three options were
considered.

## Options

### A. Aggregate nodes inside the AST

Add a node kind such as `{ aggregate: 'count', over: 'comments', op: 'gte', value: 3 }`,
or aggregate field types whose values are computed.

- **Pro:** the UI could offer "count of X" generically, and URLs could carry it.
- **Con:** every layer grows a second evaluation model. `parseAst`, the URL
  format, `describe`, the Vue renderers, the matcher (which would need the
  related rows) and every adapter (which would need to know the relation's
  join keys) would all have to understand it.
- **Con:** the schema would have to describe relations and their join columns,
  which today live only in the app's database layer. That breaks the rule that
  `core` knows nothing about storage (DESIGN, "Package boundaries").
- **Con:** mixing row predicates and group predicates in one tree has no clear
  meaning. A `HAVING` condition under an `or` with a `WHERE` condition can't be
  split into the two clauses.

### B. A separate "having" schema

Keep the row AST as it is, and add a second schema whose fields are the
aggregate columns of a grouped query (`articleCount`, `totalAmount`). The app
would parse two ASTs, translate one into `WHERE` and the other into `HAVING`.

- **Pro:** clean semantics. Each AST applies to one clause, and the existing
  field types, ops, URL format and UI work for the aggregate fields unchanged.
- **Pro:** almost nothing new is needed in `core`. A second schema is already
  possible today. What's missing is a translator that maps fields to aggregate
  expressions (`count(*)`, `sum(amount)`) instead of columns, and a way for
  `useFilter` to hold and sync two ASTs under one URL key.
- **Con:** only useful for apps that show grouped reports. No current user does.
- **Con:** the URL envelope and `useFilter` state would need a second slot,
  which is a format change for an unproven need.

### C. Per-row aggregates through custom ops and subqueries

Cover kind 1 with what already exists. A custom op on a field mapped to `null`
in `columns` can return any SQL, including a correlated subquery:

```ts
// schema
const commentCountAtLeast = defineOp('commentCountAtLeast', 'single', 'At least N comments')
comments: f.custom({ typeId: 'relation', delegateTo: 'number', ops: [commentCountAtLeast] }),

// translator
columns: { /* … */ comments: null },
ops: {
  commentCountAtLeast: (_col, v) => sql`(
    SELECT count(*) FROM ${table.comments}
    WHERE ${table.comments.articleId} = ${table.articles.id}
  ) >= ${v}`,
},
```

`existsOp` / `notExistsOp` (M8) cover the "at least one" and "none" cases, and
the scalar subquery above covers counts and sums.

- **Pro:** nothing new to build, maintain or version. The field is an ordinary
  field to the parser, the URL format and the UI.
- **Pro:** the app writes the join, so `core` still knows nothing about
  relations.
- **Con:** each aggregate needs a handwritten op, and the matcher needs a
  matching custom op if the app filters in memory.
- **Con:** doesn't cover kind 2. A grouped report still has to build its
  `HAVING` clause itself.

## Decision

Don't add aggregate support yet. Use option C for per-row aggregates, and
document the scalar-subquery pattern next to `existsOp`. Grouped-result filters
(kind 2) stay out of scope.

If kind 2 is needed later, option B is preferred over option A. It keeps one
evaluation model per AST and reuses every existing layer.

## Triggers for revisiting

Reopen this decision when any of these happens:

- An app needs users to filter **grouped** results (a report or a dashboard
  with `GROUP BY`) through the filter UI or the URL, not just through fixed
  server code.
- Apps define several handwritten aggregate ops that differ only in the
  aggregate function or the related table. A generic helper, for example
  `aggregateOp({ from, on, select })` beside `existsOp`, would then pay for
  itself without changing the AST.
- The in-memory matcher has to evaluate aggregate fields for real, which means
  rows would need to carry their related rows.

## Consequences

- The AST, the URL format and `parseAst` don't change.
- Per-row aggregates are app code, written as custom ops. The README
  "Related rows" section shows the pattern.
- A future `HAVING` translator would be additive. It would be a new translator
  over a second schema, not a change to the existing one.
