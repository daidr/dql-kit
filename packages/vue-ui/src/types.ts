/**
 * Layout / behaviour variant for the reference `<FilterBuilder>` UI.
 *
 * - `vertical-stack`: groups + conditions stacked inline, always visible
 *   (used for inline-filter pages where the panel is always on screen).
 * - `popover-trigger`: a button trigger that opens the builder in a
 *   popover panel; click-outside / Escape closes it.
 *
 * Custom UIs that consume `useFilter` directly do not need this enum;
 * it lives in `@dql-kit/vue-ui` because it's specific to the reference
 * `<FilterBuilder>` implementation.
 */
export type Variant = 'vertical-stack' | 'popover-trigger'
