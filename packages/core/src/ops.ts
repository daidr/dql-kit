import type { Label, OpDef, ValueShape } from './types.ts'

/**
 * Define an op, keeping its name and value shape as literal types so
 * schema-typed ASTs (`ValidAST<typeof schema>`) can narrow `op` and
 * `value` for fields that use it. A plain object literal annotated
 * `OpDef` works at runtime too, but types as the open form.
 *
 * The default `label` is the op name itself — core stays
 * language-neutral. Apps that want localised labels register them
 * through the Vue plugin's `opLabels` (see @dql-kit/vue-headless).
 */
export const defineOp = <const N extends string, const S extends ValueShape>(
  name: N,
  valueShape: S,
  label: Label = name,
): OpDef<N, S> => ({ name, valueShape, label })

const def = defineOp

export const builtinOps = {
  eq:           def('eq',           'single'),
  neq:          def('neq',          'single'),
  contains:     def('contains',     'single'),
  notContains:  def('notContains',  'single'),
  startsWith:   def('startsWith',   'single'),
  endsWith:     def('endsWith',     'single'),
  isEmpty:      def('isEmpty',      'none'),
  notEmpty:     def('notEmpty',     'none'),
  in:           def('in',           'list'),
  notIn:        def('notIn',        'list'),
  gt:           def('gt',           'single'),
  gte:          def('gte',          'single'),
  lt:           def('lt',           'single'),
  lte:          def('lte',          'single'),
  between:      def('between',      'pair'),
  before:       def('before',       'single'),
  after:        def('after',        'single'),
  inLast:       def('inLast',       'relative'),
  containsAll:  def('containsAll',  'list'),
} as const satisfies Record<string, OpDef>

export type BuiltinOpName = keyof typeof builtinOps

export const opByName = (name: string): OpDef | undefined =>
  (builtinOps as Record<string, OpDef>)[name]
