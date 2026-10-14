import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Batch A baseline: DSH 0.2.1-alpha.2 (npm alpha tag), upstream commit
// d743267388641bc76f17c45ce8b4c231aed1d32c. Vendor families keep their own
// version axis and are not dragged onto the DSH version.
const targetCommit = 'd743267388641bc76f17c45ce8b4c231aed1d32c'
const dshVersion = '0.2.1-alpha.2'
const familyVersions = {
  '@deepseek-ai/cordis': '4.0.5-alpha.1',
  '@deepseek-ai/schemastery': '3.18.5-alpha.1',
}
const requiredPeers = [
  '@deepseek-ai/dsh-agent-preset-registry',
  '@deepseek-ai/dsh-agent-preset',
  '@deepseek-ai/dsh-client-ui-workspace',
]
const removedPeers = ['@deepseek-ai/dsh-agent-presets']

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const dshPeers = Object.entries(manifest.peerDependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/'))

if (dshPeers.length === 0) throw new Error('no DSH peer dependencies declared')
for (const [name, version] of dshPeers) {
  const expected = familyVersions[name] ?? dshVersion
  if (version !== expected) {
    throw new Error(`${name} must stay pinned to the verified alpha.2 baseline ${expected} (got ${version})`)
  }
}
for (const name of requiredPeers) {
  if (manifest.peerDependencies?.[name] === undefined) {
    throw new Error(`${name} must be declared as a peer dependency`)
  }
}
for (const name of removedPeers) {
  if (manifest.peerDependencies?.[name] !== undefined) {
    throw new Error(`${name} was removed upstream and must not stay declared`)
  }
}

const facade = await readFile(resolve(root, 'types/dsh-compat.d.ts'), 'utf8')
const facadeAnchors = [
  "declare module '@deepseek-ai/cordis'",
  "declare module '@deepseek-ai/dsh-agent'",
  "declare module '@deepseek-ai/dsh-agent-default-model'",
  "declare module '@deepseek-ai/dsh-agent-preset-registry'",
  "declare module '@deepseek-ai/dsh-api-session-controller/client'",
  "declare module '@deepseek-ai/dsh-client-connection'",
  "declare module '@deepseek-ai/dsh-client-ui-slots'",
  "declare module '@deepseek-ai/dsh-client-ui-workspace/client'",
  "declare module '@deepseek-ai/dsh-compaction'",
  "declare module '@deepseek-ai/dsh-llm'",
  "declare module '@deepseek-ai/dsh-sandbox-policy'",
  "declare module '@deepseek-ai/dsh-session'",
  "declare module '@deepseek-ai/dsh-storage-domain'",
  "declare module '@deepseek-ai/dsh-token-meter/client'",
  "declare module '@deepseek-ai/dsh-token-meter'",
  "declare module '@deepseek-ai/dsh-tools'",
  "declare module '@deepseek-ai/dsh-typert-protocol'",
  "declare module '@deepseek-ai/dsh-user-approval'",
]
for (const anchor of facadeAnchors) {
  if (!facade.includes(anchor)) throw new Error(`local DSH compatibility facade is missing ${anchor}`)
}

// Client section: the facade must track the alpha.2 client surface — the
// removed `sessions.open` stays gone, navigation is `uiWorkspace.openSession`,
// and command descriptions are callbacks.
if (/open\s*\(\.\.\.args/u.test(facade)) throw new Error('facade still declares the removed ctx.sessions.open')
if (!facade.includes('readonly uiWorkspace:')) throw new Error('facade does not declare the ctx.uiWorkspace navigation capability')
if (!facade.includes('description?(): string')) throw new Error('facade command description is not the alpha.2 callback form')

const sourceRoot = process.env.DSH_SOURCE_DIR
if (sourceRoot === undefined || sourceRoot.trim() === '') {
  console.log(`verified ${dshPeers.length} peer pins (DSH ${dshVersion}, commit ${targetCommit}) and ${facadeAnchors.length} facade contract groups`)
  console.log('real published-export checking lives in pnpm verify:real-exports')
  console.log(`set DSH_SOURCE_DIR to a checkout of ${targetCommit} to verify source anchors`)
  process.exit(0)
}

const dsh = resolve(sourceRoot)
const expected = [
  ['package.json', `"version": "${dshVersion}"`],
  ['packages/preset/agent-preset-registry/src/index.ts', 'composedPreset(ctx: Context): string | undefined'],
  ['packages/preset/agent-preset-registry/src/index.ts', 'serviceFor<K extends string & keyof Context>'],
  ['packages/preset/agent-preset-registry/src/index.ts', 'async register(definition: PresetDefinition)'],
  ['packages/preset/agent-preset/src/index.ts', "static inject = ['agentPresets']"],
  ['packages/preset/persona/src/index.ts', 'PERSONA_PREFIX_SECTION'],
  ['packages/workflow/workflow-ptc/src/index.ts', "static inject = ['subagents', 'ptcRuntime', 'sandboxPolicy', 'workingDirectory']"],
  ['packages/bundle/web-app/presets/standard.patch.yml', "name: '@deepseek-ai/dsh-agent-preset'"],
  ['packages/core/tools/src/index.ts', 'restrict(filter: ToolRestriction): () => void'],
  ['packages/core/tools/src/index.ts', 'guard(guard: ToolGuard): () => void'],
  ['packages/core/tools/src/index.ts', 'schemas(scope?: ScopeKey): ToolSchema[]'],
  ['packages/core/tools/src/index.ts', 'cannot name reserved PTC mode presentation transport'],
  ['packages/session-query/session-query/src/index.ts', 'async readSession(sessionId: SessionId): Promise<SessionLogSnapshot>'],
  ['packages/session-query/session-query/src/index.ts', 'observeSession('],
  ['packages/core/session/src/index.ts', 'get seq(): SessionLogOffset'],
  ['packages/core/session/src/index.ts', 'readonly inheritedEventCount: SessionLogOffset'],
  ['packages/core/session/src/types.ts', 'readonly isSeeded: boolean'],
  ['packages/core/session/src/types.ts', 'export const SESSION_FORMAT_VERSION = 4'],
  ['packages/llm/llm/src/message.ts', 'export interface MessageSourceMap'],
  ['packages/llm/llm/src/message.ts', 'export function createUserMessage'],
  ['packages/llm/llm/src/message.ts', 'export function boundContextSummary'],
  ['packages/client/ui-workspace/src/client/navigation.ts', 'openSession(target: SessionTarget): void'],
  ['packages/client/ui-commands/src/client/contract.ts', 'description?(): string'],
]

for (const [relative, needle] of expected) {
  const file = resolve(dsh, relative)
  await access(file)
  const text = await readFile(file, 'utf8')
  if (!text.includes(needle)) throw new Error(`DSH contract drift: ${relative} no longer contains ${JSON.stringify(needle)}`)
}
console.log(`verified ${expected.length} source anchors against ${dsh} (expected commit ${targetCommit})`)
