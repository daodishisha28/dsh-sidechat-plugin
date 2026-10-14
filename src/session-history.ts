/**
 * Central alpha.2 history access. `agent.session.events`, `eventAt()`,
 * `snapshotEvents()`, and `ownEvents()` no longer exist for new code: callers
 * needing message bodies use `sessionQuery.readSession()` or the caller-owned
 * `observeSession()` lease, and callers needing only the tail position use
 * `session.seq` — the next-event offset, i.e. the log length (half-open).
 */
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { sideChatSourceOf } from './message-source.ts'
import type { SessionIdentity } from './types.ts'

/** Exact raw-log snapshot returned by `sessionQuery.readSession`. */
export interface SessionLog {
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  readonly events: readonly SessionEvent[]
}

interface SessionQueryLike {
  readSession(sessionId: SessionId): Promise<{
    session: SessionHeader
    inheritedEventCount: number
    events: readonly SessionEvent[]
  }>
}

/** Read one complete raw log. The detached snapshot is safe for pure reads. */
export async function readRawLog(sessionQuery: SessionQueryLike, sessionId: string): Promise<SessionLog> {
  const snapshot = await sessionQuery.readSession(SessionId(sessionId))
  return {
    header: snapshot.session,
    inheritedEventCount: snapshot.inheritedEventCount,
    events: snapshot.events,
  }
}

/** Next-event offset of a raw log (=== events.length for a complete log). */
export function logNextSeq(log: SessionLog): number {
  const last = log.events.at(-1)
  return last === undefined ? 0 : last.seq + 1
}

/** Live tail offset of an attached session: `session.seq` is the next offset. */
export function liveNextSeq(session: { readonly seq: number }): number {
  return session.seq
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function messageText(value: unknown): string {
  const message = object(value)
  const content = message?.['content']
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => {
    const block = object(part)
    return block?.['type'] === 'text' && typeof block['text'] === 'string' ? [block['text']] : []
  }).join('\n').trim()
}

function messageIdOf(value: unknown): string | undefined {
  const message = object(value)
  const id = message?.['id']
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** Directly-authored assistant text choices with their stable message ids. */
export function assistantChoices(events: readonly SessionEvent[]): { messageId: string; text: string; seq: number }[] {
  const result: { messageId: string; text: string; seq: number }[] = []
  for (const event of events) {
    const choice = directAssistantChoice(event)
    if (choice !== undefined) result.push(choice)
  }
  return result
}

/**
 * One directly-authored assistant choice from a single `assistant/message`
 * event, or undefined: nonempty text, a stable message id, and no surface
 * replacement (surfaceOp undefined or the plain 'append' marker).
 */
function directAssistantChoice(event: SessionEvent): { messageId: string; text: string; seq: number } | undefined {
  if (event.type !== 'assistant/message') return undefined
  if (object(event.data)?.['interrupted'] === true) return undefined
  const surfaceOp = (event as SessionEvent & { surfaceOp?: unknown }).surfaceOp
  if (surfaceOp !== undefined && surfaceOp !== 'append') return undefined
  const message = object(event.data)?.['message']
  const text = messageText(message)
  const messageId = messageIdOf(message)
  if (text === '' || messageId === undefined) return undefined
  return { messageId, text, seq: event.seq }
}

/**
 * Final directly-authored assistant choice at or after the exclusive
 * `nextSeq` baseline: the generation window's completed answer.
 *
 * The LAST (highest-seq) eligible choice wins, not the first — a planning or
 * tool-step narration assistant message inside the window must never become
 * the Fold payload in place of the final direct answer. Surface replacement
 * copies (compaction rewrites whose `surfaceOp` is a replace object) are
 * excluded; only direct events (surfaceOp undefined or the plain 'append'
 * marker) count as directly authored.
 */
export function finalAssistantAtOrAfter(
  events: readonly SessionEvent[],
  nextSeq: number,
): { messageId: string; text: string; seq: number } | undefined {
  let final: { messageId: string; text: string; seq: number } | undefined
  for (const event of events) {
    if (event.seq < nextSeq) continue
    const choice = directAssistantChoice(event)
    if (choice !== undefined) final = choice
  }
  return final
}

/**
 * The admitted turn of one claimed prompt message.
 *
 * Upstream `agent.followup` returns void: the queued message is claimed when
 * its turn opens, and the durable log records it as that turn's `user/message`
 * — the event data IS the UserMessage and carries its stable `id`
 * (packages/core/session/src/types.ts:302-309; the id is minted by
 * `createUserMessage` before the queueing call). `turn/start` events carry
 * `{ turn }` (types.ts:283-288), so the turn containing the prompt is the
 * turn of the last `turn/start` at or before the prompt event's seq. A
 * `user/message` whose id matches but that never followed a `turn/start`
 * (or an id that never appears at all) has no admitted turn.
 */
export function locatePromptTurn(
  events: readonly SessionEvent[],
  promptMessageId: string,
  nextSeq = 0,
): { readonly turn: number; readonly seq: number } | undefined {
  let turn: number | undefined
  for (const event of events) {
    if (event.seq < nextSeq) continue
    const surfaceOp = (event as SessionEvent & { surfaceOp?: unknown }).surfaceOp
    if (surfaceOp !== undefined && surfaceOp !== 'append') continue
    if (event.type === 'turn/start') {
      const value = object(event.data)?.['turn']
      if (typeof value === 'number') turn = value
      continue
    }
    if (event.type === 'turn/end') {
      turn = undefined
      continue
    }
    if (event.type !== 'user/message') continue
    if (messageIdOf(event.data) !== promptMessageId) continue
    return turn === undefined ? undefined : { turn, seq: event.seq }
  }
  return undefined
}

/**
 * Final directly-authored assistant choice INSIDE one admitted turn.
 *
 * `assistant/message` data carries the owning `turn` and `step`
 * (packages/core/session/src/types.ts:334-350), so the selection is bound to
 * the turn that actually answered the bound prompt — never to a later
 * ordinary turn that merely shares the post-baseline window. The exclusive
 * half-open `nextSeq` baseline still applies; surface replacement copies are
 * excluded exactly like {@link finalAssistantAtOrAfter}.
 */
export function finalAssistantInTurn(
  events: readonly SessionEvent[],
  nextSeq: number,
  turn: number,
  endNextSeq = Infinity,
): { messageId: string; text: string; seq: number } | undefined {
  let final: { messageId: string; text: string; seq: number } | undefined
  for (const event of events) {
    if (event.seq < nextSeq || event.seq >= endNextSeq) continue
    if (object(event.data)?.['turn'] !== turn) continue
    const choice = directAssistantChoice(event)
    if (choice !== undefined) final = choice
  }
  return final
}

/** Direct user-role text entries, used for marker scanning and seed reads. */
export function userTextEntries(events: readonly SessionEvent[]): { messageId: string; text: string; seq: number; producer: 'current' | 'legacy' | undefined; source: unknown }[] {
  const result: { messageId: string; text: string; seq: number; producer: 'current' | 'legacy' | undefined; source: unknown }[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const data = object(event.data)
    const source = data?.['source']
    const producer = sideChatSourceOf(source)
    const text = messageText(data)
    const messageId = messageIdOf(data)
    if (text === '' || messageId === undefined) continue
    result.push({ messageId, text, seq: event.seq, producer, source })
  }
  return result
}

export interface DeliveryHit {
  readonly messageId: string
  readonly seq: number
  readonly producer: 'current' | 'legacy'
}

/**
 * Frozen-delivery evidence binding a marker hit to one concrete operation.
 *
 * `noticeSummary` is the bound notice summary exactly as written by
 * `sideChatNoticeSource` (`boundContextSummary` applied — callers bind the raw
 * summary through the same function). `payload` is the EXACT COMPLETE delivery
 * body after a STRUCTURALLY leading marker, produced by
 * {@link deliveryPayloadIdentity} from the exact text the caller froze.
 * Exact full-body equality is the identity test: an entry that merely
 * CONTAINS the payload (same marker, same summary, same leading characters
 * but a different tail) is a different operation and must never match.
 */
export interface DeliveryEvidence {
  readonly noticeSummary: string
  readonly payload: string
}

/**
 * Exact frozen-payload identity of a delivery message: the EXACT COMPLETE text
 * after a STRUCTURALLY leading marker — position 0 after outer trimming, with
 * NO internal whitespace normalization.
 *
 * Outer trimming mirrors the {@link messageText} behavior exactly (the log
 * read path joins text blocks with `\n` and `.trim()`s the result, so a
 * candidate's text is already outer-trimmed); every real producer
 * (`buildFoldParentMessage`, `buildCiteParentMessage`,
 * `buildWithdrawalParentMessage` in src/fold.ts) places the marker at the
 * structural start. Text whose marker is NOT at the structural start has no
 * payload identity: the full trimmed text is returned as a defensive total so
 * it can never equal the body-after-marker identity of a real delivery (and
 * {@link locateSideChatDelivery} rejects such candidates outright).
 */
export function deliveryPayloadIdentity(text: string, marker: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith(marker)) return trimmed
  return trimmed.slice(marker.length)
}

/**
 * Locate one already-delivered SideChat operation by its complete business
 * marker, accepting ONLY actual delivery notifications — never quotations.
 *
 * A hit requires ALL of:
 * 1. a SideChat producer source (current kind or the explicit legacy migrated
 *    identity — arbitrary plugin sources never qualify);
 * 2. the source form `notice` (the shape every real delivery write path uses;
 *    snapshot/Seed messages carry form `snapshot` or no form at all);
 * 3. the exact bound notice summary of this operation;
 * 4. the complete marker text at the STRUCTURAL START of the message text
 *    (position 0 after the outer trim {@link messageText} already applied) —
 *    arbitrary leading text, e.g. a quotation line placed before the marker,
 *    is REJECTED;
 * 5. the EXACT full frozen-payload identity of THIS operation's delivery
 *    text: the candidate's COMPLETE text after the marker — byte-exact, no
 *    internal whitespace normalization — must EQUAL the frozen identity, not
 *    merely contain it. Different internal indentation or line breaks with
 *    otherwise identical words are therefore different operations.
 *
 * A plugin snapshot quoting the full marker and payload, a user pasting
 * marker text, a leading quotation around a real delivery, or a different
 * SideChat operation reusing the same marker and leading payload characters
 * with a different tail therefore never counts as a delivered operation.
 */
export function locateSideChatDelivery(
  events: readonly SessionEvent[],
  marker: string,
  evidence: DeliveryEvidence,
): DeliveryHit | undefined {
  for (const entry of userTextEntries(events)) {
    if (entry.producer === undefined) continue
    const source = entry.source
    if (typeof source !== 'object' || source === null) continue
    if (Reflect.get(source, 'form') !== 'notice') continue
    const summary = Reflect.get(source, 'summary')
    if (typeof summary !== 'string' || summary !== evidence.noticeSummary) continue
    // Structural marker start: `entry.text` is already outer-trimmed by
    // messageText, so position 0 here IS the structural start of the message.
    if (!entry.text.startsWith(marker)) continue
    // Exact full-body identity: the complete exact text after the marker must
    // equal the frozen identity byte-for-byte (no whitespace normalization).
    if (entry.text.slice(marker.length) !== evidence.payload) continue
    return { messageId: entry.messageId, seq: entry.seq, producer: entry.producer }
  }
  return undefined
}

/** Whether any actual SideChat delivery notification (either producer identity) carries the marker plus frozen evidence. */
export function hasSideChatDelivery(events: readonly SessionEvent[], marker: string, evidence: DeliveryEvidence): boolean {
  return locateSideChatDelivery(events, marker, evidence) !== undefined
}

/** Stable creation identity from a raw-log header; never the mutable cwd. */
export function logIdentity(header: SessionHeader): SessionIdentity {
  return {
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  }
}

/** Ordinary unseeded child judgment per the alpha.2 header shape. */
export function isOrdinaryUnseededHeader(
  header: SessionHeader,
  inheritedEventCount: number,
): boolean {
  return header.isSeeded === false
    && header.parentSession === undefined
    && header.origin !== 'subagent'
    && inheritedEventCount === 0
}
