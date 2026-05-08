// Tiny build helper: copies src/styles.css to dist/styles.css after the
// main bun build + tsc step. Vendored as a script (rather than inlined
// in package.json) so the syntax stays portable across shells.
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const src = new URL('../src/styles.css', import.meta.url)
const dest = new URL('../dist/styles.css', import.meta.url)

await mkdir(dirname(dest.pathname.replace(/^\//, '')), { recursive: true })
await Bun.write(dest, Bun.file(src))
