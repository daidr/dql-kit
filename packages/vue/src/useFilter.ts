import { emptyDraft } from '@dql-kit/core'
import type { FilterSchema } from '@dql-kit/core'
import { computed, ref } from 'vue'
import type { UseFilterOptions, UseFilterReturn } from './types.ts'

const NOT_IMPLEMENTED = (fn: string) => {
  throw new Error(`[dql-kit/vue] ${fn}() is scaffolded; implementation pending.`)
}

export const useFilter = <S extends FilterSchema>(
  opts: UseFilterOptions<S>,
): UseFilterReturn<S> => {
  const schemaRef = computed(() =>
    typeof opts.schema === 'object' && opts.schema !== null && 'value' in opts.schema
      ? (opts.schema.value as S | undefined)
      : (opts.schema as S),
  )

  const draft = ref(emptyDraft())
  const search = ref({
    fieldKey: null,
    query: '',
    loading: false,
    error: null,
    results: [],
  } as UseFilterReturn['search']['value'])

  return {
    schema: schemaRef,
    draft,
    valid:  computed(() => NOT_IMPLEMENTED('valid')),
    errors: computed(() => NOT_IMPLEMENTED('errors')),
    search,
    labelOf:          () => NOT_IMPLEMENTED('labelOf'),
    actions: {
      addCondition:   () => NOT_IMPLEMENTED('actions.addCondition'),
      removeNode:     () => NOT_IMPLEMENTED('actions.removeNode'),
      updateNode:     () => NOT_IMPLEMENTED('actions.updateNode'),
      addGroup:       () => NOT_IMPLEMENTED('actions.addGroup'),
      setCombinator:  () => NOT_IMPLEMENTED('actions.setCombinator'),
      clear:          () => NOT_IMPLEMENTED('actions.clear'),
    },
    applyAst:         () => NOT_IMPLEMENTED('applyAst'),
    toJSON:           () => NOT_IMPLEMENTED('toJSON'),
    invalidateLabels: () => NOT_IMPLEMENTED('invalidateLabels'),
  }
}
