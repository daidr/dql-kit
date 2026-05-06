import { computed, defineComponent, h, ref, type Component, type PropType } from 'vue'

const baseProps = {
  fieldKey: { type: String, required: true as const },
  op: { type: String, required: true as const },
  value: { type: null as unknown as PropType<unknown>, default: undefined },
  onUpdate: {
    type: Function as PropType<(v: unknown) => void>,
    required: true as const,
  },
}

export const StringInput = defineComponent({
  name: 'DqlStringInput',
  props: baseProps,
  setup(props) {
    return () =>
      h('input', {
        type: 'text',
        class: 'dql-input dql-input--string',
        value: typeof props.value === 'string' ? props.value : '',
        onInput: (e: Event) => {
          props.onUpdate((e.target as HTMLInputElement).value)
        },
      })
  },
})

export const StringTokenInput = defineComponent({
  name: 'DqlStringTokenInput',
  props: baseProps,
  setup(props) {
    const tokens = computed<string[]>(() =>
      Array.isArray(props.value)
        ? props.value.filter((x): x is string => typeof x === 'string')
        : [],
    )
    const draft = ref('')

    const commit = (raw: string) => {
      const trimmed = raw.trim()
      if (trimmed === '') return
      props.onUpdate([...tokens.value, trimmed])
      draft.value = ''
    }
    const removeAt = (i: number) => {
      const next = tokens.value.slice()
      next.splice(i, 1)
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        {
          class: 'dql-input dql-input--token-list',
          'data-testid': 'token-list',
        },
        [
          ...tokens.value.map((token, i) =>
            h(
              'span',
              {
                key: `${i}-${token}`,
                class: 'dql-token',
                'data-testid': 'token',
              },
              [
                h('span', { class: 'dql-token-text' }, token),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'dql-token-remove',
                    'data-testid': 'token-remove',
                    onClick: () => removeAt(i),
                  },
                  '×',
                ),
              ],
            ),
          ),
          h('input', {
            type: 'text',
            class: 'dql-token-input',
            'data-testid': 'token-input',
            value: draft.value,
            onInput: (e: Event) => {
              draft.value = (e.target as HTMLInputElement).value
            },
            onKeydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commit(draft.value)
              } else if (
                e.key === 'Backspace'
                && draft.value === ''
                && tokens.value.length > 0
              ) {
                removeAt(tokens.value.length - 1)
              }
            },
            onBlur: () => {
              if (draft.value.trim() !== '') commit(draft.value)
            },
          }),
        ],
      )
  },
})

export const NumberInput = defineComponent({
  name: 'DqlNumberInput',
  props: baseProps,
  setup(props) {
    return () =>
      h('input', {
        type: 'number',
        class: 'dql-input dql-input--number',
        value: typeof props.value === 'number' ? props.value : '',
        onInput: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value
          if (raw === '') {
            props.onUpdate(undefined)
            return
          }
          const n = Number(raw)
          if (Number.isFinite(n)) props.onUpdate(n)
        },
      })
  },
})

// `between` is a pair shape: two independent number inputs, NOT a single
// range slider (per slice #5 acceptance and DESIGN.md Q7).
export const NumberPairInput = defineComponent({
  name: 'DqlNumberPairInput',
  props: baseProps,
  setup(props) {
    const pair = computed<[number | null, number | null]>(() => {
      if (Array.isArray(props.value) && props.value.length === 2) {
        const [a, b] = props.value
        return [
          typeof a === 'number' && Number.isFinite(a) ? a : null,
          typeof b === 'number' && Number.isFinite(b) ? b : null,
        ]
      }
      return [null, null]
    })

    const update = (idx: 0 | 1, raw: string) => {
      const next: [number | null, number | null] = [pair.value[0], pair.value[1]]
      if (raw === '') {
        next[idx] = null
      } else {
        const n = Number(raw)
        if (!Number.isFinite(n)) return
        next[idx] = n
      }
      // Emit either a fully-typed [number, number] tuple, or a tuple with
      // nulls (which prune drops as a value_type_mismatch). This keeps the
      // valid AST clean while letting the user fill the second input.
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        { class: 'dql-input dql-input--number-pair' },
        [
          h('input', {
            type: 'number',
            'data-testid': 'pair-min',
            class: 'dql-pair-min',
            value: pair.value[0] ?? '',
            onInput: (e: Event) => update(0, (e.target as HTMLInputElement).value),
          }),
          h('span', { class: 'dql-pair-separator' }, '–'),
          h('input', {
            type: 'number',
            'data-testid': 'pair-max',
            class: 'dql-pair-max',
            value: pair.value[1] ?? '',
            onInput: (e: Event) => update(1, (e.target as HTMLInputElement).value),
          }),
        ],
      )
  },
})

export const NumberTokenInput = defineComponent({
  name: 'DqlNumberTokenInput',
  props: baseProps,
  setup(props) {
    const tokens = computed<number[]>(() =>
      Array.isArray(props.value)
        ? props.value.filter(
            (x): x is number => typeof x === 'number' && Number.isFinite(x),
          )
        : [],
    )
    const draft = ref('')

    const commit = (raw: string) => {
      const trimmed = raw.trim()
      if (trimmed === '') return
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return
      props.onUpdate([...tokens.value, n])
      draft.value = ''
    }
    const removeAt = (i: number) => {
      const next = tokens.value.slice()
      next.splice(i, 1)
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        {
          class: 'dql-input dql-input--number-token-list',
          'data-testid': 'token-list',
        },
        [
          ...tokens.value.map((token, i) =>
            h(
              'span',
              {
                key: `${i}-${token}`,
                class: 'dql-token',
                'data-testid': 'token',
              },
              [
                h('span', { class: 'dql-token-text' }, String(token)),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'dql-token-remove',
                    'data-testid': 'token-remove',
                    onClick: () => removeAt(i),
                  },
                  '×',
                ),
              ],
            ),
          ),
          h('input', {
            type: 'number',
            class: 'dql-token-input',
            'data-testid': 'token-input',
            value: draft.value,
            onInput: (e: Event) => {
              draft.value = (e.target as HTMLInputElement).value
            },
            onKeydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commit(draft.value)
              } else if (
                e.key === 'Backspace'
                && draft.value === ''
                && tokens.value.length > 0
              ) {
                removeAt(tokens.value.length - 1)
              }
            },
            onBlur: () => {
              if (draft.value.trim() !== '') commit(draft.value)
            },
          }),
        ],
      )
  },
})

export const defaultRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringInput,
  number: NumberInput,
})

export const defaultPairRenderers: Readonly<Record<string, Component>> = Object.freeze({
  number: NumberPairInput,
})

export const defaultListRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringTokenInput,
  number: NumberTokenInput,
})
