// Public surface of @dql-kit/dql-codemirror.
//
// Each function returns a CodeMirror 6 `Extension`. Compose them with
// `basicSetup` (or your own minimal extension list) inside an
// `EditorView` instance.
//
//     import { EditorView, basicSetup } from 'codemirror'
//     import { dql, dqlLinter, dqlCompletion, dqlHover, defaultDqlHighlightStyle }
//       from '@dql-kit/dql-codemirror'
//     import { syntaxHighlighting } from '@codemirror/language'
//
//     const view = new EditorView({
//       parent: el,
//       extensions: [
//         basicSetup,
//         dql({ schema }),
//         dqlLinter({ schema }),
//         dqlCompletion({ schema }),
//         dqlHover({ schema }),
//         syntaxHighlighting(defaultDqlHighlightStyle),
//       ],
//     })

export { dql, type DqlExtensionOptions } from './syntax.ts'
export { dqlLinter, type DqlLinterOptions } from './lint.ts'
export {
  dqlCompletion,
  type DqlCompletionOptions,
} from './completion.ts'
export { dqlHover, type DqlHoverOptions } from './hover.ts'
export {
  defaultDqlTheme,
  defaultDqlHighlightStyle, // alias of defaultDqlTheme (back-compat)
  tagFor,
  tagField,
  tagOp,
  tagUnit,
  tagInvalid,
  classFromTag,
  TOK_CLASS,
} from './highlight.ts'
