import type { OpDef } from './types.ts'

// Built-in op definitions. The default `label` is the op name itself —
// core stays language-neutral. Apps that want localised labels register
// them through the Vue plugin's `opLabels` (see @dql-kit/vue-headless),
// or override per-OpDef when defining a schema.
const def = (name: string, valueShape: OpDef['valueShape']): OpDef =>
  ({ name, valueShape, label: name })

export const builtinOps = {
  eq:           def('eq',           'single'),
  neq:          def('neq',          'single'),
  contains:     def('contains',     'single'),
  notContains:  def('notContains',  'single'),
  startsWith:   def('startsWith',   'single'),
  endsWith:     def('endsWith',     'single'),
  isEmpty:      def('isEmpty',      'none'),
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
