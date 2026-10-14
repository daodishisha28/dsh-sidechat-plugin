import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { deriveSessionUsage, subtractUsage } from '../src/usage.ts'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

function turn(offset: number, turnNumber: number, input: number, output: number): SessionEvent[] {
  const usage = { inputTokens: input, outputTokens: output, totalTokens: input + output, cacheReadTokens: 0, cacheWriteTokens: 0 }
  return [
    event(offset, 'turn/start', { turn: turnNumber }),
    event(offset + 1, 'step/start', { turn: turnNumber, step: 1 }),
    event(offset + 2, 'assistant/message', {
      turn: turnNumber,
      step: 1,
      message: { id: `a${turnNumber}`, role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'p', model: 'm' } },
      usage,
    }),
    event(offset + 3, 'step/end', { turn: turnNumber, step: 1 }),
    event(offset + 4, 'turn/end', { turn: turnNumber, reason: { kind: 'completed' } }),
  ]
}

describe('SideChat usage projection', () => {
  it('aggregates complete durable turns and exposes the latest turn', () => {
    expect(deriveSessionUsage([...turn(1, 1, 10, 2), ...turn(10, 2, 20, 3)])).toMatchObject({
      complete: true,
      completedTurns: 2,
      totals: { uncachedInputTokens: 30, outputTokens: 5, totalTokens: 35 },
      latestTurn: { uncachedInputTokens: 20, outputTokens: 3, totalTokens: 23 },
    })
  })

  it('marks an unfinished or invalid turn incomplete instead of reporting zero', () => {
    expect(deriveSessionUsage([event(1, 'turn/start', { turn: 1 })])).toEqual({
      complete: false, completedTurns: 0, incompleteTurns: 1,
    })
  })

  it('never counts a compaction replacement copy as a second usage sample', () => {
    const original = turn(1, 1, 10, 2)
    // A compaction replacement re-appends the settled assistant message as a
    // surface copy of prior content; it is not another billed attempt. Real
    // alpha.2 shape: `{ op: 'replace', startSeq, endSeq }` (upstream
    // packages/core/session/src/types.ts SurfaceOp) referencing the earlier
    // assistant message at seq 3.
    const replacement: SessionEvent = {
      seq: 20, time: 20, type: 'assistant/message',
      surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 },
      data: {
        turn: 1, step: 1,
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'p', model: 'm' } },
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      },
    } as SessionEvent
    const withReplacement = deriveSessionUsage([...original, replacement])
    expect(withReplacement).toMatchObject({
      complete: true,
      completedTurns: 1,
      totals: { uncachedInputTokens: 10, outputTokens: 2, totalTokens: 12 },
    })
  })

  it('reports unknown instead of inventing numbers when usage evidence is missing', () => {
    const noUsage: SessionEvent[] = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'assistant/message', {
        turn: 1, step: 1,
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'no accounting' }], source: { kind: 'model', provider: 'p', model: 'm' } },
      }),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(deriveSessionUsage(noUsage)).toEqual({
      complete: false, completedTurns: 0, incompleteTurns: 1,
    })
  })

  it('subtracts only complete exact baselines', () => {
    const baseline = deriveSessionUsage(turn(1, 1, 10, 2))
    const current = deriveSessionUsage([...turn(1, 1, 10, 2), ...turn(10, 2, 20, 3)])
    expect(subtractUsage(current, baseline)).toMatchObject({
      available: true,
      complete: true,
      totals: { uncachedInputTokens: 20, outputTokens: 3, totalTokens: 23 },
    })
    expect(subtractUsage({ ...current, complete: false }, baseline)).toEqual({ available: false, complete: false })
  })
})
