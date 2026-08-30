import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFile(resolve(root, relative), 'utf8')

const [manifestText, lockfile, workspaceConfig, hostConfig, clientConfig, vitestConfig, contractScript, gitignore] = await Promise.all([
  read('package.json'),
  read('pnpm-lock.yaml'),
  read('pnpm-workspace.yaml'),
  read('tsconfig.host.json'),
  read('tsconfig.client.json'),
  read('vitest.config.ts'),
  read('scripts/verify-dsh-contracts.mjs'),
  read('.gitignore'),
])

const dependencyText = `${manifestText}\n${lockfile}`
if (/(?:^|\s)(?:file|link|workspace):/mu.test(dependencyText)) {
  throw new Error('local file/link/workspace dependency detected in package metadata or lockfile')
}

const buildConfig = `${hostConfig}\n${clientConfig}\n${vitestConfig}`
if (/\.\.[/\\]deepseek-harness/u.test(buildConfig)) {
  throw new Error('build or test configuration still depends on a sibling deepseek-harness checkout')
}
if (!hostConfig.includes('types/dsh-compat.d.ts') || !clientConfig.includes('types/dsh-compat.d.ts')) {
  throw new Error('standalone DSH compatibility facade is not included in both TypeScript builds')
}
if (!vitestConfig.includes('./tests/shims/token-meter.ts')) {
  throw new Error('Vitest token-meter alias is not repository-local')
}
if (!workspaceConfig.includes('autoInstallPeers: false')) {
  throw new Error('pnpm workspace must keep DSH runtime peers out of standalone source installs')
}
if (/resolve\(root,\s*['"]\.\.['"]/u.test(contractScript)) {
  throw new Error('contract verification has a hard-coded parent-directory source dependency')
}

for (const ignored of ['node_modules/', '.pnpm-store/', 'lib/', '*.tgz', '.smoke-*/']) {
  if (!gitignore.includes(ignored)) throw new Error(`.gitignore is missing ${ignored}`)
}

const manifest = JSON.parse(manifestText)
if (manifest.engines?.node === undefined) throw new Error('Node engine requirement is missing')
if (manifest.engines?.pnpm === undefined) throw new Error('pnpm engine requirement is missing')
console.log('standalone source-build configuration and Git ignore policy passed')
