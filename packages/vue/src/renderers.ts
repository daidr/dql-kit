import { RELATIVE_UNITS, type FieldDef, type Label } from '@dql-kit/core'
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

export const DateInput = defineComponent({
  name: 'DqlDateInput',
  props: baseProps,
  setup(props) {
    return () =>
      h('input', {
        type: 'date',
        class: 'dql-input dql-input--date',
        'data-testid': 'date-input',
        value: typeof props.value === 'string' ? props.value : '',
        onInput: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value
          props.onUpdate(raw === '' ? undefined : raw)
        },
      })
  },
})

export const DateRangeInput = defineComponent({
  name: 'DqlDateRangeInput',
  props: baseProps,
  setup(props) {
    const pair = computed<[string | null, string | null]>(() => {
      if (Array.isArray(props.value) && props.value.length === 2) {
        const [a, b] = props.value
        return [
          typeof a === 'string' ? a : null,
          typeof b === 'string' ? b : null,
        ]
      }
      return [null, null]
    })

    const update = (idx: 0 | 1, raw: string) => {
      const next: [string | null, string | null] = [pair.value[0], pair.value[1]]
      next[idx] = raw === '' ? null : raw
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        { class: 'dql-input dql-input--date-range' },
        [
          h('input', {
            type: 'date',
            'data-testid': 'date-pair-min',
            class: 'dql-pair-min',
            value: pair.value[0] ?? '',
            onInput: (e: Event) => update(0, (e.target as HTMLInputElement).value),
          }),
          h('span', { class: 'dql-pair-separator' }, '–'),
          h('input', {
            type: 'date',
            'data-testid': 'date-pair-max',
            class: 'dql-pair-max',
            value: pair.value[1] ?? '',
            onInput: (e: Event) => update(1, (e.target as HTMLInputElement).value),
          }),
        ],
      )
  },
})

// `<input type="datetime-local">` round-trip: the browser exposes / accepts a
// `YYYY-MM-DDTHH:mm` string interpreted in the user's local timezone, while
// the AST stores an ISO-8601 instant (UTC). We convert between the two on
// read / write so users always see local times but the wire format stays a
// timezone-stable instant.
const isoToLocal = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const localToIso = (local: string): string | undefined => {
  if (local === '') return undefined
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

export const DateTimeInput = defineComponent({
  name: 'DqlDateTimeInput',
  props: baseProps,
  setup(props) {
    const localValue = computed(() =>
      typeof props.value === 'string' ? isoToLocal(props.value) : '',
    )
    return () =>
      h('input', {
        type: 'datetime-local',
        class: 'dql-input dql-input--datetime',
        'data-testid': 'datetime-input',
        value: localValue.value,
        onInput: (e: Event) => {
          props.onUpdate(localToIso((e.target as HTMLInputElement).value))
        },
      })
  },
})

export const DateTimeRangeInput = defineComponent({
  name: 'DqlDateTimeRangeInput',
  props: baseProps,
  setup(props) {
    const pair = computed<[string | null, string | null]>(() => {
      if (Array.isArray(props.value) && props.value.length === 2) {
        const [a, b] = props.value
        return [
          typeof a === 'string' ? a : null,
          typeof b === 'string' ? b : null,
        ]
      }
      return [null, null]
    })

    const update = (idx: 0 | 1, raw: string) => {
      const next: [string | null, string | null] = [pair.value[0], pair.value[1]]
      next[idx] = raw === '' ? null : (localToIso(raw) ?? null)
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        { class: 'dql-input dql-input--datetime-range' },
        [
          h('input', {
            type: 'datetime-local',
            'data-testid': 'datetime-pair-min',
            class: 'dql-pair-min',
            value: pair.value[0] ? isoToLocal(pair.value[0]) : '',
            onInput: (e: Event) => update(0, (e.target as HTMLInputElement).value),
          }),
          h('span', { class: 'dql-pair-separator' }, '–'),
          h('input', {
            type: 'datetime-local',
            'data-testid': 'datetime-pair-max',
            class: 'dql-pair-max',
            value: pair.value[1] ? isoToLocal(pair.value[1]) : '',
            onInput: (e: Event) => update(1, (e.target as HTMLInputElement).value),
          }),
        ],
      )
  },
})

export const DateTimeInLastInput = defineComponent({
  name: 'DqlDateTimeInLastInput',
  props: baseProps,
  setup(props) {
    const current = computed<{ amount: number | null, unit: string }>(() => {
      const v = props.value
      if (
        v != null
        && typeof v === 'object'
        && typeof (v as Record<string, unknown>).amount === 'number'
        && typeof (v as Record<string, unknown>).unit === 'string'
      ) {
        const r = v as { amount: number, unit: string }
        return {
          amount: Number.isFinite(r.amount) ? r.amount : null,
          unit: r.unit,
        }
      }
      return { amount: null, unit: 'day' }
    })

    const updateAmount = (raw: string) => {
      if (raw === '') {
        props.onUpdate(undefined)
        return
      }
      const n = Number(raw)
      if (!Number.isFinite(n)) return
      props.onUpdate({ amount: n, unit: current.value.unit })
    }

    const updateUnit = (unit: string) => {
      const a = current.value.amount
      // No partial emission: leave the existing value untouched until the
      // amount input is also valid, so prune doesn't see a mid-edit shape.
      if (a === null) return
      props.onUpdate({ amount: a, unit })
    }

    return () =>
      h(
        'div',
        { class: 'dql-input dql-input--in-last' },
        [
          h('input', {
            type: 'number',
            min: '1',
            class: 'dql-inlast-amount',
            'data-testid': 'inlast-amount',
            value: current.value.amount === null ? '' : current.value.amount,
            onInput: (e: Event) => updateAmount((e.target as HTMLInputElement).value),
          }),
          h(
            'select',
            {
              class: 'dql-inlast-unit',
              'data-testid': 'inlast-unit',
              value: current.value.unit,
              onChange: (e: Event) => updateUnit((e.target as HTMLSelectElement).value),
            },
            RELATIVE_UNITS.map((u) =>
              h('option', { value: u, 'data-testid': `inlast-unit-${u}` }, u),
            ),
          ),
        ],
      )
  },
})

export const defaultRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringInput,
  number: NumberInput,
  boolean: BooleanSwitch,
  enum: EnumSelect,
  date: DateInput,
  datetime: DateTimeInput,
})

export const defaultPairRenderers: Readonly<Record<string, Component>> = Object.freeze({
  number: NumberPairInput,
  date: DateRangeInput,
  datetime: DateTimeRangeInput,
})

export const defaultListRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringTokenInput,
  number: NumberTokenInput,
  enum: EnumMultiSelect,
})

export const defaultRelativeRenderers: Readonly<Record<string, Component>> = Object.freeze({
  datetime: DateTimeInLastInput,
})
