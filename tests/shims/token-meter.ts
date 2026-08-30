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

interface UsageSample {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function sample(value: unknown): UsageSample | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<UsageSample>
  if (!count(candidate.inputTokens) || !count(candidate.outputTokens)) return undefined
  if (candidate.totalTokens !== undefined && !count(candidate.totalTokens)) return undefined
  if (candidate.cacheReadTokens !== undefined && !count(candidate.cacheReadTokens)) return undefined
  if (candidate.cacheWriteTokens !== undefined && !count(candidate.cacheWriteTokens)) return undefined
  if (candidate.reasoningTokens !== undefined && !count(candidate.reasoningTokens)) return undefined
  return candidate as UsageSample
}

/**
 * Browser-safe test double for DSH token-meter's fail-closed complete-turn
 * contract. Production bundles keep token-meter external and use DSH's real
 * implementation; this local copy exists only to keep repository tests
 * independent from a sibling DSH checkout.
 */
export function deriveTurnTokenUsage(events: readonly SessionEvent[]): TurnTokenUsage | undefined {
  const start = events.find(event => event.type === 'turn/start')
  const end = events.find(event => event.type === 'turn/end')
  if (start === undefined || end === undefined || start.data.turn !== end.data.turn) return undefined

  const messages = events.filter(event => event.type === 'assistant/message')
  if (messages.length === 0) return undefined
  const attempts = messages.map(event => {
    const usage = sample(event.data.usage)
    const source = event.data.message?.source
    const route = typeof source?.provider === 'string' && typeof source?.model === 'string'
      ? { provider: source.provider, model: source.model }
      : undefined
    return { usage, route }
  })
  if (attempts.some(attempt => attempt.usage === undefined)) return undefined

  let uncachedInputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let reasoningTokens = 0
  let completeCacheRead = true
  let completeCacheWrite = true
  let completeReasoning = true
  let completeRoutes = true
  const routes = new Map<string, TurnTokenUsageRoute>()

  for (const attempt of attempts) {
    const usage = attempt.usage!
    const exactTotal = usage.totalTokens
      ?? (usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined
        ? usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
        : undefined)
    if (exactTotal === undefined || !Number.isSafeInteger(exactTotal)) return undefined
    uncachedInputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    totalTokens += exactTotal
    if (usage.cacheReadTokens === undefined) completeCacheRead = false
    else cacheReadTokens += usage.cacheReadTokens
    if (usage.cacheWriteTokens === undefined) completeCacheWrite = false
    else cacheWriteTokens += usage.cacheWriteTokens
    if (usage.reasoningTokens === undefined) completeReasoning = false
    else reasoningTokens += usage.reasoningTokens
    if (attempt.route === undefined) completeRoutes = false
    else routes.set(`${attempt.route.provider}\0${attempt.route.model}`, attempt.route)
  }

  if (![uncachedInputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens]
    .every(Number.isSafeInteger)) return undefined
  return {
    uncachedInputTokens,
    outputTokens,
    totalTokens,
    ...(completeCacheRead ? { cacheReadTokens } : {}),
    ...(completeCacheWrite ? { cacheWriteTokens } : {}),
    ...(completeReasoning ? { reasoningTokens } : {}),
    ...(completeRoutes ? { routes: [...routes.values()] } : {}),
  }
}
