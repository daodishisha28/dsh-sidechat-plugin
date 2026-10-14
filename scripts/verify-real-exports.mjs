import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = resolve(root, 'tests/contracts/alpha2-fixture')
const fullPlugin = process.argv.includes('--full-plugin')

try {
  await access(resolve(fixture, 'node_modules', '@deepseek-ai', 'dsh-llm', 'package.json'))
} catch {
  console.error('alpha.2 real-export fixture is not installed; run `pnpm install` at the repository root first')
  process.exit(1)
}

const project = resolve(fixture, fullPlugin ? 'tsconfig.full-plugin.json' : 'tsconfig.json')
const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc')
const run = projectPath => {
  const result = spawnSync(process.execPath, [tsc, '-p', projectPath, '--noEmit'], {
    cwd: fixture,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status
}
// --full-plugin compiles the Host and Client sides as two separate programs:
// the real web Client context only ever loads the client packages, while the
// Host program loads the host session store. One merged program would collide
// the two upstream `ctx.sessions` augmentations (host SessionStore vs client
// ISessions) — a modeling artifact, not a plugin error.
const projects = fullPlugin
  ? [project, resolve(fixture, 'tsconfig.full-plugin-client.json')]
  : [project]
let failed = false
for (const projectPath of projects) {
  if (run(projectPath) !== 0) failed = true
}
if (failed) {
  console.error('real alpha.2 export check failed (exit 1)')
  process.exit(1)
}
console.log(fullPlugin
  ? 'full plugin host and client sources compile against real alpha.2 exports'
  : 'real alpha.2 published exports satisfy the SideChat contract module')
