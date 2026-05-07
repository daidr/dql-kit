import { builtinOps } from './ops.ts'
import type { FieldDef, Label, OpDef } from './types.ts'

type CommonOpts = { label?: Label, group?: string }

type EnumOpts<V extends string | number> = CommonOpts & {
  valueLabels?: Partial<Record<V, Label>>
}

type CustomOpts = CommonOpts & {
  typeId: string
  ops: OpDef[]
}

const opSets = {
  string:   [
    builtinOps.eq, builtinOps.neq, builtinOps.contains, builtinOps.notContains,
    builtinOps.startsWith, builtinOps.endsWith, builtinOps.isEmpty,
    builtinOps.in, builtinOps.notIn,
  ],
  number:   [
    builtinOps.eq, builtinOps.neq, builtinOps.gt, builtinOps.gte, builtinOps.lt, builtinOps.lte,
    builtinOps.between, builtinOps.in,
  ],
  boolean:  [builtinOps.eq],
  enum:     [builtinOps.eq, builtinOps.neq, builtinOps.in, builtinOps.notIn],
  date:     [builtinOps.eq, builtinOps.before, builtinOps.after, builtinOps.between],
  datetime: [builtinOps.before, builtinOps.after, builtinOps.between, builtinOps.inLast],
  id:       [builtinOps.eq, builtinOps.neq, builtinOps.in, builtinOps.notIn],
  array:    [builtinOps.contains, builtinOps.notContains, builtinOps.containsAll, builtinOps.isEmpty],
}

const make = (def: FieldDef): FieldDef => def

const augment = <T extends FieldDef>(field: T) =>
  Object.assign(field, {
    withOps(extra: OpDef[]): T {
      return augment({ ...field, ops: [...field.ops, ...extra] }) as T
    },
  })

export const f = {
  string(opts: CommonOpts = {}): FieldDef {
    return augment(make({ typeId: 'string', ops: opSets.string, ...opts }))
  },
  number(opts: CommonOpts = {}): FieldDef {
    return augment(make({ typeId: 'number', ops: opSets.number, ...opts }))
  },
  boolean(opts: CommonOpts = {}): FieldDef {
    return augment(make({ typeId: 'boolean', ops: opSets.boolean, ...opts }))
  },
  enum<V extends string | number>(values: ReadonlyArray<V>, opts: EnumOpts<V> = {}): FieldDef {
    const enumValues = values.map((v) => {
      const label = opts.valueLabels?.[v]
      return label === undefined ? { value: v } : { value: v, label }
    })
    return augment(make({ typeId: 'enum', ops: opSets.enum, enumValues, ...opts }))
  },
  date(opts: CommonOpts = {}): FieldDef {
    return augment(make({ typeId: 'date', ops: opSets.date, ...opts }))
  },
  datetime(opts: CommonOpts = {}): FieldDef {
    return augment(make({ typeId: 'datetime', ops: opSets.datetime, ...opts }))
  },
  id(opts: CommonOpts = {}): FieldDef {
    return augment(make({ typeId: 'id', ops: opSets.id, ...opts }))
  },
  array(itemType: FieldDef, opts: CommonOpts = {}): FieldDef {
    return augment(make({ typeId: 'array', ops: opSets.array, itemType, ...opts }))
  },
  custom(opts: CustomOpts): FieldDef {
    return augment(make({
      typeId: opts.typeId,
      ops: opts.ops,
      ...(opts.label !== undefined && { label: opts.label }),
      ...(opts.group !== undefined && { group: opts.group }),
    }))
  },
}

export type DefineFilterSchemaInput<F extends Record<string, FieldDef>> = {
  fields: F
  groups?: Record<string, { label?: Label, order?: number }>
}

export const defineFilterSchema = <F extends Record<string, FieldDef>>(
  spec: DefineFilterSchemaInput<F>,
) => ({
  fields: spec.fields,
  groups: spec.groups ?? {},
})
