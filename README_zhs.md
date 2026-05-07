# dql-kit

[English](./README.md) | [简体中文](./README_zhs.md)

面向仪表盘场景的类型安全、Schema 驱动的过滤 / 查询 AST 库。

> **状态**：1.0 之前版本，未发布到 npm。story-verse 项目通过 `file:`
> workspace 链接在工程内引用。架构决策详见
> [DESIGN.md](./DESIGN.md)。

## 包结构

| Package | 描述 |
|---|---|
| [`@dql-kit/core`](./packages/core) | Schema 构建器（`f.*`）、AST 类型、`analyze` / `prune` / `validate`、URL 序列化。零 ORM / 框架 / i18n 依赖。 |
| [`@dql-kit/drizzle`](./packages/drizzle) | Drizzle ORM 翻译器。AST → `SQL` WHERE 片段。自定义 op 在构造时传入；不存在会变更状态的 `registerOp`。 |
| [`@dql-kit/vue-headless`](./packages/vue-headless) | `useFilter` 组合式函数 + `createDqlKit` Vue 插件。通过 `UrlAdapter` 实现可插拔的 URL 同步（此处不引入 `vue-router`）。 |
| [`@dql-kit/vue-router-sync`](./packages/vue-router-sync) | `vueRouterUrlAdapter()` —— 面向 vue-router 应用的 `UrlAdapter`。 |
| [`@dql-kit/vue-ui`](./packages/vue-ui) | 参考实现 `<FilterBuilder>` + 内置输入渲染器。可选 —— 应用通常会基于 `useFilter` 自行封装组件。 |

## 架构

```
schema (core)
  ├─→ analyze (core)         draft → { ast, errors }，单次遍历
  ├─→ URL serializer (core)
  ├─→ SQL translator (drizzle)
  └─→ UI renderer (vue-ui / app)
```

完整架构动机详见 [DESIGN.md](./DESIGN.md)。

## 快速上手

### 1. 定义 schema

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
      // delegateTo：继承 string 的 ops / UI / 值类型校验；
      // 实际差异只在 SQL handler（跨列 ILIKE）。
      delegateTo: 'string',
      ops: [builtinOps.contains],
    }),
  },
})
```

### 2. 安装 Vue 插件

```ts
// main.ts
import { createApp } from 'vue'
import { createDqlKit } from '@dql-kit/vue-headless'

const dqlKit = createDqlKit({
  // 本地化 op 名称。静态文本可直接传字符串；
  // 需要响应式 i18n 时传 thunk（如 () => i18n.global.t('dql.op.eq')）。
  opLabels: { eq: '等于', neq: '不等于', contains: '包含', /* ... */ },
  relativeUnitLabels: { day: '天', week: '周', month: '月' },
  // 覆盖内置渲染器或为自定义 typeId 注册组件。
  renderers: { fulltext: { default: MyFulltextInput } },
})

createApp(App).use(dqlKit).mount('#app')
```

### 3. 在页面中使用 filter

```ts
// posts.vue
import { useFilter } from '@dql-kit/vue-headless'
import { vueRouterUrlAdapter } from '@dql-kit/vue-router-sync'
import { articleFilterSchema } from './schema'

const filter = useFilter({
  schema: articleFilterSchema,
  // URL 同步是按需启用的。默认值 `'none'` 让 useFilter 与 router 解耦。
  sync: vueRouterUrlAdapter({ queryKey: 'filter' }),
  // 'manual'：在 popover 中批量编辑，调用 commit() 才生效。
  // 'auto'（默认）：每次输入都直接写入。
  commitMode: 'manual',
  fetchers: {
    // 严格按 IdField 区分的 fetcher —— 与 schema 类型对齐。
    authorId: {
      async search(query, signal) { /* 调用 /api/authors?q=... */ },
      async resolve(ids, signal)   { /* 调用 /api/authors?ids=... */ },
    },
  },
})

// filter.valid           —— 实时 ValidAST（auto 模式 / manual 模式 commit 前）
// filter.committedValid  —— URL / 列表查询应观察的值
// filter.errors          —— ValidationError[]
// filter.dropped         —— URL → schema 不匹配时被静默丢弃的节点
// filter.search.setQuery(fieldKey, q) —— 驱动 id 自动补全
// filter.actions.{addCondition, updateNode, removeNode, clear, ...}
```

### 4. 在后端将 AST 翻译为 SQL

```ts
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
    keyword: table.articles.title,  // 占位列，会被下方的 ops 覆盖
  },
  // 自定义 op handler 在构造时传入 —— 不存在会变更状态的 `registerOp`。
  ops: {
    contains: (col, v, ctx) => {
      if (ctx.field.typeId === 'fulltext') {
        // keyword 字段使用跨列 ILIKE。
        return sql`(${table.articles.title} ILIKE ${'%' + String(v) + '%'}
                    OR ${table.articles.content} ILIKE ${'%' + String(v) + '%'})`
      }
      // 其他字段回退到内置的 string handler。
      return drizzleOps.contains!(col, v, ctx)
    },
  },
})

// 在查询中使用：
const rows = await db.select().from(table.articles).where(translator.toWhere(ast))
```

## 开发

```bash
bun install
bun run type-check
bun run test
```

## 关键设计选择（速览）

- **不提供 NOT 操作符** —— `neq` / `notIn` / `notContains` 已覆盖实际需求；嵌套 NOT 在 UX 上是个陷阱。
- **AST 是纯 JSON** —— 不含函数、不含类实例。能完整往返 URL / `JSON.parse`。
- **AST 双层模型** —— `DraftAST`（编辑态）与 `ValidAST`（可执行态）。`analyze` 一次遍历同时产出两者。
- **`f.custom({ delegateTo })`** —— 自定义 typeId 默认继承某个内置类型的 UI / SQL / 值类型行为；typeId 仅作为 adapter override 的路由标签。
- **单实例，无全局状态** —— `createDqlKit({...})` 返回一个 Vue 插件，应用级状态封装其中。可安全用于 SSR / 多租户。
- **URL 同步可插拔** —— `useFilter({ sync })` 接受任意 `UrlAdapter`（memory、vue-router、自定义实现）。vue-router 拆分到独立包。

## License

待定
