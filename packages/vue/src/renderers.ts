import type { FieldDef, Label } from '@dql-kit/core'
import { computed, defineComponent, h, ref, type Component, type PropType } from 'vue'

const baseProps = {
  fieldKey: { type: String, required: true as const },
  field: { type: Object as PropType<FieldDef>, required: true as const },
  op: { type: String, required: true as const },
  value: { type: null as unknown as PropType<unknown>, default: undefined },
  onUpdate: {
    type: Function as PropType<(v: unknown) => void>,
    required: true as const,
  },
}

const labelText = (label: Label | undefined, fallback: string): string => {
  if (label === undefined) return fallback
  return typeof label === 'function' ? label() : label
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

export const BooleanSwitch = defineComponent({
  name: 'DqlBooleanSwitch',
  props: baseProps,
  setup(props) {
    return () =>
      h('input', {
        type: 'checkbox',
        role: 'switch',
        class: 'dql-input dql-input--boolean',
        'data-testid': 'boolean-switch',
        checked: props.value === true,
        onChange: (e: Event) => {
          props.onUpdate((e.target as HTMLInputElement).checked)
        },
      })
  },
})

export const EnumSelect = defineComponent({
  name: 'DqlEnumSelect',
  props: baseProps,
  setup(props) {
    const options = computed(() => props.field.enumValues ?? [])
    return () =>
      h(
        'select',
        {
          class: 'dql-input dql-input--enum-single',
          'data-testid': 'enum-select',
          value:
            props.value === undefined || props.value === null
              ? ''
              : String(props.value),
          onChange: (e: Event) => {
            const raw = (e.target as HTMLSelectElement).value
            if (raw === '') {
              props.onUpdate(undefined)
              return
            }
            const match = options.value.find((o) => String(o.value) === raw)
            if (match) props.onUpdate(match.value)
          },
        },
        [
          h('option', { value: '' }, '— select —'),
          ...options.value.map((o) =>
            h(
              'option',
              {
                value: String(o.value),
                'data-testid': `enum-option-${String(o.value)}`,
              },
              labelText(o.label, String(o.value)),
            ),
          ),
        ],
      )
  },
})

export const EnumMultiSelect = defineComponent({
  name: 'DqlEnumMultiSelect',
  props: baseProps,
  setup(props) {
    const options = computed(() => props.field.enumValues ?? [])
    const selected = computed<unknown[]>(() =>
      Array.isArray(props.value) ? props.value.slice() : [],
    )
    const isSelected = (v: unknown) => selected.value.some((x) => x === v)
    const toggle = (val: unknown) => {
      const cur = selected.value
      const idx = cur.findIndex((x) => x === val)
      const next =
        idx >= 0 ? [...cur.slice(0, idx), ...cur.slice(idx + 1)] : [...cur, val]
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        {
          class: 'dql-input dql-input--enum-multi',
          'data-testid': 'enum-multi',
        },
        options.value.map((o) =>
          h(
            'label',
            {
              class: 'dql-enum-option',
              'data-testid': `enum-multi-option-${String(o.value)}`,
            },
            [
              h('input', {
                type: 'checkbox',
                class: 'dql-enum-checkbox',
                checked: isSelected(o.value),
                onChange: () => toggle(o.value),
              }),
              h('span', { class: 'dql-enum-label' }, labelText(o.label, String(o.value))),
            ],
          ),
        ),
      )
  },
})

export const defaultRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringInput,
  number: NumberInput,
  boolean: BooleanSwitch,
  enum: EnumSelect,
})

export const defaultPairRenderers: Readonly<Record<string, Component>> = Object.freeze({
  number: NumberPairInput,
})

export const defaultListRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringTokenInput,
  number: NumberTokenInput,
  enum: EnumMultiSelect,
})
