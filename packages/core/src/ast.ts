import type {
  DraftAST,
  DraftNode,
  FilterSchema,
  ValidAST,
  ValidNode,
  ValidationError,
} from './types.ts'

const NOT_IMPLEMENTED = (fn: string) => {
  throw new Error(`[dql-kit/core] ${fn}() is scaffolded; implementation pending.`)
}

export const emptyAst = (): ValidAST => ({ combinator: 'and', children: [] })

export const emptyDraft = (): DraftAST => ({ combinator: 'and', children: [] })

export const prune = (_draft: DraftAST, _schema: FilterSchema): ValidAST => {
  void _draft; void _schema
  return NOT_IMPLEMENTED('prune')
}

export const validate = (
  _draft: DraftAST,
  _schema: FilterSchema,
): { ok: true, ast: ValidAST } | { ok: false, errors: ValidationError[] } => {
  void _draft; void _schema
  return NOT_IMPLEMENTED('validate')
}

export const astRefersTo = (_ast: ValidAST | DraftAST, _fieldKey: string): boolean => {
  void _ast; void _fieldKey
  return NOT_IMPLEMENTED('astRefersTo')
}

export const isCondition = (n: DraftNode | ValidNode): boolean =>
  n != null && typeof n === 'object' && 'field' in n
