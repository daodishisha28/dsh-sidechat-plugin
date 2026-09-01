/**
 * Compile-time compatibility facade for the public DSH 0.1.2-alpha.1 APIs
 * consumed by this plugin.
 *
 * DSH provides the real implementations at runtime. Keeping this narrow
 * declaration in-repository lets a fresh Git clone typecheck and build without
 * requiring a sibling checkout of the DSH monorepo. `verify:contracts` pins the
 * facade to the peer dependency baseline; maintainers can additionally point
 * `DSH_SOURCE_DIR` at a DSH checkout for source-anchor verification.
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

  export class BlockAssembler {
    readonly usage?: TokenUsage
    readonly finish:
      | { readonly kind: 'error' | 'aborted'; readonly failure: { readonly message: string } }
      | { readonly kind: 'stop' | 'length' | 'tool-calls' | 'other'; readonly failure?: never }
    push(chunk: unknown): void
    blocks(): readonly ContentBlock[]
  }

  export function boundContextSummary(value: string): unknown
  export function createUserMessage(value: Record<string, unknown>): unknown
}

declare module '@deepseek-ai/dsh-session' {
  export type SessionId = string
  export function SessionId(value: string): SessionId

  export interface SessionHeader {
    readonly id?: SessionId
    readonly createdAt: number
    readonly cwd?: string
    readonly origin?: string
    readonly parentSession?: string
    readonly seedLength?: number
  }

  export interface SessionEvent {
    readonly seq: number
    readonly time?: number
    readonly type: string
    readonly data: any
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
  import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

  export interface AgentSession {
    readonly id: SessionId
    readonly header: SessionHeader
    readonly events: SessionEvent[]
    append(type: string, data: unknown, options?: unknown): void
    requestContext(): import('@deepseek-ai/dsh-session').RequestContext | undefined
  }

  export interface Agent {
    readonly id: SessionId
    readonly status: 'idle' | 'running'
    readonly ctx: {
      readonly compaction?: import('@deepseek-ai/dsh-compaction').CompactionEngine
      readonly tools: {
        schemas(agent: Agent): readonly { readonly name: string }[]
        register(definition: unknown): () => void
        restrict(filter: { readonly allow: readonly string[] }): () => void
      }
      readonly systemPrompt: {
        section(section: { readonly name: string; readonly order?: number; readonly text: string }): () => void
      }
    }
    readonly session: AgentSession
    readonly options: {
      readonly provider?: string
      readonly model?: string
      readonly reasoningEffort?: string
    }
    followup(message: unknown): void
    whenIdle(): Promise<void>
    runMaintenance<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
  }
}

declare module '@deepseek-ai/dsh-agent-presets' {}
declare module '@deepseek-ai/dsh-api-session-controller' {}
declare module '@deepseek-ai/dsh-compaction' {
  import type { Agent } from '@deepseek-ai/dsh-agent'

  export interface CompactionResult {
    readonly compactionId: string
  }

  export abstract class CompactionEngine {
    abstract compactNow(agent: Agent, signal: AbortSignal): Promise<CompactionResult | null>
  }
}
declare module '@deepseek-ai/dsh-session-query' {}
declare module '@deepseek-ai/dsh-system-prompt' {}

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

  export interface ToolExecutionContext {
    readonly agent?: Agent
    readonly signal: AbortSignal
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

  export function defineTool(definition: ToolDefinition): ToolDefinition
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
    readonly description: string
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

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {}
declare module '@deepseek-ai/dsh-client-ui-renderer/client' {}
declare module '@deepseek-ai/dsh-client-ui-session/client' {}
