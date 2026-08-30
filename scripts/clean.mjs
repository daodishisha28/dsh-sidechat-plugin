import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'lib')
if (dirname(target) !== root) throw new Error(`refusing unexpected clean target: ${target}`)
await rm(target, { recursive: true, force: true })
