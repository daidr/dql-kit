import type { FilterSchema, ValidAST } from '@dql-kit/core'
import type { SQL } from 'drizzle-orm'
import type { CreateTranslatorOptions, Translator } from './types.ts'

export const createDrizzleTranslator = <S extends FilterSchema>(
  _opts: CreateTranslatorOptions<S>,
): Translator => {
  void _opts
  const ops: Record<string, never> = {}
  void ops
  return {
    toWhere(_ast: ValidAST): SQL {
      void _ast
      throw new Error('[dql-kit/drizzle] toWhere() is scaffolded; implementation pending.')
    },
    registerOp(_name: string, _translator) {
      void _name; void _translator
      throw new Error('[dql-kit/drizzle] registerOp() is scaffolded; implementation pending.')
    },
  }
}
