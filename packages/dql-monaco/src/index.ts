// Public surface of @dql-kit/dql-monaco.
//
// Usage:
//
//   import * as monaco from 'monaco-editor'
//   import {
//     registerDqlLanguage,
//     createDqlContribution,
//     DQL_LANGUAGE_ID,
//   } from '@dql-kit/dql-monaco'
//
//   registerDqlLanguage(monaco)
//
//   const contribution = createDqlContribution({
//     monaco,
//     schema: () => currentSchema,
//     fetchers: () => currentFetchers,
//   })
//
//   const model = monaco.editor.createModel(initialText, DQL_LANGUAGE_ID)
//   const detach = contribution.attach(model)
//   const editor = monaco.editor.create(el, {
//     model,
//     'semanticHighlighting.enabled': true, // important — DQL relies on
//                                            // semantic tokens for slot-aware
//                                            // colouring beyond the Monarch
//                                            // first pass.
//   })
//
//   // teardown
//   detach.dispose()
//   model.dispose()
//   editor.dispose()
//   contribution.dispose()

export { DQL_LANGUAGE_ID, registerDqlLanguage } from './language.ts'
export {
  createDqlContribution,
  type DqlContribution,
  type DqlContributionOptions,
} from './contribution.ts'
