import type { InjectionKey } from 'vue'
import type { UseFilterReturn } from './types.ts'

// Injection key used by FilterBuilder to expose the active useFilter
// instance to descendant renderers. Built-in renderers that need access
// to async state (id autocomplete) inject this key; renderers that only
// need value/onUpdate/field can ignore it.
export const filterInjectionKey: InjectionKey<UseFilterReturn> = Symbol('dql-kit/filter')
