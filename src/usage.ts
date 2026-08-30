import { deriveTurnTokenUsage, type TurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionUsage, UsageTotals } from './types.ts'

function safeSum(values: readonly number[]): number | undefined {
  let sum = 0
  for (const value of values) {
    sum += value
    if (!Number.isSafeInteger(sum)) return undefined
  }
  return sum
}

function aggregate(turns: readonly TurnTokenUsage[]): UsageTotals | undefined {
  if (turns.length === 0) {
    return { uncachedInputTokens: 0, outputTokens: 0, totalTokens: 0 }
  }
  const uncachedInputTokens = safeSum(turns.map(turn => turn.uncachedInputTokens))
  const outputTokens = safeSum(turns.map(turn => turn.outputTokens))
  const totalTokens = safeSum(turns.map(turn => turn.totalTokens))
  if (uncachedInputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return undefined
  const optionalSum = (key: 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens') => {
    const values = turns.map(turn => turn[key])
    return values.every((value): value is number => value !== undefined) ? safeSum(values) : undefined
  }
  const routes = turns.flatMap(turn => turn.routes ?? [])
  const uniqueRoutes = new Map(routes.map(route => [`${route.provider}\0${route.model}`, route]))
  const cacheReadTokens = optionalSum('cacheReadTokens')
  const cacheWriteTokens = optionalSum('cacheWriteTokens')
  const reasoningTokens = optionalSum('reasoningTokens')
  return {
    uncachedInputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(routes.length === 0 ? {} : { routes: [...uniqueRoutes.values()] }),
  }
}

/** Derive exact provider usage only from complete, internally valid durable turns. */
export function deriveSessionUsage(events: readonly SessionEvent[]): SessionUsage {
  const turns: TurnTokenUsage[] = []
  let current: SessionEvent[] | undefined
  let incompleteTurns = 0
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (current !== undefined) incompleteTurns += 1
      current = [event]
      continue
    }
    if (current === undefined) continue
    current.push(event)
    if (event.type !== 'turn/end') continue
    const usage = deriveTurnTokenUsage(current)
    if (usage === undefined) incompleteTurns += 1
    else turns.push(usage)
    current = undefined
  }
  if (current !== undefined) incompleteTurns += 1
  const totals = incompleteTurns === 0 ? aggregate(turns) : undefined
  const latest = turns.at(-1)
  return {
    complete: incompleteTurns === 0,
    completedTurns: turns.length,
    incompleteTurns,
    ...(totals === undefined ? {} : { totals }),
    ...(latest === undefined ? {} : { latestTurn: aggregate([latest])! }),
  }
}

export function subtractUsage(current: SessionUsage, baseline: SessionUsage): {
  readonly available: boolean
  readonly complete: boolean
  readonly totals?: UsageTotals
} {
  if (!current.complete || !baseline.complete || current.totals === undefined || baseline.totals === undefined) {
    return { available: false, complete: false }
  }
  const subtract = (key: keyof Pick<UsageTotals, 'uncachedInputTokens' | 'outputTokens' | 'totalTokens'>) => {
    const value = current.totals![key] - baseline.totals![key]
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  }
  const uncachedInputTokens = subtract('uncachedInputTokens')
  const outputTokens = subtract('outputTokens')
  const totalTokens = subtract('totalTokens')
  if (uncachedInputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return { available: false, complete: false }
  }
  const optional = (key: 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens') => {
    const left = current.totals?.[key]
    const right = baseline.totals?.[key]
    if (left === undefined || right === undefined || left < right) return undefined
    return left - right
  }
  const cacheReadTokens = optional('cacheReadTokens')
  const cacheWriteTokens = optional('cacheWriteTokens')
  const reasoningTokens = optional('reasoningTokens')
  return {
    available: true,
    complete: true,
    totals: {
      uncachedInputTokens,
      outputTokens,
      totalTokens,
      ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
      ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    },
  }
}
