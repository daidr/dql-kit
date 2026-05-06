import type { DroppedNode, FilterSchema, ValidAST } from './types.ts'

export const COMPACT_KEYS = {
  combinator: 'c',
  children:   'n',
  field:      'f',
  op:         'o',
  value:      'v',
} as const

export const toUrl = (_ast: ValidAST): string => {
  void _ast
  throw new Error('[dql-kit/core] toUrl() is scaffolded; implementation pending.')
}

export const fromUrl = (
  _encoded: string,
  _schema: FilterSchema,
): { ast: ValidAST, dropped: DroppedNode[] } => {
  void _encoded; void _schema
  throw new Error('[dql-kit/core] fromUrl() is scaffolded; implementation pending.')
}
