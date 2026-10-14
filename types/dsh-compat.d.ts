/**
 * Repository-local narrow compatibility facade for the DSH APIs consumed by
 * this plugin. Its body reflects the 0.2.1-alpha.2 Host surface the Host
 * batches (B/C) consume, so a fresh Git clone typechecks and builds without a
 * sibling DSH checkout. It is deliberately NOT authoritative: the real check
 * is tests/contracts/alpha2-fixture (`pnpm check:plugin-alpha2`), which
 * compiles the plugin sources against the actual published 0.2.1-alpha.2
 * packages. Interfaces that no longer exist in alpha.2 — `session.events`,
 * `SessionHeader.seedLength`, the shared `plugin` source kind — are absent
 * here on purpose so stale call sites fail the local typecheck too.
 */

declare module '@deepseek-ai/cordis' {
  export type Disposer = () => void

  export class Context {
    readonly [key: string]: any
    readonly connection: {
      readonly rpc: {
        handle(
          path: string,
          handler: (endpoint: string, payload: unknown, signal: AbortSignal) => unknown,
        ): () => void
      }
    }
    effect<T extends (() => void) | (() => Promise<void>)>(install: () => T, label?: string): () => void
    /** Grant the named services for the callback: the alpha.2 lazy-registration pattern. */
    inject(names: readonly string[], callback: (granted: Context) => void): void
    on(event: string, listener: (...args: any[]) => void): () => void
    provide(name: string, value: unknown): () => void
  }

  export class Service {
    static readonly init: unique symbol
    protected readonly ctx: Context
    constructor(ctx: Context, name: string)
  }
}

declare module '@deepseek-ai/schemastery' {
  class s<T = unknown> {
    step(value: number): this
    min(value: number): this
    max(value: number): this
    default(value: unknown): this
    static object<T>(shape: Record<string, unknown>): s<T>
    static number(): s<number>
    static string(): s<string>
    static boolean(): s<boolean>
  }
  export default s
}

declare module '@deepseek-ai/dsh-client-connection' {
  export type ConnectionRpcResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: Record<string, unknown> } }
}

declare module '@deepseek-ai/dsh-client-connection/client' {
  import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'

  export interface ConnectionHandle {
    readonly rpc: {
      call(path: string, method: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>>
    }
  }
}

declare module '@deepseek-ai/dsh-agent-default-model' {
  export interface AgentDefaultModelConfig {
    currentSelection(): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export type ReasoningEffortId = string
  export function ReasoningEffortId(value: string): ReasoningEffortId

  export interface TokenUsage {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens?: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
    readonly reasoningTokens?: number
  }

  export type ContentBlock =
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: string; readonly [key: string]: unknown }

  export interface ContextSnapshotSection {
    readonly name: string
    readonly text: string
  }

  export type ContextForm =
    | 'instructions'
    | 'catalog'
    | 'snapshot'
    | 'notice'
    | 'relay'
    | 'recall'

  /** Discriminated by `form`; notice requires its summary, snapshot its sections. */
  export type ContextFormed = {
    readonly form?: never
  } | {
    readonly form: 'instructions'
  } | {
    readonly form: 'catalog'
  } | {
    readonly form: 'snapshot'
    readonly sections: readonly ContextSnapshotSection[]
  } | {
    readonly form: 'notice'
    readonly summary: string
  } | {
    readonly form: 'relay'
  } | {
    readonly form: 'recall'
  }

  /**
   * Merge-extensible producer registry. There is no shared `plugin` kind in
   * alpha.2; each producer merges its own entry (the SideChat kind is merged
   * from src/message-source.ts).
   */
  export interface MessageSourceMap {
    user: { readonly kind: 'user' }
    model: { readonly kind: 'model'; readonly provider: string; readonly model: string; readonly replayState?: unknown }
    tool: { readonly kind: 'tool'; readonly callId: string }
    'system-prompt': { readonly kind: 'system-prompt' }
  }

  export type MessageSource = MessageSourceMap[keyof MessageSourceMap]

  export class BlockAssembler {
    readonly usage?: TokenUsage
    readonly finish:
      | { readonly kind: 'error' | 'aborted'; readonly failure: { readonly message: string } }
      | { readonly kind: 'stop' | 'length' | 'tool-calls' | 'other'; readonly failure?: never }
    push(chunk: unknown): void
    blocks(): readonly ContentBlock[]
  }

  export function boundContextSummary(summary: string): string
  export function createUserMessage(input: {
    readonly content: readonly ContentBlock[]
    readonly source: MessageSource
  }): { readonly id: string; readonly role: 'user'; readonly content: readonly ContentBlock[]; readonly source: MessageSource }
}

declare module '@deepseek-ai/dsh-session' {
  export type SessionId = string
  export function SessionId(value: string): SessionId

  export interface SessionHeader {
    readonly version: number
    readonly id?: SessionId
    readonly createdAt: number
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly isSeeded: boolean
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }

  export interface SessionEvent {
    readonly seq: number
    readonly time?: number
    readonly type: string
    readonly data: unknown
    readonly ignorable?: true
  }

  export interface RequestContext {
    readonly provider: string
    readonly model: string
    readonly contextWindow?: number
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  export type SessionId = string
}

declare module '@deepseek-ai/dsh-storage-domain' {
  export interface KvTable<K, V> {
    get(key: K): V | undefined
    set(key: K, value: V): Promise<void> | void
    put(key: K, value: V): Promise<void>
    update(key: K, mutate: (current: V) => V): Promise<V>
    entries(): IterableIterator<[K, V]>
  }

  export function defineDomain<T>(spec: T): T
  export function domainTable<K, V>(schema: unknown): unknown
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  import { Service } from '@deepseek-ai/cordis'

  export function Remote(name: string): any
  export class TypertRemoteService extends Service {}
}

declare module '@deepseek-ai/dsh-agent' {
  import type { Context } from '@deepseek-ai/cordis'
  import type { Session, SessionId } from '@deepseek-ai/dsh-session'

  export interface Agent {
    readonly id: SessionId
    readonly status: 'idle' | 'running'
    readonly ctx: Context
    /** The live session this agent drives. No public `events` array in alpha.2. */
    readonly session: Session
    readonly options: {
      readonly provider?: string
      readonly model?: string
      readonly reasoningEffort?: string
    }
    followup(message: unknown): void
    whenIdle(): Promise<void>
    runMaintenance<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
    /**
     * Clear queued and steering work — unless `keepInbox` — and abort the
     * active turn or between-turn task (upstream
     * packages/core/agent/src/runtime-types.ts:176-183).
     */
    cancel(cause: import('@deepseek-ai/dsh-session').AgentCancelCause, options?: { readonly keepInbox?: boolean }): void
  }
}

declare module '@deepseek-ai/dsh-session' {
  /**
   * Narrow Session view: only the live tail offset and append surface. The
   * synchronous event readers (`events`, `eventAt`, `snapshotEvents`,
   * `ownEvents`) are deprecated in alpha.2 and deliberately not declared.
   */
  export interface Session {
    readonly id: SessionId
    readonly header: SessionHeader
    /** Next event's sequence number — always the log length (half-open). */
    readonly seq: number
    /** Fork-inherited prefix length, independent of the header. */
    readonly inheritedEventCount: number
    append<T extends string>(type: T, data: unknown, options?: unknown): { readonly seq: number; readonly type: T; readonly data: unknown }
    requestContext(): import('@deepseek-ai/dsh-session').RequestContext | undefined
  }

  /** Why an active agent driver was cancelled (upstream packages/core/session/src/types.ts:188-193). */
  export type AgentCancelCause =
    | { readonly kind: 'user' }
    | { readonly kind: 'parent' }
    | { readonly kind: 'hook'; readonly reason: string }
    | { readonly kind: 'disposed' }
}

declare module '@deepseek-ai/dsh-session-query' {
  import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

  export interface SessionLogSnapshot {
    readonly session: SessionHeader
    readonly inheritedEventCount: number
    readonly events: readonly SessionEvent[]
  }

  export interface SessionObservation {
    readonly source: 'live' | 'prepared'
    readonly header: SessionHeader
    readonly inheritedEventCount: number
    readonly events: readonly SessionEvent[]
    readonly cursor: number
    retain(): SessionObservation
    /** Caller-owned lease release (Symbol.dispose at runtime). */
    [Symbol.dispose](): void
  }

  export interface SessionSurfaceSnapshot {
    readonly session: SessionHeader
    readonly events: readonly SessionEvent[]
    readonly capturedThroughSeq: number
  }

  export interface SessionQueryEngine {
    readSession(sessionId: SessionId): Promise<SessionLogSnapshot>
    observeSession(sessionId: SessionId, options?: { readonly signal?: AbortSignal }): Promise<SessionObservation>
    readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>
  }
}

declare module '@deepseek-ai/dsh-agent-preset-registry' {
  import type { Context } from '@deepseek-ai/cordis'

  export interface AgentPresetRegistry {
    composedPreset(ctx: Context): string | undefined
    serviceFor<K extends string & keyof Context>(agent: { readonly ctx: Context }, name: K): Context[K] | undefined
  }
}

declare module '@deepseek-ai/dsh-api-session-controller' {
  import type { Agent } from '@deepseek-ai/dsh-agent'
  import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

  export interface SessionInspection {
    readonly meta: SessionHeader
    readonly events: readonly SessionEvent[]
    readonly inheritedEventCount: number
  }

  export interface SessionController {
    inspect(sessionId: SessionId, signal?: AbortSignal): Promise<SessionInspection>
    resolveAgent(sessionId: SessionId): Promise<{ readonly agent: Agent } | { readonly error: { readonly message: string } }>
    create(request: { readonly cwd?: string; readonly agentPreset?: string }): Promise<{ readonly sessionId: SessionId; readonly agentPreset?: string }>
    rename(request: { readonly sessionId: SessionId; readonly title: string }): Promise<unknown>
    selectModel(request: { readonly sessionId: SessionId; readonly provider: string; readonly model: string; readonly reasoningEffort?: string }): Promise<{ readonly selected: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } }>
  }
}

declare module '@deepseek-ai/dsh-compaction' {
  import type { Agent } from '@deepseek-ai/dsh-agent'

  export interface CompactionResult {
    readonly compactionId: string
  }

  export abstract class CompactionEngine {
    abstract compactNow(agent: Agent, signal: AbortSignal, sourceCommandId?: string): Promise<CompactionResult | null>
    abstract compactIfNeeded(agent: unknown, trigger: 'pressure' | 'context-overflow', signal: AbortSignal): Promise<CompactionResult | null>
  }
}

declare module '@deepseek-ai/dsh-system-prompt' {
  export const PERSONA_PREFIX_SECTION: 'deployment:persona-prefix'
  export const PERSONA_SUFFIX_SECTION: 'deployment:persona-suffix'

  export interface PromptSection {
    readonly name: string
    readonly text: string
    readonly order?: number
    readonly interpolate?: boolean
  }

  export type PromptSectionOrderName = keyof typeof SECTION_ORDERS

  export interface SystemPrompt {
    section(section: PromptSection): () => void
    getSectionOrder(name: PromptSectionOrderName): number
  }
}

declare module '@deepseek-ai/dsh-token-meter' {
  import type { AgentSession } from '@deepseek-ai/dsh-agent'

  export interface TokenMeasurement {
    readonly totalTokens: number
  }

  export class TokenMeter {
    measure(session: AgentSession): TokenMeasurement
    estimateMessage(message: unknown): number
  }
}

declare module '@deepseek-ai/dsh-tools' {
  import type { Agent } from '@deepseek-ai/dsh-agent'

  export interface ToolExecution {
    readonly name: string
    readonly agent?: Agent
    readonly signal: AbortSignal
  }

  export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined

  export interface ToolRestriction {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
  }

  export interface ToolDefinition {
    readonly name: string
    readonly description: string
    readonly parameters: unknown
    readonly output: {
      readonly schema: unknown
      render(args: Record<string, unknown>, value: any): readonly { readonly type: string; readonly text: string }[]
    }
    execute(args: { readonly child_session_id: string; readonly message_ids: readonly string[] }, exec: ToolExecutionContext): Promise<any>
    isConcurrencySafe(): boolean
    presentCall(args: { readonly child_session_id: string; readonly message_ids: readonly string[] }): unknown
  }

  export interface ToolExecutionContext {
    readonly agent?: Agent
    readonly signal: AbortSignal
  }

  export function defineTool(definition: ToolDefinition): ToolDefinition

  /** Tools service surface used through an agent scope context. */
  export interface AgentTools {
    schemas(scope?: unknown): readonly { readonly name: string }[]
    register(definition: ToolDefinition): () => void
    restrict(filter: ToolRestriction): () => void
    guard(guard: ToolGuard): () => void
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly sessionController: import('@deepseek-ai/dsh-api-session-controller').SessionController
    /** Host-catalog face. `open()` was removed upstream; navigation is uiWorkspace.openSession. */
    readonly sessions: { flush(session: unknown): Promise<boolean>; refresh(): Promise<void> }
    readonly tools: import('@deepseek-ai/dsh-tools').AgentTools
    readonly systemPrompt: import('@deepseek-ai/dsh-system-prompt').SystemPrompt
    readonly uiWorkspace: import('@deepseek-ai/dsh-client-ui-workspace/client').UiWorkspace
  }
}

declare module '@deepseek-ai/dsh-sandbox-policy' {
  export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
  export function setSandboxMode(session: { append(type: string, data: unknown): void }, mode: SandboxMode): void
}

declare module '@deepseek-ai/dsh-user-approval' {
  export type ApprovalPolicy = 'never' | 'ask' | 'always'
  export function setApprovalPolicy(session: { append(type: string, data: unknown): void }, policy: ApprovalPolicy): void
}

declare module '@deepseek-ai/dsh-token-meter/client' {
  import type { SessionEvent } from '@deepseek-ai/dsh-session'

  export interface TurnTokenUsageRoute {
    readonly provider: string
    readonly model: string
  }

  export interface TurnTokenUsage {
    readonly uncachedInputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
    readonly cacheReadTokens?: number
    readonly cacheWriteTokens?: number
    readonly reasoningTokens?: number
    readonly routes?: readonly TurnTokenUsageRoute[]
  }

  export function deriveTurnTokenUsage(events: readonly SessionEvent[]): TurnTokenUsage | undefined
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  export type PropsRuntime<K extends string> = {
    readonly sessionId: string
    readonly [key: string]: any
  }
  export type PropsLocale<N extends string> = {
    readonly t: (key: any, params?: Record<string, unknown>) => string
  }
}

declare module '@deepseek-ai/dsh-client-locale/client' {}
declare module '@deepseek-ai/dsh-client-ui-chat/client' {}
declare module '@deepseek-ai/dsh-client-ui-commands/client' {
  export interface ClientSessionContext {
    readonly sessionId: string
  }

  export interface SelectOption {
    readonly id: string
    readonly label: string
    readonly detail?: string
    readonly active?: boolean
    readonly confirmation?: {
      readonly title: string
      readonly description: string
      readonly acknowledgeLabel: string
      readonly cancelLabel: string
      readonly confirmLabel: string
    }
  }

  export interface CommandContribution {
    readonly name: string
    /** Localized row copy, read on every candidate pass (alpha.2 callback form). */
    label?(): string
    description?(): string
    available(session: ClientSessionContext): boolean
    readonly ui: {
      readonly kind: 'popupSelect'
      options(session: ClientSessionContext, signal: AbortSignal): Promise<readonly SelectOption[]>
      onSelect(option: SelectOption, session: ClientSessionContext): void | Promise<void>
    }
  }

  export interface CommandUiContract {
    register(contribution: CommandContribution): () => void
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly commandUi: import('@deepseek-ai/dsh-client-ui-commands/client').CommandUiContract
  }
}

declare module '@deepseek-ai/dsh-client-ui-workspace/client' {
  /**
   * Narrow non-authoritative view of the real alpha.2 navigation capability
   * (lib/types/client/navigation.d.ts). The real check is
   * `pnpm check:plugin-alpha2`; here it only keeps standalone builds honest
   * about the one method the plugin consumes.
   */
  export interface UiWorkspace {
    openSession(target: string): void
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {}
declare module '@deepseek-ai/dsh-client-ui-renderer/client' {}
declare module '@deepseek-ai/dsh-client-ui-session/client' {}
