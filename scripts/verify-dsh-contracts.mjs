import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseline = '0.1.2-alpha.1'
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const dshPeers = Object.entries(manifest.peerDependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/'))

if (dshPeers.length === 0) throw new Error('no DSH peer dependencies declared')
for (const [name, version] of dshPeers) {
  if (version !== baseline) throw new Error(`${name} must stay pinned to verified DSH baseline ${baseline}`)
}

const facade = await readFile(resolve(root, 'types/dsh-compat.d.ts'), 'utf8')
const facadeAnchors = [
  "declare module '@deepseek-ai/cordis'",
  "declare module '@deepseek-ai/dsh-agent'",
  "declare module '@deepseek-ai/dsh-client-connection'",
  "declare module '@deepseek-ai/dsh-client-ui-slots'",
  "declare module '@deepseek-ai/dsh-llm'",
  "declare module '@deepseek-ai/dsh-sandbox-policy'",
  "declare module '@deepseek-ai/dsh-session'",
  "declare module '@deepseek-ai/dsh-storage-domain'",
  "declare module '@deepseek-ai/dsh-token-meter/client'",
  "declare module '@deepseek-ai/dsh-tools'",
  "declare module '@deepseek-ai/dsh-typert-protocol'",
  "declare module '@deepseek-ai/dsh-user-approval'",
]
for (const anchor of facadeAnchors) {
  if (!facade.includes(anchor)) throw new Error(`local DSH compatibility facade is missing ${anchor}`)
}

const sourceRoot = process.env.DSH_SOURCE_DIR
if (sourceRoot === undefined || sourceRoot.trim() === '') {
  console.log(`verified ${dshPeers.length} peer pins and ${facadeAnchors.length} local DSH ${baseline} contract groups`)
  console.log('set DSH_SOURCE_DIR to additionally verify the facade against a DSH source checkout')
  process.exit(0)
}

const dsh = resolve(sourceRoot)
const expected = [
  ['package.json', `"version": "${baseline}"`],
  ['packages/api/session-controller/src/index.ts', 'resolveAgent(sessionId: SessionId)'],
  ['packages/api/session-controller/src/index.ts', "@Remote('create')"],
  ['packages/api/session-controller/src/index.ts', "@Remote('selectModel')"],
  ['packages/session-query/session-query/src/index.ts', 'async readSurface(sessionId: SessionId)'],
  ['packages/session-query/session-query/src/index.ts', 'async readSession(sessionId: SessionId): Promise<SessionLogSnapshot>'],
  ['packages/core/agent/src/runtime-types.ts', 'runMaintenance<T>'],
  ['packages/core/agent/src/index.ts', 'register(agent: Agent): () => void'],
  ['packages/core/agent/src/index.ts', 'list(): Agent[]'],
  ['packages/core/tools/src/index.ts', 'register(definition: ToolDefinition): () => void'],
  ['packages/core/tools/src/index.ts', 'restrict(filter: ToolRestriction): () => void'],
  ['packages/preset/agent-presets/src/index.ts', 'composedPreset(agentCtx: Context): string | undefined'],
  ['packages/sandbox/sandbox-policy/src/session-mode.ts', 'export function setSandboxMode(session: Session, mode: SandboxMode): void'],
  ['packages/interaction/user-approval/src/index.ts', 'export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void'],
  ['packages/storage/storage-domain/src/domain.ts', 'update(key: K, fn: (current: V) => V): Promise<V>'],
  ['packages/llm/llm/src/index.ts', 'stream(options: GenerateOptions): AsyncIterable<StreamChunk>'],
  ['packages/llm/llm/src/types.ts', 'tools?: ToolSchema[]'],
  ['packages/llm/token-meter/src/client.ts', 'export { deriveTurnTokenUsage }'],
  ['packages/client/ui-conversation/src/client/contract/slots.ts', "'conversation.view'"],
  ['packages/client/ui-chat/src/client/contract/slots.ts', "'conversation.chat.assistant-actions'"],
  ['packages/client/ui-commands/src/client/contract.ts', 'register(contribution: CommandContribution)'],
]

for (const [relative, needle] of expected) {
  const file = resolve(dsh, relative)
  await access(file)
  const text = await readFile(file, 'utf8')
  if (!text.includes(needle)) throw new Error(`DSH contract drift: ${relative} no longer contains ${JSON.stringify(needle)}`)
}
console.log(`verified ${expected.length} source anchors against ${dsh}`)
