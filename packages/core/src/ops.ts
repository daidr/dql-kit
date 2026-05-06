import type { OpDef } from './types.ts'

const def = (name: string, valueShape: OpDef['valueShape'], label: string): OpDef =>
  ({ name, valueShape, label: () => label })

export const builtinOps = {
  eq:           def('eq',           'single',   '等于'),
  neq:          def('neq',          'single',   '不等于'),
  contains:     def('contains',     'single',   '包含'),
  notContains:  def('notContains',  'single',   '不包含'),
  startsWith:   def('startsWith',   'single',   '以...开头'),
  endsWith:     def('endsWith',     'single',   '以...结尾'),
  isEmpty:      def('isEmpty',      'none',     '为空'),
  in:           def('in',           'list',     '在列表中'),
  notIn:        def('notIn',        'list',     '不在列表中'),
  gt:           def('gt',           'single',   '大于'),
  gte:          def('gte',          'single',   '大于等于'),
  lt:           def('lt',           'single',   '小于'),
  lte:          def('lte',          'single',   '小于等于'),
  between:      def('between',      'pair',     '在...之间'),
  before:       def('before',       'single',   '早于'),
  after:        def('after',        'single',   '晚于'),
  inLast:       def('inLast',       'relative', '最近'),
  containsAll:  def('containsAll',  'list',     '全部包含'),
} as const satisfies Record<string, OpDef>

export type BuiltinOpName = keyof typeof builtinOps

export const opByName = (name: string): OpDef | undefined =>
  (builtinOps as Record<string, OpDef>)[name]
