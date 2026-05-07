import { builtinOps } from './ops.ts'
import type {
  ArrayField,
  BooleanField,
  DateField,
  DateTimeField,
  EnumField,
  FieldDef,
  IdField,
  Label,
  NumberField,
  OpDef,
  StringField,
} from './types.ts'

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

// `withOps` mutates ops in-place via spread. Generic over the concrete
// per-typeId interface so chaining preserves the narrow type
// (e.g. `f.string().withOps([...])` still returns StringField).
const augment = <T extends FieldDef>(field: T): T & { withOps(extra: OpDef[]): T } =>
  Object.assign(field, {
    withOps(extra: OpDef[]): T {
      return augment({ ...field, ops: [...field.ops, ...extra] }) as T
    },
  })

export const f = {
  string(opts: CommonOpts = {}): StringField {
    return augment({ typeId: 'string', ops: opSets.string, ...opts } as StringField)
  },
  number(opts: CommonOpts = {}): NumberField {
    return augment({ typeId: 'number', ops: opSets.number, ...opts } as NumberField)
  },
  boolean(opts: CommonOpts = {}): BooleanField {
    return augment({ typeId: 'boolean', ops: opSets.boolean, ...opts } as BooleanField)
  },
  enum<V extends string | number>(
    values: ReadonlyArray<V>,
    opts: EnumOpts<V> = {},
  ): EnumField<V> {
    const enumValues = values.map((v) => {
      const label = opts.valueLabels?.[v]
      return label === undefined ? { value: v } : { value: v, label }
    })
    return augment({
      typeId: 'enum',
      ops: opSets.enum,
      enumValues,
      ...(opts.label !== undefined && { label: opts.label }),
      ...(opts.group !== undefined && { group: opts.group }),
    } as EnumField<V>)
  },
  date(opts: CommonOpts = {}): DateField {
    return augment({ typeId: 'date', ops: opSets.date, ...opts } as DateField)
  },
  datetime(opts: CommonOpts = {}): DateTimeField {
    return augment({ typeId: 'datetime', ops: opSets.datetime, ...opts } as DateTimeField)
  },
  // ID phantom is preserved through the return type so consumers reading
  // `schema.fields.authorId` get back `IdField<number>` (or whatever ID
  // they declared), even though the stored runtime FieldDef has no ID
  // field.
  id<ID extends string | number = string | number>(
    opts: CommonOpts = {},
  ): IdField<ID> {
    return augment({ typeId: 'id', ops: opSets.id, ...opts } as IdField<ID>)
  },
  array<Item extends FieldDef>(
    itemType: Item,
    opts: CommonOpts = {},
  ): ArrayField<Item> {
    return augment({
      typeId: 'array',
      ops: opSets.array,
      itemType,
      ...opts,
    } as ArrayField<Item>)
  },
  custom(opts: CustomOpts): FieldDef {
    return augment({
      typeId: opts.typeId,
      ops: opts.ops,
      ...(opts.label !== undefined && { label: opts.label }),
      ...(opts.group !== undefined && { group: opts.group }),
    })
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
