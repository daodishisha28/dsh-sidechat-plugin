import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFile(resolve(root, relative), 'utf8')

const [manifestText, lockfile, workspaceConfig, hostConfig, clientConfig, vitestConfig, contractScript, gitignore, fixtureManifestText, fixtureHostTsconfig, fixtureFullTsconfig, fixtureFullClientTsconfig] = await Promise.all([
  read('package.json'),
  read('pnpm-lock.yaml'),
  read('pnpm-workspace.yaml'),
  read('tsconfig.host.json'),
  read('tsconfig.client.json'),
  read('vitest.config.ts'),
  read('scripts/verify-dsh-contracts.mjs'),
  read('.gitignore'),
  read('tests/contracts/alpha2-fixture/package.json'),
  read('tests/contracts/alpha2-fixture/tsconfig.json'),
  read('tests/contracts/alpha2-fixture/tsconfig.full-plugin.json'),
  read('tests/contracts/alpha2-fixture/tsconfig.full-plugin-client.json'),
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

// The alpha.2 fixture must resolve every dependency from the registry at exact
// pinned versions; local path/workspace/tarball escape hatches are forbidden.
const fixtureManifest = JSON.parse(fixtureManifestText)
for (const [name, spec] of Object.entries(fixtureManifest.devDependencies ?? {})) {
  if (typeof spec !== 'string' || /(?:^|\s)[~^><*]|workspace:|file:|link:|\.tgz/u.test(spec)) {
    throw new Error(`alpha.2 fixture dependency ${name} must be an exact registry version (got ${spec})`)
  }
}
for (const [label, text] of [['fixture tsconfig.json', fixtureHostTsconfig], ['fixture tsconfig.full-plugin.json', fixtureFullTsconfig], ['fixture tsconfig.full-plugin-client.json', fixtureFullClientTsconfig]]) {
  if (text.includes('dsh-compat')) throw new Error(`${label} must not reference the local dsh-compat facade`)
}
// The full-plugin real-type gate must keep covering the actual plugin sources:
// the Host program the index/service bucket plus trajectory/usage, and the
// Client program the whole client tree. Shrinking these file lists would
// silently uncheck real Host/Client surfaces against alpha.2.
if (!fixtureFullTsconfig.includes('../../../src/index.ts') || !fixtureFullTsconfig.includes('../../../src/trajectory.ts') || !fixtureFullTsconfig.includes('../../../src/usage.ts')) {
  throw new Error('full-plugin fixture project no longer covers the Host sources')
}
if (!fixtureFullClientTsconfig.includes('../../../src/client/index.ts')) {
  throw new Error('full-plugin client fixture project no longer covers the Client sources')
}
// Subpath exports (`/client`, `/types`) resolve through exact per-path
// mappings; the bare wildcard treats them as filesystem directories.
for (const [label, text] of [['full-plugin fixture', fixtureFullTsconfig], ['full-plugin client fixture', fixtureFullClientTsconfig]]) {
  for (const subpath of ['@deepseek-ai/dsh-client-ui-workspace/client', '@deepseek-ai/dsh-token-meter/client', '@deepseek-ai/dsh-session/types']) {
    if (!text.includes(`"${subpath}"`)) throw new Error(`${label} is missing the exact path mapping for ${subpath}`)
  }
}
if (Array.isArray(manifest.files) && (manifest.files.includes('tests') || manifest.files.includes('presets'))) {
  throw new Error('package files whitelist must not ship tests or presets')
}
if (!workspaceConfig.includes('tests/contracts/alpha2-fixture')) {
  throw new Error('pnpm workspace must register tests/contracts/alpha2-fixture')
}
console.log('standalone source-build configuration and Git ignore policy passed')
