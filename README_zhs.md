# dql-kit

[English](./README.md) | [简体中文](./README_zhs.md)

面向仪表盘场景的类型安全、Schema 驱动的过滤 / 查询 AST 库。

> **状态**：1.0 之前版本，未发布到 npm。story-verse 项目通过 `file:`
> workspace 链接在工程内引用。架构决策详见
> [DESIGN.md](./DESIGN.md)。

## 包结构

| Package | 描述 |
|---|---|
| [`@dql-kit/core`](./packages/core) | Schema 构建器（`f.*`）、AST 类型、`analyze` / `prune` / `validate`、解析不可信输入的 `parseAst`、生成请求体校验的 `toJsonSchema`、URL 序列化、内存过滤用的 `createMatcher`。零 ORM / 框架 / i18n 依赖。 |
| [`@dql-kit/drizzle-pg`](./packages/drizzle-pg) | Drizzle ORM 翻译器，**仅支持 PostgreSQL**。解析后的 AST → `SQL` WHERE 片段。自定义 op 在构造时传入；不存在会变更状态的 `registerOp`。 |
| [`@dql-kit/typebox`](./packages/typebox) | `toTypeBox(schema)` —— 把 `toJsonSchema` 的结果转成 TypeBox schema，例如用作 Elysia 路由的 body。 |
| [`@dql-kit/vue-headless`](./packages/vue-headless) | `useFilter` 组合式函数 + `createDqlKit` Vue 插件。通过 `UrlAdapter` 实现可插拔的 URL 同步（此处不引入 `vue-router`）。 |
| [`@dql-kit/vue-router-sync`](./packages/vue-router-sync) | `vueRouterUrlAdapter()` —— 面向 vue-router 应用的 `UrlAdapter`。 |
| [`@dql-kit/vue-ui`](./packages/vue-ui) | 参考实现 `<FilterPanel>` / `<FilterButton>` / `<FilterChips>` + 内置输入渲染器。可选 —— 应用通常会基于 `useFilter` 自行封装组件。 |

## 架构

```
schema (core)
  ├─→ analyze (core)         draft → { ast, errors }，单次遍历
  ├─→ parseAst (core)        不可信 JSON → CheckedAST | errors（同一遍走查 + 上限）
  ├─→ toJsonSchema (core)    请求体 JSON Schema（经 @dql-kit/typebox 转为 TypeBox）
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
  // inPeriod 输入框：本 / 上一 / 下一 / 自定义偏移，以及各单位。
  periodLabels: { current: '本', previous: '上一', next: '下一', month: '月', quarter: '季度' },
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
// filter.dropped         —— 读取 URL 时被丢弃的节点及原因
// filter.search.setQuery(fieldKey, q) —— 驱动 id 自动补全
// filter.actions.{addCondition, updateNode, removeNode, clear, ...}
// filter.fieldGroups     —— 按 schema 的 `groups` 分组的字段，供字段选择器使用
// filter.describe(ast?)  —— 可读的筛选摘要（默认描述 committedValid）
```

**字段分组。** 给字段设置 `group`，并在 schema 上声明 `groups: { key: { label,
order } }`，`<FilterPanel>` 就会为每个分组渲染一个 `<optgroup>`（未分组的字段排在
最后；只有一个分组时不显示分组标题）。

**保存的预设。** `usePresets({ filter, storage })` 把已提交的筛选保存为
`{ id, name, version, ast }`，应用时会先经过 schema 的 migrations；不再有效的条件会
出现在 `filter.dropped` 中。`storage` 可以是任何实现了 `{ list, save, remove, rename }`
的对象（同步或异步），例如 `createLocalPresetStorage('my-app:presets')`，或者调用
你自己的接口。vue-ui 的 `<FilterPresets :presets="presets">` 是一个参考下拉组件。

**摘要与筛选标签。** core 的 `describeAst(ast, schema)` 返回与 AST 结构一致的树，
包含字段 / op 标签、拆分后的值，以及类似 `Status in Draft, Published AND (Rating gt 3 OR …)`
的 `text`；它不依赖 UI，可用于审计日志等场景。`filter.describe()` 在此基础上使用
插件提供的 op、单位、周期标签，以及通过 fetcher 解析的 id 标签（解析中为
`status: 'loading'`）。vue-ui 的 `<FilterChips :filter="filter">` 把已提交的根级条件
显示为可删除的标签，删除后立即应用去掉该条件的筛选。

### 4. 在后端将 AST 翻译为 SQL

翻译器只接受 `parseAst` 返回的 `CheckedAST`。不要把请求体直接交给它：
`parseAst` 会按 schema 检查每个字段、op、值类型和大小上限，坏请求因此是 400，
而不是 SQL 报错。

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

// 在查询中使用。`body.filter` 是请求里不可信的 JSON。
// 上限默认 { maxDepth: 8, maxNodes: 200, maxListLength: 100 }。
const parsed = parseAst(body.filter, articleFilterSchema)
if (!parsed.ok) throw new BadRequest(parsed.errors)
const rows = await db.select().from(table.articles).where(translator.toWhere(parsed.ast))
```

**请求体 schema。** `toJsonSchema(schema)` 描述该 schema 接受的 AST（字段、
各字段允许的 op、值类型，嵌套按 `maxDepth` 展开），用于请求校验和 OpenAPI；
`@dql-kit/typebox` 的 `toTypeBox` 给出等价的 TypeBox schema。在相同上限下它
不会比 `parseAst` 更严格，但有些规则无法表达（节点总数、datetime 能否解析），
所以校验通过的请求体仍要交给 `parseAst`。

```ts
import { toTypeBox } from '@dql-kit/typebox'

app.post('/articles/query', handler, {
  // 设置 `error` 让 Elysia 开发模式下的校验报错保持简短；不设的话 Elysia
  // 会把每个失败 union 的所有分支都展开。
  body: t.Object({
    filter: toTypeBox(articleFilterSchema, { schemaOptions: { error: 'Invalid filter' } }),
  }),
})
```

**仅支持 PostgreSQL。** 内置 op 生成的是 PG 专有 SQL（`ILIKE`、`= ANY(col)`、
`@>`、`&&`、`cardinality`、`NOW() - INTERVAL`）。

**字符串默认不区分大小写。** 所有字符串 op（包括 `eq` 和 `in`）都不区分大小写
（`lower(col) = lower(v)`、`ILIKE`）。需要精确比较时用
`f.string({ caseSensitive: true })`，这样 `eq` 也能用上普通索引；否则如果经常按
该字段筛选，建议给 `lower(col)` 建表达式索引。

**可空字段。** `f.number({ nullable: true })`（除 `array` 外的所有构造器都支持）
会追加 `isEmpty` / `notEmpty`，翻译为 `IS NULL` / `IS NOT NULL`。

**`date` 字段按整天比较。** `eq '2024-01-31'` 会生成
`col >= 2024-01-31 AND col < 2024-02-01`，`between` 会包含最后一整天，因此
`date` 字段映射到 PG `date` 列和 `timestamp` 列得到的结果相同。未指定时区时，
一天从 UTC 零点开始（见下文）。

**时区与日历周期。** `inPeriod`（适用于 `date` 和 `datetime` 字段）匹配今天所在的
日历周期：`{ unit: 'month', offset: 0 }` 是本月，`{ unit: 'week', offset: -1 }`
是上周。单位有 `day`、`week`、`month`、`quarter`、`year`。传入一天开始的时区，
也可以指定一周的第一天：

```ts
const translator = createDrizzleTranslator({
  schema: articleFilterSchema,
  table: articles,
  timeZone: 'Asia/Shanghai',  // IANA 名称，默认 UTC
  weekStartsOn: 1,            // 0 = 周日 … 6，默认周一
})
```

时区决定 `inPeriod` 的边界、`date` 字段相对时间 op 里的“今天”，以及 `date`
字段在 timestamp 列上的比较；PG `date` 列存的是纯日期，不做偏移。边界在 JS 中
计算后以参数传入，所以夏令时切换当天按真实长度（23 或 25 小时）计算，也不受
数据库会话时区影响。`now()` 可以固定计算边界用的时钟。`createMatcher` 请传入相同的
`timeZone` 和 `weekStartsOn`。

**否定类 op 保留 NULL 行。** `neq`、`notIn`、`notContains` 会匹配列为 NULL 的
行（“状态不是草稿”包含没有状态的行），与 `notEmpty` 把 NULL 视为空的做法一致。
每个 op 的完整语义见 [DESIGN.md](./DESIGN.md) 的 “Op semantics”。

**Schema 版本与字段改名。** schema 变化后，旧链接和已保存的筛选仍然可用：

```ts
const schema = defineFilterSchema({
  version: 2,
  migrations: {
    // 把长键名 JSON 从版本 1 升级到 2；输入不可信
    1: (ast) => renameEnumValue(ast, 'status', 'live', 'published'),
  },
  fields: {
    title: f.string({ aliases: ['name'] }), // 原名 `name`
    status: f.enum(['draft', 'published'] as const),
  },
})
```

设置 `version` 后，`toUrl(ast, schema)` 输出 `{ v, a }`（`useFilter` 会传入
schema）。`fromUrl` 把没有信封的旧链接视为版本 0，并依次执行剩余的 migrations；来自
更新版本的链接返回 `unsupported_version`。读取已保存的筛选时给 `parseAst` 传
`{ fromVersion }`。`aliases` 只在 `parseAst` / `fromUrl` 读取时生效，不会出现在
`toJsonSchema` 的输出中。

### 5. 在内存中过滤数据

`createMatcher` 把解析后的 AST 应用到已有的数据上（前端本地列表、乐观更新、测试
数据）。它与 SQL 翻译器遵循同一套 op 语义：同一份共享用例会同时跑这两者。

```ts
import { createMatcher, parseAst } from '@dql-kit/core'

const matcher = createMatcher({ schema: articleFilterSchema })
const parsed = parseAst(filter, articleFilterSchema)
if (parsed.ok) {
  const visible = matcher.filter(parsed.ast, rows)  // 或 matcher.matches(ast, row)
}
```

行数据按数据库驱动返回的形式读取：`null` / `undefined` 视为 NULL，`date` /
`datetime` 的值可以是 `Date` 对象或 ISO 字符串。可选项：`get(row, fieldKey)`
读取其他结构的行，`now()` 固定相对时间 op 和 `inPeriod` 使用的时钟，
`timeZone` / `weekStartsOn` 与翻译器相同，`ops` 注册自定义 op 的求值函数（对应
翻译器的 `ops`）。`date` 字段的值如果是 `YYYY-MM-DD` 字符串就表示那一天，其他值
都视为时间点，按 `timeZone` 取所在的那一天；使用非 UTC 时区时，PG `date` 列请以
字符串形式读取（`mode: 'string'`），不要读成 UTC 零点的 `Date`。

### 6. 类型化 AST

`ValidAST<typeof schema>` 在编译期一起检查 `field`、`op` 和 `value`。
`analyze`、`prune`、`validate`、`fromUrl`、`parseAst` 以及
`useFilter().valid` / `committedValid` 返回的 AST 都按所校验的 schema 定型；
`translator.toWhere` 只接受它自己 schema（或其字段子集）的 `CheckedAST`。

```ts
import { defineOp, type ValidAST } from '@dql-kit/core'

const ast: ValidAST<typeof articleFilterSchema> = {
  combinator: 'and',
  children: [
    { field: 'status', op: 'in', value: ['draft'] },
    { field: 'authorId', op: 'eq', value: 42 },                // id<number>
    { field: 'publishedAt', op: 'inLast', value: { amount: 7, unit: 'day' } },
    // { field: 'status', op: 'contains', value: 'x' },        // 报错：字段不支持该 op
    // { field: 'status', op: 'eq', value: 'archived' },       // 报错：不在枚举值内
  ],
}

// 先按 field、再按 op 收窄，value 会随之收窄：
// if (c.field === 'status' && c.op === 'in') c.value // ('draft' | 'published')[]
```

只有 op 保留了字面量类型时才能推导出 op 名和值形状：内置 op 都保留，
`defineOp('scoreAbove', 'single')` 也会保留。标注成 `OpDef[]` 的 op 列表
照常可用，只是该字段退化为宽松类型（`op: string`、`value?: unknown`）。
不带类型参数的 `ValidAST` 是宽松结构，类型化 AST 可以直接赋给它。

## 开发

```bash
bun install
bun run build        # story-verse 运行时会加载 core 和 drizzle 的 dist
bun run type-check
bun run test
```

CI（`.github/workflows/ci.yml`）跑同样的 build、type-check 和 test。

## 关键设计选择（速览）

- **不提供 NOT 操作符** —— `neq` / `notIn` / `notContains` 已覆盖实际需求；嵌套 NOT 在 UX 上是个陷阱。
- **AST 是纯 JSON** —— 不含函数、不含类实例。能完整往返 URL / `JSON.parse`。
- **AST 双层模型** —— `DraftAST`（编辑态）与 `ValidAST`（可执行态）。`analyze` 一次遍历同时产出两者。
- **`f.custom({ delegateTo })`** —— 自定义 typeId 默认继承某个内置类型的 UI / SQL / 值类型行为；typeId 仅作为 adapter override 的路由标签。
- **单实例，无全局状态** —— `createDqlKit({...})` 返回一个 Vue 插件，应用级状态封装其中。可安全用于 SSR / 多租户。
- **URL 同步可插拔** —— `useFilter({ sync })` 接受任意 `UrlAdapter`（memory、vue-router、自定义实现）。vue-router 拆分到独立包。

## License

待定
