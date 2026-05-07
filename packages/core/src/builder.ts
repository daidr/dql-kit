import { builtinOps } from './ops.ts'
import type {
  ArrayField,
  BooleanField,
  BuiltinFieldTypeId,
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
  ops?: OpDef[]
  /**
   * Make this custom typeId behave like a built-in field for everything
   * the adapter / UI doesn't explicitly override:
   *
   * - **Value-type checks** treat the value as the delegated primitive
   *   (e.g. `delegateTo: 'string'` rejects non-string values).
   * - **Default UI renderer** falls back to the delegated builtin's
   *   renderer set if no `registerRenderer(typeId, ...)` was supplied.
   * - **SQL op handler** falls back to the delegated builtin's behaviour
   *   when the adapter hasn't overridden the op for this typeId.
   * - **Default ops** are inherited from the delegated builtin if `ops`
   *   is omitted — this is what makes `f.custom({ typeId: 'fulltext',
   *   delegateTo: 'string' })` work without restating string ops.
   *
   * The custom typeId is still preserved on the FieldDef, so adapter
   * code can branch on `ctx.field.typeId` to inject custom behaviour
   * (e.g. cross-column ILIKE) where it actually matters.
   */
  delegateTo?: BuiltinFieldTypeId
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
} as const satisfies Record<BuiltinFieldTypeId, OpDef[]>

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
  // they declared). The brand uses a `unique symbol` key (see types.ts)
  // so cross-ID assignments fail at the type level even though no
  // brand value exists at runtime.
  id<ID extends string | number = string | number>(
    opts: CommonOpts = {},
  ): IdField<ID> {
    return augment({ typeId: 'id', ops: opSets.id, ...opts } as unknown as IdField<ID>)
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
    // If `ops` is omitted but `delegateTo` is set, inherit the delegated
    // builtin's default op list — this is what lets `f.custom({
    // typeId: 'fulltext', delegateTo: 'string' })` work as a "string
    // with a tag" without re-listing builtinOps.
    const ops =
      opts.ops
      ?? (opts.delegateTo ? opSets[opts.delegateTo] : undefined)
      ?? []
    return augment({
      typeId: opts.typeId,
      ops,
      ...(opts.delegateTo !== undefined && { delegateTo: opts.delegateTo }),
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
