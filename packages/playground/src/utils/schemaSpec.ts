import { f, defineFilterSchema } from '@dql-kit/core'
import type { FieldDef, FilterSchema, IdFetcher, Item } from '@dql-kit/core'

export type FieldSpec =
  | { type: 'string', label?: string, group?: string }
  | { type: 'number', label?: string, group?: string }
  | { type: 'boolean', label?: string, group?: string }
  | {
      type: 'enum'
      values: Array<string | number>
      label?: string
      group?: string
    }
  | { type: 'date', label?: string, group?: string }
  | { type: 'datetime', label?: string, group?: string }
  | { type: 'id', label?: string, group?: string }
  | {
      type: 'array'
      itemType: 'string' | 'number'
      label?: string
      group?: string
    }

export type GroupSpec = { label?: string, order?: number }

export type SchemaSpec = {
  fields: Record<string, FieldSpec>
  groups?: Record<string, GroupSpec>
}

const MOCK_AUTHORS: Item<number>[] = [
  { id: 1, label: 'Alice'   },
  { id: 2, label: 'Bob'     },
  { id: 3, label: 'Charlie' },
  { id: 4, label: 'Dave'    },
  { id: 5, label: 'Eve'     },
  { id: 6, label: 'Frank'   },
  { id: 7, label: 'Grace'   },
  { id: 8, label: 'Heidi'   },
]

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export const mockIdFetcher = (
  pool: Item<number>[] = MOCK_AUTHORS,
  delayMs = 200,
): IdFetcher<number> => ({
  async search(query, signal) {
    await wait(delayMs)
    if (signal.aborted) return []
    const q = query.trim().toLowerCase()
    if (q === '') return pool.slice(0, 10)
    return pool.filter((it) => it.label.toLowerCase().includes(q))
  },
  async resolve(ids, signal) {
    await wait(delayMs)
    if (signal.aborted) return []
    return pool.filter((it) => ids.includes(it.id))
  },
})

const buildField = (spec: FieldSpec): FieldDef => {
  const common: { label?: string, group?: string } = {}
  if (spec.label !== undefined) common.label = spec.label
  if (spec.group !== undefined) common.group = spec.group

  switch (spec.type) {
    case 'string':
      return f.string(common)
    case 'number':
      return f.number(common)
    case 'boolean':
      return f.boolean(common)
    case 'enum':
      return f.enum(spec.values, common)
    case 'date':
      return f.date(common)
    case 'datetime':
      return f.datetime(common)
    case 'id':
      return f.id<number>(common)
    case 'array': {
      const item =
        spec.itemType === 'number' ? f.number() : f.string()
      return f.array(item, common)
    }
  }
}

export const buildSchemaFromSpec = (spec: SchemaSpec): FilterSchema => {
  const fields: Record<string, FieldDef> = {}
  for (const [key, fieldSpec] of Object.entries(spec.fields)) {
    fields[key] = buildField(fieldSpec)
  }
  const groups: Record<string, { label?: string, order?: number }> = {}
  for (const [key, g] of Object.entries(spec.groups ?? {})) {
    const entry: { label?: string, order?: number } = {}
    if (g.label !== undefined) entry.label = g.label
    if (g.order !== undefined) entry.order = g.order
    groups[key] = entry
  }
  return defineFilterSchema({ fields, groups })
}

export const buildFetcherMap = (
  spec: SchemaSpec,
): Record<string, IdFetcher<number>> => {
  const map: Record<string, IdFetcher<number>> = {}
  for (const [key, fieldSpec] of Object.entries(spec.fields)) {
    if (fieldSpec.type === 'id') {
      map[key] = mockIdFetcher()
    }
  }
  return map
}

export const defaultSpec: SchemaSpec = {
  fields: {
    title:       { type: 'string',  label: '标题',  group: 'basic' },
    status:      { type: 'enum',    label: '状态',  group: 'basic', values: ['draft', 'published', 'archived'] },
    views:       { type: 'number',  label: '阅读数', group: 'basic' },
    isPinned:    { type: 'boolean', label: '置顶' },
    authorId:    { type: 'id',      label: '作者' },
    publishedAt: { type: 'datetime', label: '发布时间', group: 'time' },
    tags:        { type: 'array',   label: '标签', itemType: 'string' },
  },
  groups: {
    basic: { label: '基本' },
    time:  { label: '时间' },
  },
}
