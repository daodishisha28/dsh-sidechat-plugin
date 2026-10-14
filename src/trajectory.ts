import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  DEFAULT_TRAJECTORY_FALLBACK_MAX_TOKENS,
  DEFAULT_TRAJECTORY_MAX_ITEMS,
  type TrajectoryChoice,
  type TrajectoryDetail,
  type TrajectoryKind,
  type TrajectoryOverview,
  type TrajectorySnapshot,
} from './types.ts'

export const TRAJECTORY_PROJECTION_VERSION = 'trajectory-v5'
export const TRAJECTORY_PREVIEW_MAX_CHARS = 4_000

export interface TrajectorySelectionBudget {
  readonly maxItems: number
  readonly maxTokens: number
  readonly maxChars: number
  readonly description: string
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function number(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((part) => {
    const item = object(part)
    return item?.['type'] === 'text' && typeof item['text'] === 'string' ? [item['text']] : []
  }).join('\n').trim()
}

const SECRET_KEY = /authorization|api[-_]?key|cookie|credential|password|secret|token|env(?:ironment)?/iu
const SECRET_VALUE = /(bearer\s+)[a-z0-9._~+/-]+=*|\b(?:sk|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{12,}/giu
const TOOL_FIELD_ALLOWLIST = new Set([
  'arguments', 'code', 'column', 'command', 'content', 'count', 'cwd', 'data', 'description',
  'duration', 'encoding', 'end', 'entries', 'error', 'exclude', 'exitCode', 'file', 'files',
  'id', 'include', 'input', 'items', 'kind', 'language', 'limit', 'line', 'lines', 'matches',
  'message', 'method', 'name', 'offset', 'output', 'path', 'pattern', 'prompt', 'provider', 'query',
  'recursive', 'result', 'size', 'start', 'status', 'stderr', 'stdout', 'success', 'text', 'title',
  'tool', 'type', 'url', 'value', 'workdir', 'model', 'reasoningEffort',
])

function sanitizeText(text: string): { text: string; redacted: boolean } {
  const next = text
    .replace(SECRET_VALUE, (_match, prefix: string | undefined) => `${prefix ?? ''}[REDACTED]`)
    .replace(/\b[a-z]:\\(?:[^\s"'<>|]+\\)*[^\s"'<>|]*/giu, '[ABSOLUTE_PATH]')
    .replace(/(?<![\w:])\/(?:Users|home|root|etc|var|opt|tmp)\/[^\s"'<>|]*/gu, '[ABSOLUTE_PATH]')
  return { text: next, redacted: next !== text }
}

function safeProjection(value: unknown, depth = 0): { value: unknown; redacted: boolean } {
  if (depth > 4) return { value: '[TRUNCATED]', redacted: true }
  if (typeof value === 'string') {
    const sanitized = sanitizeText(value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value)
    return { value: sanitized.text, redacted: sanitized.redacted }
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return { value, redacted: false }
  if (Array.isArray(value)) {
    let redacted = value.length > 24
    const projected = value.slice(0, 24).map(item => {
      const next = safeProjection(item, depth + 1)
      redacted ||= next.redacted
      return next.value
    })
    return { value: projected, redacted }
  }
  const record = object(value)
  if (record === undefined) return { value: String(value), redacted: false }
  const output: Record<string, unknown> = {}
  let redacted = false
  for (const [key, item] of Object.entries(record)) {
    if (SECRET_KEY.test(key)) { output[key] = '[REDACTED]'; redacted = true; continue }
    if (!TOOL_FIELD_ALLOWLIST.has(key)) { redacted = true; continue }
    const next = safeProjection(item, depth + 1)
    output[key] = next.value
    redacted ||= next.redacted
  }
  return { value: output, redacted }
}

function rawToolText(value: unknown): string {
  if (typeof value === 'string') return value
  const serialized = JSON.stringify(value, null, 2)
  return serialized ?? String(value)
}

function boundedPreview(text: string): { preview: string; truncated: boolean } {
  if (text.length <= TRAJECTORY_PREVIEW_MAX_CHARS) return { preview: text, truncated: false }
  return { preview: `${text.slice(0, TRAJECTORY_PREVIEW_MAX_CHARS)}\n…[预览已截断，打开详情查看完整内容]`, truncated: true }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function statusOf(data: Record<string, unknown>): TrajectoryChoice['status'] {
  const reason = object(data['reason'])
  const reasonCause = object(reason?.['reason'])
  const error = object(data['error'])
  const values = [
    string(data['status']),
    string(reason?.['kind']),
    string(reasonCause?.['kind']),
    string(error?.['kind']),
    string(error?.['name']),
    string(error?.['code']),
    string(error?.['message']),
  ].filter((value): value is string => value !== undefined)
  if (values.length === 0) return undefined
  const raw = values.join(' ')
  // AbortError and TOOL_ABORTED_* contain the word "error"; cancellation is
  // the more specific outcome and therefore must win over the error match.
  if (/cancel|abort|interrupt/iu.test(raw)) return 'cancelled'
  if (/error|fail|denied|reject/iu.test(raw)) return 'error'
  if (/run|start|pending/iu.test(raw)) return 'running'
  if (/complete|success|succeed|stop|ok|max[-_ ]?tokens/iu.test(raw)) return 'success'
  return undefined
}

function makeChoice(
  input: Omit<TrajectoryChoice, 'chars' | 'estimatedTokens' | 'digest' | 'truncated' | 'fullContentAvailable'>,
  fullText = input.preview,
  options: { truncated?: boolean; fullContentAvailable?: boolean } = {},
): TrajectoryChoice {
  const chars = fullText.length
  return {
    ...input,
    chars,
    estimatedTokens: Math.ceil(chars / 4),
    truncated: options.truncated ?? false,
    fullContentAvailable: options.fullContentAvailable ?? false,
    digest: digest({ version: TRAJECTORY_PROJECTION_VERSION, ...input, fullText }),
  }
}

function idOf(event: SessionEvent, suffix?: string): string {
  const data = object(event.data)
  const explicit = string(data?.['eventId']) ?? string(data?.['id']) ?? string(object(data?.['message'])?.['id'])
  return suffix === undefined ? explicit ?? `${event.type}:${event.seq}` : `${explicit ?? `${event.type}:${event.seq}`}:${suffix}`
}

/**
 * V4-first tool/result reader. Alpha.2 persists a tool-role message
 * (`ToolResultMessage`: `source: { kind: 'tool', callId }`, plain content
 * blocks, `isError`) plus an optional structured `error`. The legacy
 * tool-result content-block wrapper and flat `data.content`/`data.result`
 * shapes are kept as explicit compatibility branches for old fixtures and
 * migrated logs; new-format evidence always wins.
 */
function toolResultParts(data: Record<string, unknown>): { callId?: string; content: unknown; isError: boolean } {
  const message = object(data['message'])
  const source = object(message?.['source'])
  if (source?.['kind'] === 'tool') {
    const callId = string(source['callId']) ?? string(message?.['toolCallId'])
    return {
      ...(callId === undefined ? {} : { callId }),
      content: message?.['content'],
      isError: message?.['isError'] === true || data['error'] !== undefined,
    }
  }
  const blocks = Array.isArray(message?.['content']) ? message.content : []
  const result = blocks.map(object).find(block => block?.['type'] === 'tool-result')
  const callId = string(data['callId']) ?? string(source?.['callId']) ?? string(result?.['toolCallId'])
  return {
    ...(callId === undefined ? {} : { callId }),
    content: result?.['content'] ?? data['content'] ?? data['result'] ?? data,
    isError: result?.['isError'] === true || data['error'] !== undefined || data['isError'] === true,
  }
}

function sideChatContext(text: string): { label: string; selectable: boolean } | undefined {
  const marker = /^\[SideChat\s+(fold-withdrawal|fold|cite)\b/iu.exec(text)?.[1]?.toLowerCase()
  if (marker === 'fold-withdrawal') return { label: '↩ SideChat Fold 撤回', selectable: false }
  if (marker === 'fold') return { label: '↩ SideChat Fold', selectable: true }
  if (marker === 'cite') return { label: '↩ SideChat Cite', selectable: true }
  return /Fold 回流/iu.test(text) ? { label: '↩ SideChat Fold', selectable: false } : undefined
}

type TurnStatus = Exclude<NonNullable<TrajectoryChoice['status']>, 'running'>

interface TurnRecord {
  readonly turn: number
  startSeq?: number
  startTime?: number
  endSeq?: number
  endTime?: number
  reason?: unknown
  firstSeq?: number
  lastSeq?: number
  explicitStart: boolean
  items: TrajectoryChoice[]
}

interface CallRecord {
  readonly key: string
  readonly callId?: string
  readonly name: string
  readonly fullText: string
  readonly seq: number
  readonly eventId: string
  readonly event: SessionEvent
  readonly turn?: number
  readonly step?: number
  readonly subagent: boolean
  readonly parallelGroup?: string
}

interface ResultRecord {
  readonly event: SessionEvent
  readonly callId?: string
  readonly content: unknown
  readonly isError: boolean
  readonly status: NonNullable<TrajectoryChoice['status']>
  /** True when this result is a subagent activation (start acceptance only). */
  readonly activation?: boolean
}

/**
 * Subagent delegation identity, read from the durable `tool/result` content.
 * Two accepted shapes, both grounded in upstream evidence:
 *
 * 1. Rendered activation text — the REAL alpha.2 durable shape. tool-subagent's
 *    `output.render` projects the structured activation value to the
 *    model-facing text `started subagent <subagentId>` and the agent loop
 *    persists exactly that render as the `ToolResultMessage` content
 *    (packages/subagent/tool-subagent/src/index.ts `output.render`;
 *    packages/core/agent-loop/src/tool-calls.ts `createToolResultMessage`).
 * 2. Raw activation value — `{"kind":"activation","subagentId":...}`, the
 *    documented `output.schema` shape, kept for logs whose tool did not
 *    render (or migrated fixtures carrying the value verbatim).
 *
 * Tool names are deliberately NOT an identity signal: `toolName` is
 * config-driven (`toolName` defaults to `subagent` but any name can be
 * configured, and an unrelated tool may share an alias), so a name match
 * alone would misclassify foreign tools and claim unsettled calls. A call is
 * a delegation only when its settled result carries the activation identity;
 * a call whose result is not activation-shaped is definitively NOT a
 * subagent, and a call with no settled result is never claimed as one.
 */
function activationOf(value: unknown): { readonly subagentId: string } | undefined {
  const blocks = Array.isArray(value) ? value : [value]
  for (const block of blocks) {
    const item = object(block)
    const text = typeof item?.['text'] === 'string'
      ? item['text']
      : typeof block === 'string' ? block : undefined
    if (text === undefined) continue
    // Real alpha.2 durable shape: the rendered activation notice.
    const rendered = /^started subagent (\S+)$/u.exec(text)
    if (rendered !== null) return { subagentId: rendered[1]! }
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { continue }
    const record = object(parsed)
    if (record === undefined) continue
    const subagentId = string(record['subagentId'])
    if (record['kind'] === 'activation' && subagentId !== undefined) return { subagentId }
  }
  return undefined
}

function trajectoryEvent(event: SessionEvent): boolean {
  // Compaction replacement nodes are snapshots of prior surface content, not
  // another execution. Log-only and append-origin events retain their source
  // position and are therefore eligible for the execution trace.
  const surfaceOp = (event as SessionEvent & { surfaceOp?: unknown }).surfaceOp
  return surfaceOp === undefined || surfaceOp === 'append'
}

function messageOf(event: SessionEvent): Record<string, unknown> {
  const data = object(event.data) ?? {}
  return object(data['message']) ?? data
}

function toolCallBlocks(event: SessionEvent): { item: Record<string, unknown>; index: number }[] {
  const message = messageOf(event)
  const blocks = Array.isArray(message['content']) ? message['content'] : []
  return blocks.flatMap((block, index) => {
    const item = object(block)
    return item?.['type'] === 'tool-call' ? [{ item, index }] : []
  })
}

function turnStatus(reason: unknown): TurnStatus | undefined {
  const kind = string(object(reason)?.['kind'])
  if (kind === undefined) return undefined
  if (/abort|cancel|interrupt/iu.test(kind)) return 'cancelled'
  if (/error|fail|blocked|denied|reject/iu.test(kind)) return 'error'
  if (/complete|max[-_ ]?tokens|success|stop/iu.test(kind)) return 'success'
  return undefined
}

function compareEvents(left: SessionEvent, right: SessionEvent): number {
  return left.seq - right.seq
}

function timeOf(event: SessionEvent): number | undefined {
  return typeof event.time === 'number' ? event.time : undefined
}

export function projectTrajectory(sourceSessionId: string, events: readonly SessionEvent[]): TrajectoryChoice[] {
  const orderedEvents = events.filter(trajectoryEvent).slice().sort(compareEvents)
  const output: TrajectoryChoice[] = []
  const turnRecords = new Map<number, TurnRecord>()
  const callRecords = new Map<string, CallRecord>()
  const results = new Map<string, ResultRecord>()
  const canonicalCallKeys = new Set<string>()
  const assistantCallIds = new Map<number, string[]>()

  const ensureTurn = (turn: number, explicitStart = false): TurnRecord => {
    const existing = turnRecords.get(turn)
    if (existing !== undefined) {
      if (explicitStart) existing.explicitStart = true
      return existing
    }
    const created: TurnRecord = { turn, explicitStart, items: [] }
    turnRecords.set(turn, created)
    return created
  }
  const touchTurn = (turn: number | undefined, event: SessionEvent): void => {
    if (turn === undefined) return
    const record = ensureTurn(turn)
    record.firstSeq = record.firstSeq === undefined ? event.seq : Math.min(record.firstSeq, event.seq)
    record.lastSeq = record.lastSeq === undefined ? event.seq : Math.max(record.lastSeq, event.seq)
  }
  const resultForCall = (callId: string | undefined): ResultRecord | undefined =>
    callId === undefined ? undefined : results.get(callId)

  // Collect lifecycle boundaries before rendering calls. A call can occur
  // before a cancelled turn's `turn/end`, but its final status must still
  // reflect that terminal boundary.
  let lifecycleTurn: number | undefined
  for (const event of orderedEvents) {
    const data = object(event.data) ?? {}
    const eventTurn = number(data['turn'])
    if (event.type === 'turn/start') {
      const turn = eventTurn ?? lifecycleTurn
      if (turn !== undefined) {
        const record = ensureTurn(turn, true)
        record.startSeq = event.seq
        const eventTime = timeOf(event)
        if (eventTime !== undefined) record.startTime = eventTime
        record.firstSeq = record.firstSeq === undefined ? event.seq : Math.min(record.firstSeq, event.seq)
        record.lastSeq = record.lastSeq === undefined ? event.seq : Math.max(record.lastSeq, event.seq)
        lifecycleTurn = turn
      }
      continue
    }
    if (event.type === 'turn/end') {
      const turn = eventTurn ?? lifecycleTurn
      if (turn !== undefined) {
        const record = ensureTurn(turn)
        record.endSeq = event.seq
        const eventTime = timeOf(event)
        if (eventTime !== undefined) record.endTime = eventTime
        record.reason = data['reason']
        record.firstSeq = record.firstSeq === undefined ? event.seq : Math.min(record.firstSeq, event.seq)
        record.lastSeq = record.lastSeq === undefined ? event.seq : Math.max(record.lastSeq, event.seq)
      }
      lifecycleTurn = undefined
    }
  }

  // Canonical log-only tool/call events are the source of truth for calls.
  // Assistant blocks are retained only when the canonical event is absent.
  for (const event of orderedEvents) {
    const data = object(event.data) ?? {}
    if (event.type === 'tool/call') {
      const callId = string(data['callId'])
      const key = callId ?? `event:${event.seq}`
      const name = string(data['name']) ?? 'tool'
      const fullText = rawToolText(data['arguments'] ?? data['input'] ?? {})
      // Classification is evidence-based: the result-identity pass below marks
      // the call a subagent only when its settled result carries the
      // activation identity. A name match alone is never sufficient.
      const subagent = false
      const callTurn = number(data['turn'])
      const callStep = number(data['step'])
      callRecords.set(key, {
        key,
        ...(callId === undefined ? {} : { callId }),
        name,
        fullText,
        seq: event.seq,
        eventId: callId ?? idOf(event),
        event,
        ...(callTurn === undefined ? {} : { turn: callTurn }),
        ...(callStep === undefined ? {} : { step: callStep }),
        subagent,
      })
      canonicalCallKeys.add(key)
    }
    if (event.type === 'tool/result' || /tool.*result/iu.test(event.type)) {
      const parts = toolResultParts(data)
      if (parts.callId !== undefined) {
        const status = statusOf(data) ?? (parts.isError ? 'error' : 'success')
        results.set(parts.callId, {
          event,
          callId: parts.callId,
          content: parts.content,
          isError: parts.isError,
          status,
          ...(activationOf(parts.content) !== undefined ? { activation: true } : {}),
        })
      }
    }
    if (event.type !== 'assistant/message') continue
    const blocks = toolCallBlocks(event)
    const ids: string[] = []
    for (const { item, index } of blocks) {
      const callId = string(item['id']) ?? idOf(event, `call-${index}`)
      ids.push(callId)
      if (callRecords.has(callId)) continue
      const name = string(item['name']) ?? 'tool'
      const fullText = rawToolText(item['arguments'] ?? item['input'] ?? {})
      // Evidence-based classification (see the result-identity pass below):
      // assistant-block fallback calls start unclassified like canonical ones.
      const subagent = false
      const messageData = object(event.data) ?? {}
      const callTurn = number(messageData['turn'])
      const callStep = number(messageData['step'])
      callRecords.set(callId, {
        key: callId,
        callId,
        name,
        fullText,
        seq: event.seq,
        eventId: callId,
        event,
        ...(callTurn === undefined ? {} : { turn: callTurn }),
        ...(callStep === undefined ? {} : { step: callStep }),
        subagent,
      })
    }
    if (ids.length > 0) assistantCallIds.set(event.seq, ids)
  }

  // A response batch is exactly one assistant response containing multiple
  // calls. The group is descriptive only; it does not assert parallelism.
  for (const [assistantSeq, ids] of assistantCallIds) {
    if (ids.length < 2) continue
    const parallelGroup = `response-${assistantSeq}`
    for (const id of ids) {
      const call = callRecords.get(id)
      if (call === undefined) continue
      callRecords.set(id, { ...call, parallelGroup })
    }
  }

  // Result-identity recognition for delegation calls: a durable tool/result
  // whose content carries the subagent activation identity marks the call as a
  // delegation, whatever its configured tool name. This is the ONLY
  // classification signal — see `activationOf` for the accepted shapes and why
  // name aliases are not evidence. A call without a settled activation result
  // keeps its plain tool-call rendering (no inference from partial logs).
  for (const call of [...callRecords.values()]) {
    if (call.subagent || call.callId === undefined) continue
    const result = results.get(call.callId)
    if (result !== undefined && activationOf(result.content) !== undefined) {
      callRecords.set(call.key, { ...call, subagent: true })
    }
  }

  const callStatus = (call: CallRecord): TrajectoryChoice['status'] => {
    const result = resultForCall(call.callId)
    if (result !== undefined) {
      // An activation payload is start acceptance, not a settled outcome: the
      // delegation call stays unknown until real durable evidence arrives.
      if (result.activation === true) return undefined
      return result.status
    }
    const turn = call.turn === undefined ? undefined : turnRecords.get(call.turn)
    const terminal = turnStatus(turn?.reason)
    // A terminal Turn error describes the model/loop as a whole. It does not
    // establish that every call without a recorded result failed. Keep those
    // calls unknown; only an explicit result can classify the tool outcome.
    if (terminal === 'cancelled') return terminal
    if (turn?.endSeq !== undefined) return undefined
    return turn?.startSeq === undefined ? undefined : 'running'
  }
  const callDuration = (call: CallRecord): number | undefined => {
    const result = resultForCall(call.callId)
    const callTime = timeOf(call.event)
    const resultTime = result === undefined ? undefined : timeOf(result.event)
    if (resultTime !== undefined && callTime !== undefined) return Math.max(0, resultTime - callTime)
    const endTime = call.turn === undefined ? undefined : turnRecords.get(call.turn)?.endTime
    return endTime === undefined || callTime === undefined ? undefined : Math.max(0, endTime - callTime)
  }
  const push = (choice: TrajectoryChoice): void => {
    output.push(choice)
    if (choice.turn !== undefined) {
      const turn = ensureTurn(choice.turn)
      turn.items.push(choice)
      touchTurn(choice.turn, orderedEvents.find(event => event.seq === choice.seq) ?? ({ seq: choice.seq, time: 0 } as SessionEvent))
    }
  }

  let currentTurn: number | undefined
  let currentStep: number | undefined
  let currentModelRoute: string | undefined
  // PTC sub-dispatches started inside a `run_code` program, keyed by
  // `subCallId`. Settled starts are removed; anything left after the pass is a
  // start whose settle never reached this log excerpt and stays explicitly
  // unknown instead of being counted as an outcome.
  const ptcStarts = new Map<string, {
    readonly event: SessionEvent
    readonly name: string
    readonly argumentsText: string
    readonly parentCallId?: string
  }>()
  for (const event of orderedEvents) {
    const data = object(event.data) ?? {}
    const explicitTurn = number(data['turn'])
    const explicitStep = number(data['step'])
    if (event.type === 'turn/start') {
      const turn = explicitTurn ?? currentTurn
      if (turn !== undefined) {
        const record = ensureTurn(turn, true)
        record.startSeq = event.seq
        const eventTime = timeOf(event)
        if (eventTime !== undefined) record.startTime = eventTime
        record.firstSeq = record.firstSeq === undefined ? event.seq : Math.min(record.firstSeq, event.seq)
        record.lastSeq = record.lastSeq === undefined ? event.seq : Math.max(record.lastSeq, event.seq)
        currentTurn = turn
      }
      currentStep = undefined
      continue
    }
    if (event.type === 'step/start') {
      currentTurn = explicitTurn ?? currentTurn
      currentStep = explicitStep ?? currentStep
      touchTurn(currentTurn, event)
      continue
    }
    if (event.type === 'step/end') {
      const turn = explicitTurn ?? currentTurn
      touchTurn(turn, event)
      if (explicitTurn === undefined || explicitTurn === currentTurn) currentStep = undefined
      continue
    }
    if (event.type === 'turn/end') {
      const turn = explicitTurn ?? currentTurn
      if (turn !== undefined) {
        const record = ensureTurn(turn)
        record.endSeq = event.seq
        const eventTime = timeOf(event)
        if (eventTime !== undefined) record.endTime = eventTime
        record.reason = data['reason']
        record.firstSeq = record.firstSeq === undefined ? event.seq : Math.min(record.firstSeq, event.seq)
        record.lastSeq = record.lastSeq === undefined ? event.seq : Math.max(record.lastSeq, event.seq)
      }
      currentTurn = undefined
      currentStep = undefined
      continue
    }

    const linkedCallId = event.type === 'tool/result' || /tool.*result/iu.test(event.type)
      ? toolResultParts(data).callId
      : string(data['callId'])
    const linkedCall = linkedCallId === undefined ? undefined : callRecords.get(linkedCallId)
    const turn = explicitTurn ?? linkedCall?.turn ?? currentTurn
    const step = explicitStep ?? linkedCall?.step ?? currentStep
    touchTurn(turn, event)

    if (event.type === 'user/message') {
      const source = object(data['source'])
      const raw = contentText(data['content'])
      const context = source?.['kind'] === 'plugin' ? sideChatContext(raw) : undefined
      if (context !== undefined) {
        const clean = sanitizeText(raw)
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'fold-note', label: context.label, preview: clean.text, redacted: clean.redacted, selectable: context.selectable, status: 'success' }))
      } else if (source?.['kind'] === 'user' && raw !== '') {
        const clean = sanitizeText(raw)
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'user', label: raw.replace(/\s+/gu, ' ').slice(0, 72), preview: clean.text, redacted: clean.redacted, selectable: true, status: 'success' }))
      }
      continue
    }
    if (event.type === 'request/header') {
      const header = object(data['header'])
      const config = object(header?.['config'])
      const provider = string(config?.['provider']) ?? 'model'
      const model = string(config?.['model']) ?? 'unknown'
      // request/header is a sparse route/config checkpoint (initial/resume/
      // change/series), not one model invocation per step. Keep it as the
      // route source for the next assistant response instead of rendering a
      // duplicate request node.
      currentModelRoute = `${provider}/${model}`
      continue
    }
    if (event.type === 'assistant/message') {
      const message = messageOf(event)
      const source = object(message['source'])
      const model = string(source?.['model']) ?? string(data['model'])
      const route = model === undefined
        ? currentModelRoute
        : `${string(source?.['provider']) ?? 'model'}/${model}`
      if (route !== undefined) {
        const status = data['interrupted'] === true ? 'cancelled' : 'success'
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event, 'request'), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'request', label: route, preview: `provider/model: ${route}`, redacted: false, selectable: true, model: route, status }))
      }
      for (const { item, index } of toolCallBlocks(event)) {
        const callId = string(item['id']) ?? idOf(event, `call-${index}`)
        if (canonicalCallKeys.has(callId)) continue
        const call = callRecords.get(callId)
        if (call === undefined) continue
        const { preview, truncated } = boundedPreview(call.fullText)
        const resolvedStatus = callStatus({ ...call, ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }) })
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: call.eventId, ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: call.subagent ? 'subagent' : 'tool-call', label: call.subagent ? `Task: ${call.name}` : call.name, preview, redacted: false, selectable: true, ...(call.callId === undefined ? {} : { callId: call.callId }), toolName: call.name, ...(call.parallelGroup === undefined ? {} : { parallelGroup: call.parallelGroup }), ...(resolvedStatus === undefined ? {} : { status: resolvedStatus }), ...(callDuration(call) === undefined ? {} : { durationMs: callDuration(call) }) }, call.fullText, { truncated, fullContentAvailable: true }))
      }
      const raw = contentText(message['content'])
      if (raw !== '') {
        const clean = sanitizeText(raw)
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event, 'final'), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'assistant', label: data['interrupted'] === true ? 'assistant (interrupted)' : 'assistant ✓', preview: clean.text, redacted: clean.redacted, selectable: true, status: data['interrupted'] === true ? 'cancelled' : 'success' }))
      }
      continue
    }
    if (event.type === 'tool/call') {
      const callId = string(data['callId'])
      const call = callRecords.get(callId ?? `event:${event.seq}`)
      if (call === undefined) continue
      const { preview, truncated } = boundedPreview(call.fullText)
      const resolvedStatus = callStatus({ ...call, ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }) })
      push(makeChoice({ sourceSessionId, seq: event.seq, eventId: call.eventId, ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: call.subagent ? 'subagent' : 'tool-call', label: call.subagent ? `Task: ${call.name}` : call.name, preview, redacted: false, selectable: true, ...(call.callId === undefined ? {} : { callId: call.callId }), toolName: call.name, ...(call.parallelGroup === undefined ? {} : { parallelGroup: call.parallelGroup }), ...(resolvedStatus === undefined ? {} : { status: resolvedStatus }), ...(callDuration(call) === undefined ? {} : { durationMs: callDuration(call) }) }, call.fullText, { truncated, fullContentAvailable: true }))
      continue
    }
    if (event.type === 'tool/result' || /tool.*result/iu.test(event.type)) {
      const result = toolResultParts(data)
      const fullText = rawToolText(result.content)
      const { preview, truncated } = boundedPreview(fullText)
      const toolName = string(data['name']) ?? string(data['toolName']) ?? linkedCall?.name ?? 'tool result'
      // A subagent activation payload is acceptance of a delegation START, not
      // the subtask's final answer: leave the status unknown so the response
      // never renders as a completed success.
      const activation = activationOf(result.content)
      const status = activation !== undefined ? undefined : statusOf(data) ?? (result.isError ? 'error' : 'success')
      const linkedCallTime = linkedCall === undefined ? undefined : timeOf(linkedCall.event)
      const resultTime = timeOf(event)
      push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: status === 'error' ? 'error' : 'tool-result', label: toolName, preview, redacted: false, selectable: true, ...(result.callId === undefined ? {} : { callId: result.callId }), toolName, ...(status === undefined ? {} : { status }), ...(linkedCallTime === undefined || resultTime === undefined ? {} : { durationMs: Math.max(0, resultTime - linkedCallTime) }) }, fullText, { truncated, fullContentAvailable: true }))
      continue
    }
    if (event.type === 'tool/ptc-dispatch-start') {
      const subCallId = string(data['subCallId'])
      if (subCallId !== undefined) {
        const parentCallId = string(data['parentCallId'])
        ptcStarts.set(subCallId, {
          event,
          name: string(data['name']) ?? 'ptc',
          argumentsText: rawToolText(data['arguments'] ?? {}),
          ...(parentCallId === undefined ? {} : { parentCallId }),
        })
      }
      continue
    }
    if (event.type === 'tool/ptc-dispatch') {
      const subCallId = string(data['subCallId'])
      const start = subCallId === undefined ? undefined : ptcStarts.get(subCallId)
      if (subCallId !== undefined) ptcStarts.delete(subCallId)
      // PTC dispatch payloads carry no turn/step of their own; the enclosing
      // `run_code` call record (paired by parentCallId) owns the position.
      const parent = start?.parentCallId === undefined ? undefined : callRecords.get(start.parentCallId)
      const ptcTurn = parent?.turn ?? turn
      const ptcStep = parent?.step ?? step
      const name = start?.name ?? string(data['name']) ?? 'ptc'
      const isError = data['isError'] === true || data['error'] !== undefined
      const status = statusOf(data) ?? (isError ? 'error' : 'success')
      // `meta` is tool-owned presentation metadata: it is deliberately not
      // rendered as model content, execution output, or a usage sample.
      const fullText = rawToolText(data['content'] ?? {})
      const { preview, truncated } = boundedPreview(fullText)
      push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(ptcTurn === undefined ? {} : { turn: ptcTurn }), ...(ptcStep === undefined ? {} : { step: ptcStep }), kind: 'ptc', label: `${name} · PTC`, preview, redacted: false, selectable: true, ...(subCallId === undefined ? {} : { callId: subCallId }), toolName: name, ...(status === undefined ? {} : { status }) }, fullText, { truncated, fullContentAvailable: true }))
      continue
    }
    if (event.type === 'assistant/attempt') {
      // One model attempt that committed no surface message (failed, retried,
      // cancelled, or stream-error). It is not a projected assistant answer
      // and must never render as a successful model response; the final
      // settled response is visible through `assistant/message`. A dedicated
      // attempt lane is a documented later expansion — absence of a node is
      // never read as success here.
      continue
    }
    if (/model.*request|request.*model/iu.test(event.type)) {
      const projected = safeProjection(data)
      const model = string(data['model']) ?? 'model request'
      push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'request', label: model, preview: JSON.stringify(projected.value, null, 2), redacted: projected.redacted, selectable: true, model, status: statusOf(data) ?? 'running' }))
      continue
    }
    if (/error/iu.test(event.type)) {
      const projected = safeProjection(data)
      push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'error', label: string(data['message']) ?? 'Error', preview: JSON.stringify(projected.value, null, 2), redacted: projected.redacted, selectable: true, ...(linkedCallId === undefined ? {} : { callId: linkedCallId }), status: statusOf(data) ?? 'error' }))
    }
  }

  // A started PTC sub-dispatch whose settle never reached this log excerpt
  // stays explicitly unknown — neither a completed success nor a guessed
  // failure (every started dispatch settles in a complete log). It is also
  // NOT selectable: `trajectoryDetail` reads exact raw content only from the
  // settled `tool/ptc-dispatch` event, so advertising full content for a bare
  // start would make every selection throw "raw content is unavailable". The
  // start stays visible with its 未结算 label and unknown status.
  for (const [subCallId, start] of ptcStarts) {
    const parent = start.parentCallId === undefined ? undefined : callRecords.get(start.parentCallId)
    const { preview } = boundedPreview(start.argumentsText)
    push(makeChoice({ sourceSessionId, seq: start.event.seq, eventId: idOf(start.event), ...(parent?.turn === undefined ? {} : { turn: parent.turn }), ...(parent?.step === undefined ? {} : { step: parent.step }), kind: 'ptc', label: `${start.name} · PTC（未结算）`, preview, redacted: false, selectable: false, callId: subCallId, toolName: start.name }, start.argumentsText, { fullContentAvailable: false }))
  }

  const turns = [...turnRecords.values()].map(record => {
    const items = record.items.slice().sort((left, right) => left.seq - right.seq)
    const preview = items.length === 0
      ? `Turn ${record.turn} (empty)`
      : items.map(item => `[${item.kind}] ${item.label}`).join('\n')
    // A turn without authoritative lifecycle boundaries is a partial log;
    // do not infer successful completion from an observed child event.
    const status = turnStatus(record.reason)
      ?? (record.endSeq !== undefined ? undefined : record.startSeq === undefined ? undefined : 'running')
    const start = record.startTime
    const end = record.endTime ?? (record.lastSeq === undefined ? undefined : orderedEvents.find(event => event.seq === record.lastSeq)?.time)
    const durationMs = start === undefined || end === undefined ? undefined : Math.max(0, end - start)
    return makeChoice({ sourceSessionId, seq: record.startSeq ?? record.firstSeq ?? record.endSeq ?? 0, eventId: `turn:${record.turn}`, turn: record.turn, kind: 'turn' as const, label: `Turn ${record.turn}`, preview, redacted: items.some(item => item.redacted), selectable: true, status, ...(durationMs === undefined ? {} : { durationMs }) })
  })
  return [...turns, ...output].sort((left, right) => left.seq - right.seq || (left.kind === 'turn' ? -1 : right.kind === 'turn' ? 1 : 0))
}

export function trajectoryOverview(items: readonly TrajectoryChoice[], events: readonly SessionEvent[], capturedThroughSeq: number): TrajectoryOverview {
  const times = events.filter(trajectoryEvent).flatMap(event => typeof event.time === 'number' ? [event.time] : [])
  const calls = items.filter(item => item.kind === 'tool-call' || item.kind === 'subagent')
  const failedCallIds = new Set(calls.flatMap(item => item.status === 'error' && item.callId !== undefined ? [item.callId] : []))
  const turnFailures = new Set(items.flatMap(item => item.kind === 'turn' && item.status === 'error' && item.turn !== undefined ? [item.turn] : []))
  const concreteFailureTurns = new Set(items.flatMap(item => item.kind !== 'turn' && item.status === 'error' && item.turn !== undefined ? [item.turn] : []))
  const failures = new Set<string>()
  for (const item of items) {
    if (item.status !== 'error') continue
    if (item.kind === 'turn' && item.turn !== undefined && concreteFailureTurns.has(item.turn)) continue
    if (item.kind === 'error' && item.callId === undefined && item.turn !== undefined && concreteFailureTurns.has(item.turn)) {
      // An unlinked error event in a failed turn is an aggregate diagnostic;
      // concrete failed calls/results already account for that failure.
      continue
    }
    if (item.callId !== undefined && failedCallIds.has(item.callId)) {
      // One logical failed call may appear as a call, a result, and an error
      // companion. Its callId is the deduplication key for all three.
      failures.add(`call:${item.callId}`)
      continue
    }
    if (item.turn !== undefined && turnFailures.has(item.turn)) {
      // A model/request error and its terminal turn reason describe one
      // failed turn when no callId is available.
      failures.add(`turn:${item.turn}`)
      continue
    }
    failures.add(`item:${item.seq}:${item.eventId}`)
  }
  return {
    turns: items.filter(item => item.kind === 'turn').length,
    calls: calls.length,
    subagents: items.filter(item => item.kind === 'subagent').length,
    failures: failures.size,
    durationMs: times.length < 2 ? 0 : Math.max(...times) - Math.min(...times),
    capturedThroughSeq,
  }
}

function exactToolText(event: SessionEvent, eventId: string, kind: TrajectoryKind): string | undefined {
  const data = object(event.data) ?? {}
  if (kind === 'tool-call' || kind === 'subagent') {
    if (event.type === 'tool/call') {
      const callId = string(data['callId'])
      if (callId === eventId || (callId === undefined && idOf(event) === eventId)) {
        return rawToolText(data['arguments'] ?? data['input'] ?? {})
      }
      return undefined
    }
    if (event.type !== 'assistant/message') return undefined
    for (const { item, index } of toolCallBlocks(event)) {
      const candidateId = string(item['id']) ?? idOf(event, `call-${index}`)
      if (candidateId === eventId) return rawToolText(item['arguments'] ?? item['input'] ?? {})
    }
    return undefined
  }
  if (kind !== 'tool-result' && kind !== 'error') return undefined
  if (event.type !== 'tool/result' && !/tool.*result/iu.test(event.type)) return undefined
  if (idOf(event) !== eventId) return undefined
  return rawToolText(toolResultParts(data).content)
}

function exactPtcText(event: SessionEvent, eventId: string): string | undefined {
  if (event.type !== 'tool/ptc-dispatch') return undefined
  if (idOf(event) !== eventId) return undefined
  const data = object(event.data) ?? {}
  // `meta` stays presentation metadata; the readable body is the sub-call's
  // own `content` outcome.
  return rawToolText(data['content'] ?? {})
}

export function trajectoryDetail(
  items: readonly TrajectoryChoice[],
  events: readonly SessionEvent[],
  ref: { seq: number; eventId: string; kind: TrajectoryKind; digest: string },
): TrajectoryDetail {
  const catalog = new Map(items.map(item => [`${item.seq}:${item.eventId}`, item]))
  const item = catalog.get(`${ref.seq}:${ref.eventId}`)
  if (item === undefined || item.kind !== ref.kind || item.digest !== ref.digest) throw new Error(`trajectory item ${ref.eventId} is stale or unavailable; refresh the trajectory`)
  if (!item.fullContentAvailable) throw new Error(`trajectory item ${ref.eventId} has no separately readable full content`)
  const event = events.find(candidate => candidate.seq === item.seq)
  const text = event === undefined
    ? undefined
    : item.kind === 'ptc'
      ? exactPtcText(event, item.eventId)
      : exactToolText(event, item.eventId, item.kind)
  if (text === undefined) throw new Error(`trajectory item ${ref.eventId} raw content is unavailable; refresh the trajectory`)
  return {
    seq: item.seq,
    eventId: item.eventId,
    kind: item.kind,
    digest: item.digest,
    text,
    chars: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
    redacted: false,
  }
}

export function selectTrajectorySnapshots(
  items: readonly TrajectoryChoice[],
  events: readonly SessionEvent[],
  refs: readonly { seq: number; eventId: string; kind: TrajectoryKind; digest: string }[],
  budget: TrajectorySelectionBudget = {
    maxItems: DEFAULT_TRAJECTORY_MAX_ITEMS,
    maxTokens: DEFAULT_TRAJECTORY_FALLBACK_MAX_TOKENS,
    maxChars: DEFAULT_TRAJECTORY_FALLBACK_MAX_TOKENS * 4,
    description: 'the fallback 48k trajectory budget',
  },
): TrajectorySnapshot[] {
  if (refs.length > budget.maxItems) throw new Error(`selected trajectory exceeds the ${budget.maxItems}-item limit`)
  const catalog = new Map(items.map(item => [`${item.seq}:${item.eventId}`, item]))
  const snapshots = refs.map(ref => {
    const item = catalog.get(`${ref.seq}:${ref.eventId}`)
    if (item === undefined || !item.selectable || item.kind !== ref.kind || item.digest !== ref.digest) throw new Error(`trajectory item ${ref.eventId} is stale or unavailable; refresh the trajectory`)
    const text = item.fullContentAvailable ? trajectoryDetail(items, events, ref).text : item.preview
    return { seq: item.seq, eventId: item.eventId, ...(item.turn === undefined ? {} : { turn: item.turn }), ...(item.step === undefined ? {} : { step: item.step }), kind: item.kind, text, redacted: item.redacted, digest: item.digest }
  })
  const chars = snapshots.reduce((sum, item) => sum + item.text.length, 0)
  const estimatedTokens = Math.ceil(chars / 4)
  if (chars > budget.maxChars || estimatedTokens > budget.maxTokens) {
    throw new Error(`selected trajectory uses approximately ${estimatedTokens.toLocaleString('en-US')} tokens; ${budget.description} allows ${budget.maxTokens.toLocaleString('en-US')} tokens`)
  }
  return snapshots
}
