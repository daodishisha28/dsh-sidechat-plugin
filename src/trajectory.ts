import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TrajectoryChoice, TrajectoryDetail, TrajectoryKind, TrajectoryOverview, TrajectorySnapshot } from './types.ts'

export const TRAJECTORY_PROJECTION_VERSION = 'trajectory-v2'
export const TRAJECTORY_MAX_ITEMS = 64
export const TRAJECTORY_MAX_CHARS = 32_000
export const TRAJECTORY_MAX_TOKENS = 8_000
export const TRAJECTORY_PREVIEW_MAX_CHARS = 4_000

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
  const raw = string(data['status']) ?? string(object(data['reason'])?.['kind']) ?? string(object(data['error'])?.['kind'])
  if (raw === undefined) return undefined
  if (/error|fail|denied/iu.test(raw)) return 'error'
  if (/cancel|abort/iu.test(raw)) return 'cancelled'
  if (/run|start|pending/iu.test(raw)) return 'running'
  return 'success'
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

function sideChatContextLabel(text: string): string | undefined {
  const marker = /^\[SideChat\s+(fold-withdrawal|fold|cite)\b/iu.exec(text)?.[1]?.toLowerCase()
  if (marker === 'fold-withdrawal') return '↩ SideChat Fold 撤回'
  if (marker === 'fold') return '↩ SideChat Fold'
  if (marker === 'cite') return '↩ SideChat Cite'
  return /Fold 回流/iu.test(text) ? '↩ SideChat Fold' : undefined
}

export function projectTrajectory(sourceSessionId: string, events: readonly SessionEvent[]): TrajectoryChoice[] {
  const output: TrajectoryChoice[] = []
  let currentTurn: number | undefined
  let currentStep: number | undefined
  const turnEvents = new Map<number, TrajectoryChoice[]>()
  const push = (choice: TrajectoryChoice) => {
    output.push(choice)
    if (choice.turn !== undefined && choice.kind !== 'turn') {
      const items = turnEvents.get(choice.turn) ?? []
      items.push(choice)
      turnEvents.set(choice.turn, items)
    }
  }
  for (const event of events) {
    const data = object(event.data) ?? {}
    const eventTurn = number(data['turn'])
    const eventStep = number(data['step'])
    if (event.type === 'turn/start') { currentTurn = eventTurn === undefined ? currentTurn : eventTurn; currentStep = undefined; continue }
    if (event.type === 'turn/end') { currentTurn = undefined; currentStep = undefined; continue }
    if (event.type === 'step/start') { currentStep = eventStep === undefined ? currentStep : eventStep }
    if (event.type === 'step/end') { currentStep = undefined; continue }
    const turn = eventTurn ?? currentTurn
    const step = eventStep ?? currentStep
    if (event.type === 'user/message') {
      const source = object(data['source'])
      const raw = contentText(data['content'])
      const contextLabel = source?.['kind'] === 'plugin' ? sideChatContextLabel(raw) : undefined
      if (contextLabel !== undefined) {
        const clean = sanitizeText(raw)
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'fold-note', label: contextLabel, preview: clean.text, redacted: clean.redacted, selectable: false, status: 'success' }))
      } else if (source?.['kind'] === 'user' && raw !== '') {
        const clean = sanitizeText(raw)
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'user', label: raw.replace(/\s+/gu, ' ').slice(0, 72), preview: clean.text, redacted: clean.redacted, selectable: true, status: 'success' }))
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const message = object(data['message']) ?? data
      const source = object(message['source'])
      const model = string(source?.['model']) ?? string(data['model'])
      if (model !== undefined) {
        const route = `${string(source?.['provider']) ?? 'model'}/${model}`
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event, 'request'), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'request', label: route, preview: `provider/model: ${route}`, redacted: false, selectable: true, model: route, status: 'success' }))
      }
      const blocks = Array.isArray(message['content']) ? message['content'] : []
      blocks.forEach((block, index) => {
        const item = object(block)
        if (item?.['type'] !== 'tool-call') return
        const name = string(item['name']) ?? 'tool'
        const fullText = rawToolText(item['arguments'] ?? item['input'] ?? {})
        const { preview, truncated } = boundedPreview(fullText)
        const subagent = /^(?:task|agent|subagent)$/iu.test(name)
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: string(item['id']) ?? idOf(event, `call-${index}`), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: subagent ? 'subagent' : 'tool-call', label: subagent ? `Task: ${name}` : name, preview, redacted: false, selectable: true, toolName: name, parallelGroup: `step-${turn ?? 0}-${step ?? event.seq}`, status: 'running', ...(subagent ? { childTurns: number(item['turns']) ?? 0 } : {}) }, fullText, { truncated, fullContentAvailable: true }))
      })
      const raw = contentText(message['content'])
      if (raw !== '') {
        const clean = sanitizeText(raw)
        push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event, 'final'), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'assistant', label: 'assistant ✓', preview: clean.text, redacted: clean.redacted, selectable: true, status: 'success' }))
      }
      continue
    }
    if (event.type === 'tool/result' || /tool.*result/iu.test(event.type)) {
      const fullText = rawToolText(data['content'] ?? data['result'] ?? data)
      const { preview, truncated } = boundedPreview(fullText)
      const toolName = string(data['name']) ?? string(data['toolName']) ?? 'tool result'
      const status = statusOf(data) ?? (data['error'] === undefined ? 'success' : 'error')
      push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: status === 'error' ? 'error' : 'tool-result', label: toolName, preview, redacted: false, selectable: true, toolName, status }, fullText, { truncated, fullContentAvailable: true }))
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
      push(makeChoice({ sourceSessionId, seq: event.seq, eventId: idOf(event), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }), kind: 'error', label: string(data['message']) ?? 'Error', preview: JSON.stringify(projected.value, null, 2), redacted: projected.redacted, selectable: true, status: 'error' }))
    }
  }
  const turns = [...turnEvents.entries()].map(([turn, items]) => {
    const first = items[0]!
    const last = items.at(-1)!
    const preview = items.map(item => `[${item.kind}] ${item.label}`).join('\n')
    return makeChoice({ sourceSessionId, seq: first.seq, eventId: `turn:${turn}`, turn, kind: 'turn' as const, label: `Turn ${turn}`, preview, redacted: items.some(item => item.redacted), selectable: true, status: items.some(item => item.status === 'error') ? 'error' as const : 'success' as const, durationMs: Math.max(0, ((events.find(event => event.seq === last.seq)?.time ?? 0) - (events.find(event => event.seq === first.seq)?.time ?? 0))) })
  })
  return [...turns, ...output].sort((left, right) => left.seq - right.seq || (left.kind === 'turn' ? -1 : 1))
}

export function trajectoryOverview(items: readonly TrajectoryChoice[], events: readonly SessionEvent[], capturedThroughSeq: number): TrajectoryOverview {
  const times = events.flatMap(event => typeof event.time === 'number' ? [event.time] : [])
  return {
    turns: items.filter(item => item.kind === 'turn').length,
    calls: items.filter(item => item.kind === 'tool-call' || item.kind === 'subagent').length,
    subagents: items.filter(item => item.kind === 'subagent').length,
    failures: items.filter(item => item.status === 'error').length,
    durationMs: times.length < 2 ? 0 : Math.max(...times) - Math.min(...times),
    capturedThroughSeq,
  }
}

function exactToolText(event: SessionEvent, eventId: string, kind: TrajectoryKind): string | undefined {
  const data = object(event.data) ?? {}
  if (kind === 'tool-call' || kind === 'subagent') {
    if (event.type !== 'assistant/message') return undefined
    const message = object(data['message']) ?? data
    const blocks = Array.isArray(message['content']) ? message['content'] : []
    for (let index = 0; index < blocks.length; index += 1) {
      const item = object(blocks[index])
      if (item?.['type'] !== 'tool-call') continue
      const candidateId = string(item['id']) ?? idOf(event, `call-${index}`)
      if (candidateId === eventId) return rawToolText(item['arguments'] ?? item['input'] ?? {})
    }
    return undefined
  }
  if (kind !== 'tool-result' && kind !== 'error') return undefined
  if (event.type !== 'tool/result' && !/tool.*result/iu.test(event.type)) return undefined
  if (idOf(event) !== eventId) return undefined
  return rawToolText(data['content'] ?? data['result'] ?? data)
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
  const text = event === undefined ? undefined : exactToolText(event, item.eventId, item.kind)
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
): TrajectorySnapshot[] {
  const catalog = new Map(items.map(item => [`${item.seq}:${item.eventId}`, item]))
  const snapshots = refs.map(ref => {
    const item = catalog.get(`${ref.seq}:${ref.eventId}`)
    if (item === undefined || !item.selectable || item.kind !== ref.kind || item.digest !== ref.digest) throw new Error(`trajectory item ${ref.eventId} is stale or unavailable; refresh the trajectory`)
    const text = item.fullContentAvailable ? trajectoryDetail(items, events, ref).text : item.preview
    return { seq: item.seq, eventId: item.eventId, ...(item.turn === undefined ? {} : { turn: item.turn }), ...(item.step === undefined ? {} : { step: item.step }), kind: item.kind, text, redacted: item.redacted, digest: item.digest }
  })
  const chars = snapshots.reduce((sum, item) => sum + item.text.length, 0)
  if (snapshots.length > TRAJECTORY_MAX_ITEMS || chars > TRAJECTORY_MAX_CHARS || Math.ceil(chars / 4) > TRAJECTORY_MAX_TOKENS) throw new Error('selected trajectory exceeds the 8k token budget')
  return snapshots
}
