import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { durableAttemptEvent } from '../src/usage.ts'

/**
 * COMPOSITION MECHANISM (real `deriveSessionUsage` against the real helper):
 * Vitest hoists `vi.mock` above every import, and BOTH the mock specifier and
 * `src/usage.ts`'s internal `@deepseek-ai/dsh-token-meter/client` import
 * resolve through the same vitest.config.ts alias to the shim module path, so
 * this mock intercepts the plugin module's import. The factory returns the
 * REAL alpha.2 runtime loaded from the installed fixture via a computed file
 * URL (dynamic import inside the factory is allowed). The plugin's
 * `src/usage.ts` is then imported dynamically in the tests below, so its
 * `deriveSessionUsage` runs with the real upstream helper — no alias or
 * vitest.config.ts change is involved. When the fixture is absent the
 * composition tests skip; the shim-independent tests above keep the file
 * honest (note the pre-existing top-level helper import already requires the
 * fixture for this file).
 */
vi.mock('@deepseek-ai/dsh-token-meter/client', async () =>
  await import(new URL(
    '../tests/contracts/alpha2-fixture/node_modules/@deepseek-ai/dsh-token-meter/lib/types/client.js',
    import.meta.url,
  ).href))

interface TurnTokenUsage {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
  readonly routes?: readonly { readonly provider: string; readonly model: string }[]
}

/**
 * The REAL alpha.2 helper (published @deepseek-ai/dsh-token-meter/client
 * runtime, loaded from the installed fixture at the pinned version). This is
 * the compat evidence the repository-local Vitest shim cannot provide: the
 * shim only models aggregation, while these tests run upstream's own
 * fail-closed attempt lifecycle fold. Loaded through a computed file URL so
 * the Vitest alias for `@deepseek-ai/dsh-llm` does not rewrite the helper's
 * internal `@deepseek-ai/dsh-llm/assistant-stream` import.
 */
const helperModuleUrl = new URL(
  '../tests/contracts/alpha2-fixture/node_modules/@deepseek-ai/dsh-token-meter/lib/types/client.js',
  import.meta.url,
).href
const { deriveTurnTokenUsage } = (await import(helperModuleUrl)) as {
  readonly deriveTurnTokenUsage: (events: readonly SessionEvent[]) => TurnTokenUsage | undefined
}

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent
}

const MODEL_SOURCE = { kind: 'model', provider: 'test', model: 'test-model' } as const

function attemptMessage(turn: number, step: number, id: string, usage: Record<string, number>): SessionEvent {
  return event(0, 'assistant/message', {
    turn, step,
    message: { id, role: 'assistant', content: [{ type: 'text', text: 'answer' }], source: MODEL_SOURCE },
    usage,
    stream: [{ type: 'chunk', time: 1, chunk: { type: 'usage', usage } }],
  })
}

function completeTurn(offset: number, turn: number, usage: Record<string, number>): SessionEvent[] {
  return [
    event(offset, 'turn/start', { turn }),
    event(offset + 1, 'step/start', { turn, step: 1 }),
    { ...attemptMessage(turn, 1, `a${turn}`, usage), seq: offset + 2, time: offset + 2 } as SessionEvent,
    event(offset + 3, 'step/end', { turn, step: 1 }),
    event(offset + 4, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}

describe('real alpha.2 deriveTurnTokenUsage (installed fixture)', () => {
  it('is the upstream runtime helper, and aggregates one exact attempt', () => {
    const usage = deriveTurnTokenUsage(completeTurn(1, 1, {
      inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0,
    }))
    expect(usage).toMatchObject({ uncachedInputTokens: 10, outputTokens: 2, totalTokens: 12, routes: [{ provider: 'test', model: 'test-model' }] })
  })

  it('folds usage from a failed attempt plus its retry as two exact attempts', () => {
    const streamUsage = { inputTokens: 10, outputTokens: 0, totalTokens: 10 }
    const retryUsage = { inputTokens: 14, outputTokens: 3, totalTokens: 17 }
    const events: SessionEvent[] = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      // The failed attempt committed no surface message; its stream carries
      // the exact usage the provider already billed.
      event(3, 'assistant/attempt', {
        turn: 1, step: 1,
        stream: [{ type: 'chunk', time: 3, chunk: { type: 'usage', usage: streamUsage } }],
      }),
      event(4, 'llm/retry', { turn: 1, step: 1 }),
      event(5, 'llm/retry-started', { turn: 1, step: 1 }),
      { ...attemptMessage(1, 1, 'attempt-2', retryUsage), seq: 6, time: 6 } as SessionEvent,
      event(7, 'step/end', { turn: 1, step: 1 }),
      event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(deriveTurnTokenUsage(events)).toMatchObject({
      uncachedInputTokens: 24, outputTokens: 3, totalTokens: 27,
    })
    // The failed attempt carries no provider/model attribution, so per the
    // helper's contract the route list is withheld rather than guessed.
    expect(deriveTurnTokenUsage(events)?.routes).toBeUndefined()
  })

  it('returns unknown when attempt usage evidence is missing, instead of estimating', () => {
    const events: SessionEvent[] = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      { ...attemptMessage(1, 1, 'attempt-1', { inputTokens: 10, outputTokens: 2, totalTokens: 12 }), seq: 3, time: 3 } as SessionEvent,
      event(4, 'llm/retry', { turn: 1, step: 1 }),
      event(5, 'llm/retry-started', { turn: 1, step: 1 }),
      // The retried attempt committed no usage evidence at all.
      event(6, 'assistant/message', {
        turn: 1, step: 1,
        message: { id: 'attempt-2', role: 'assistant', content: [{ type: 'text', text: 'answer' }], source: MODEL_SOURCE },
      }),
      event(7, 'step/end', { turn: 1, step: 1 }),
      event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(deriveTurnTokenUsage(events)).toBeUndefined()
  })

  it('does not count a compaction replacement copy as a second attempt', () => {
    const original = completeTurn(1, 1, { inputTokens: 10, outputTokens: 2, totalTokens: 12 })
    // Same shape as the durable attempt but re-appended as a surface
    // replacement inside the same turn. `deriveSessionUsage` applies the same
    // durable-event filter before the helper; composed here to prove the
    // exact total survives a replacement without a second sample.
    const replacement = {
      ...attemptMessage(1, 1, 'a1', { inputTokens: 10, outputTokens: 2, totalTokens: 12 }),
      seq: 10, time: 10,
      // Real alpha.2 surfaceOp replace shape (upstream
      // packages/core/session/src/types.ts SurfaceOp): the copy replaces the
      // earlier assistant message at seq 3.
      surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 },
    } as SessionEvent
    const events = [...original, replacement].filter(durableAttemptEvent)
    expect(events).toHaveLength(original.length)
    expect(deriveTurnTokenUsage(events)).toMatchObject({
      uncachedInputTokens: 10, outputTokens: 2, totalTokens: 12,
    })
    // And unfiltered, the upstream helper is fail-closed about the duplicate
    // lifecycle node — it never produces a double count.
    expect(deriveTurnTokenUsage([...original, replacement])).toBeUndefined()
  })
})

const fixtureExists = existsSync(new URL(
  '../tests/contracts/alpha2-fixture/node_modules/@deepseek-ai/dsh-token-meter/lib/types/client.js',
  import.meta.url,
))

describe('real deriveSessionUsage composition (plugin durable filter + real helper)', () => {
  const itWithFixture = it.skipIf(!fixtureExists)

  itWithFixture('runs the plugin deriveSessionUsage against the real fixture helper', async () => {
    // Imported after the hoisted vi.mock registration, so the plugin module's
    // internal token-meter import resolves to the real fixture helper.
    const usageModule = await import('../src/usage.ts')
    const mockedMeter = await import('@deepseek-ai/dsh-token-meter/client') as { readonly deriveTurnTokenUsage: unknown }
    // Proof of interception: the module the plugin actually received IS the
    // real alpha.2 runtime loaded above, not the local shim.
    expect(mockedMeter.deriveTurnTokenUsage).toBe(deriveTurnTokenUsage)
    expect(typeof usageModule.deriveSessionUsage).toBe('function')
  })

  itWithFixture('aggregates one exact attempt through the real composition path', async () => {
    const { deriveSessionUsage } = await import('../src/usage.ts')
    expect(deriveSessionUsage(completeTurn(1, 1, {
      inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0,
    }))).toMatchObject({
      complete: true,
      completedTurns: 1,
      incompleteTurns: 0,
      totals: { uncachedInputTokens: 10, outputTokens: 2, totalTokens: 12 },
      latestTurn: { uncachedInputTokens: 10, outputTokens: 2, totalTokens: 12 },
    })
  })

  itWithFixture('folds a failed attempt plus its retry exactly through the real composition path', async () => {
    const { deriveSessionUsage } = await import('../src/usage.ts')
    const streamUsage = { inputTokens: 10, outputTokens: 0, totalTokens: 10 }
    const retryUsage = { inputTokens: 14, outputTokens: 3, totalTokens: 17 }
    const events: SessionEvent[] = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'assistant/attempt', {
        turn: 1, step: 1,
        stream: [{ type: 'chunk', time: 3, chunk: { type: 'usage', usage: streamUsage } }],
      }),
      event(4, 'llm/retry', { turn: 1, step: 1 }),
      event(5, 'llm/retry-started', { turn: 1, step: 1 }),
      { ...attemptMessage(1, 1, 'attempt-2', retryUsage), seq: 6, time: 6 } as SessionEvent,
      event(7, 'step/end', { turn: 1, step: 1 }),
      event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    // 24/27 is the real helper's attempt-state-machine result (assistant/
    // attempt → llm/retry → llm/retry-started → assistant/message); the local
    // shim cannot fold the attempt and would report 14/17.
    expect(deriveSessionUsage(events)).toMatchObject({
      complete: true,
      completedTurns: 1,
      totals: { uncachedInputTokens: 24, outputTokens: 3, totalTokens: 27 },
    })
  })

  itWithFixture('reports unknown instead of inventing numbers when usage evidence is missing', async () => {
    const { deriveSessionUsage } = await import('../src/usage.ts')
    const events: SessionEvent[] = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      // A real durable assistant message always carries a stream array (the
      // helper's chunk scan reads it unconditionally); this one has no usage
      // evidence anywhere.
      event(3, 'assistant/message', {
        turn: 1, step: 1,
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'no accounting' }], source: MODEL_SOURCE },
        stream: [],
      }),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(deriveSessionUsage(events)).toEqual({
      complete: false, completedTurns: 0, incompleteTurns: 1,
    })
  })

  itWithFixture('never double-counts a real-shape compaction replacement copy', async () => {
    const { deriveSessionUsage } = await import('../src/usage.ts')
    const original = completeTurn(1, 1, { inputTokens: 10, outputTokens: 2, totalTokens: 12 })
    const replacement = {
      ...attemptMessage(1, 1, 'a1', { inputTokens: 10, outputTokens: 2, totalTokens: 12 }),
      seq: 10, time: 10,
      // Real alpha.2 surfaceOp replace shape; `durableAttemptEvent` filters it
      // before the real helper ever sees it.
      surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 },
    } as SessionEvent
    expect(deriveSessionUsage([...original, replacement])).toMatchObject({
      complete: true,
      completedTurns: 1,
      totals: { uncachedInputTokens: 10, outputTokens: 2, totalTokens: 12 },
    })
  })
})
