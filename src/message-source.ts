/**
 * Unified V4 message source for every SideChat producer write path.
 *
 * alpha.2 removed the shared `plugin` source kind: each producer declares its
 * own kind by merging into `MessageSourceMap`. All six SideChat write entries
 * (first question, task/summary seed generation, Fold generation/rewrite, and
 * the three parent write-back deliveries) use `plugin:dsh-sidechat` here.
 * Session event types stay ordinary `user/message`; this is only the producer
 * identity inside the message source.
 */
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ContextFormed, ContextSnapshotSection, MessageSourceMap } from '@deepseek-ai/dsh-llm'

/** Producer kind declared for this plugin; identical to the migrated legacy identity. */
export const SIDECHAT_SOURCE_KIND = 'plugin:dsh-sidechat'

/** Legacy pre-alpha.2 source shape written by plugin 0.3.4 logs before migration. */
export interface LegacySideChatSource {
  readonly kind: 'plugin'
  readonly plugin: string
  readonly form?: ContextFormed['form']
  readonly summary?: unknown
  readonly sections?: unknown
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** SideChat producer context: first question, Fold/Cite/withdrawal deliveries. */
    'plugin:dsh-sidechat': { kind: 'plugin:dsh-sidechat' } & ContextFormed
  }
}

export type SideChatSource = MessageSourceMap[typeof SIDECHAT_SOURCE_KIND]

/** Undeclared context — the documented default for plain producer messages. */
export function sideChatSource(): SideChatSource {
  return { kind: SIDECHAT_SOURCE_KIND }
}

/** One-off account of a completed SideChat action, bounded like every notice. */
export function sideChatNoticeSource(summary: string): SideChatSource {
  return { kind: SIDECHAT_SOURCE_KIND, form: 'notice', summary: boundContextSummary(summary) }
}

/** Immutable parent context assembled once for the clarification question. */
export function sideChatSnapshotSource(sections: readonly ContextSnapshotSection[]): SideChatSource {
  return { kind: SIDECHAT_SOURCE_KIND, form: 'snapshot', sections }
}

export function sideChatUserMessage(
  content: readonly ContentBlock[],
  source: SideChatSource,
): ReturnType<typeof createUserMessage> {
  return createUserMessage({ content, source })
}

/**
 * Recognize SideChat-produced message sources without trusting every plugin
 * source: only this plugin's declared kind, plus the explicit legacy
 * pre-alpha.2 producer identity carried by migrated logs.
 */
export function sideChatSourceOf(source: unknown): 'current' | 'legacy' | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const kind = Reflect.get(source, 'kind')
  if (kind === SIDECHAT_SOURCE_KIND) return 'current'
  if (kind !== 'plugin') return undefined
  const plugin = Reflect.get(source, 'plugin')
  return plugin === 'dsh-sidechat' ? 'legacy' : undefined
}
