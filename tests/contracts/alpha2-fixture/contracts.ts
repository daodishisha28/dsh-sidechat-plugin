/**
 * Real-export contract module for the SideChat plugin's DSH 0.2.1-alpha.2
 * surface (upstream commit d743267388641bc76f17c45ce8b4c231aed1d32c).
 *
 * Compiled by `pnpm verify:real-exports` against the actual packages
 * published at the pinned versions (see this fixture's package.json). The
 * repository-local facade (types/dsh-compat.d.ts) is deliberately excluded
 * from this build, so passing here proves the real exports rather than
 * invented local declarations. Type-only: never imported at runtime.
 *
 * The plugin's own sources do not compile against these exports yet
 * (`pnpm check:plugin-alpha2` records that gap); batches B/C/D migrate them.
 * This module pins the target surface those batches must land on.
 */
import type { Context } from '@deepseek-ai/cordis'

// --- V4 message sources ----------------------------------------------------
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, Message, MessageSourceMap, UserMessage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** SideChat producer kind planned for all six parent/child write paths. */
    'plugin:dsh-sidechat': { kind: 'plugin:dsh-sidechat' } & ContextFormed
  }
}

const noticeUserMessage: UserMessage = createUserMessage({
  content: [{ type: 'text', text: 'sidechat notice' }],
  source: { kind: 'plugin:dsh-sidechat', form: 'notice', summary: boundContextSummary('SideChat fold delivered') },
})
const undeclaredUserMessage: Message = createUserMessage({
  content: [{ type: 'text', text: 'plain' }],
  source: { kind: 'plugin:dsh-sidechat' },
})
export type SideChatSource = MessageSourceMap['plugin:dsh-sidechat']

// --- Session identity and half-open log offset ------------------------------
// Type-only imports still load each module's `declare module '@deepseek-ai/cordis'`
// augmentation, which is how the real packages expose ctx.sessionQuery /
// ctx.uiWorkspace / the 'compaction' serviceFor key.
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
// Loads the `ctx.sessionQuery` Context augmentation (SessionQueryEngine).
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'

declare const session: Session
const header: SessionHeader = session.header
const seeded: boolean = header.isSeeded
/** Next-event offset === current log length (half-open bound). */
const nextSeq: number = session.seq
/** Independent inherited-prefix length, not the header homonym. */
const inheritedCount: number = session.inheritedEventCount
const targetSessionId: SessionId = SessionId('sidechat-child')

// --- SessionQuery: exact async reads (snapshotEvents/eventAt are gone) ------
declare const ctx: Context
async function readExactLog(id: SessionId) {
  const snapshot = await ctx.sessionQuery.readSession(id)
  const clonedHeader: SessionHeader = snapshot.session
  const inherited: number = snapshot.inheritedEventCount
  const events: readonly unknown[] = snapshot.events
  return { clonedHeader, inherited, events }
}
async function observeWithLease(id: SessionId) {
  const observation = await ctx.sessionQuery.observeSession(id)
  // Caller-owned lease; batches B/C must release on success, error, and cancel.
  return observation
}

// --- Declarative agent preset + registry services ---------------------------
import type { Config as AgentPresetRowConfig } from '@deepseek-ai/dsh-agent-preset'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-persona'
// Loads the `compaction` Context service key used by serviceFor below.
import type { CompactionEngine } from '@deepseek-ai/dsh-compaction'

const sidechatPresetRow: AgentPresetRowConfig = {
  id: 'sidechat-clarifier',
  name: 'SideChat 澄清模式',
  description: '父权限过滤的只读澄清 Agent',
  order: 20,
  plugins: [],
}
const sameShape: PresetDefinition = sidechatPresetRow
declare const agentLike: { ctx: Context }
const composedId: string | undefined = ctx.agentPresets.composedPreset(agentLike.ctx)
const compactionService = ctx.agentPresets.serviceFor(agentLike, 'compaction')
const personaSectionName: string = PERSONA_PREFIX_SECTION

// --- Tools: restrict (scoped, no run_code) + monotonic guard ----------------
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const visibleSchemas = ctx.tools.schemas()
const liftRestriction: () => void = ctx.tools.restrict({ allow: visibleSchemas.map(schema => schema.name) })
const liftGuard: () => void = ctx.tools.guard((execution: Readonly<ToolExecution>) =>
  execution.name === 'forbidden' ? 'sidechat read-only policy' : undefined)
declare const scopedCtx: Context
const liftScopedRestriction: () => void = scopedCtx.tools.restrict({ deny: ['write_file'] })

// --- uiWorkspace navigation + command description callbacks -----------------
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
// Loads the `ctx.uiWorkspace` Context augmentation (UiWorkspaceService).
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'

const sessionTarget: SessionTarget = targetSessionId
ctx.uiWorkspace.openSession(sessionTarget)
const commandWithDescriptionCallback: CommandContribution = {
  name: 'sidechat',
  description: () => 'Open a SideChat clarification session',
  available: (sessionContext) => sessionContext.sessionId !== '',
  ui: { kind: 'action', run: () => {} },
}

// --- workflow-ptc: the four-inject PTC workflow backend ---------------------
import PtcWorkflowEngine, { type Config as WorkflowPtcConfig } from '@deepseek-ai/dsh-workflow-ptc'

const workflowInject: readonly string[] = PtcWorkflowEngine.inject
const workflowConfig: WorkflowPtcConfig = { provider: 'spawn' }
if (workflowInject.length < 4) throw new Error('workflow-ptc must inject subagents, ptcRuntime, sandboxPolicy, workingDirectory')

export {
  noticeUserMessage,
  undeclaredUserMessage,
  seeded,
  nextSeq,
  inheritedCount,
  readExactLog,
  observeWithLease,
  composedId,
  compactionService,
  personaSectionName,
  liftRestriction,
  liftGuard,
  liftScopedRestriction,
  sessionTarget,
  commandWithDescriptionCallback,
  workflowInject,
  workflowConfig,
}
