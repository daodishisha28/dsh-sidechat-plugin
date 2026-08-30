import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kind = process.argv[2]
if (!['unit', 'host', 'client'].includes(kind)) throw new Error('expected test kind: unit, host, or client')
const names = (await readdir(resolve(root, 'tests')))
  .filter(name => name.endsWith(`.${kind}.spec.ts`) || name.endsWith(`.${kind}.spec.tsx`))
  .sort()
if (names.length === 0) throw new Error(`no ${kind} test files found`)
const vitest = resolve(root, 'node_modules', 'vitest', 'vitest.mjs')
const child = spawn(process.execPath, [vitest, 'run', ...names.map(name => `tests/${name}`)], {
  cwd: root,
  stdio: 'inherit',
})
const code = await new Promise((resolveCode, reject) => {
  child.once('error', reject)
  child.once('exit', value => { resolveCode(value ?? 1) })
})
process.exitCode = code
