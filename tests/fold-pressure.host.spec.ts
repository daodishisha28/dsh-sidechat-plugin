import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SideChatService } from '../src/service.ts'
import type { FoldRecord, SideChatRecord } from '../src/types.ts'

const FOLD_ID = '11111111-1111-4111-8111-111111111111'

class MemoryTable {
  readonly rows = new Map<string, SideChatRecord>()
  get(key: string): SideChatRecord | undefined { return this.rows.get(key) }
  entries(): IterableIterator<[string, SideChatRecord]> { return this.rows.entries() }
  async put(key: string, value: SideChatRecord): Promise<void> { this.rows.set(key, value) }
  async update(key: string, update: (current: SideChatRecord) => SideChatRecord): Promise<SideChatRecord> {
    const current = this.rows.get(key)
    if (current === undefined) throw new Error(`missing ${key}`)
    const next = update(current)
    this.rows.set(key, next)
    return next
  }
}

function header(id: string, createdAt: number): SessionHeader {
  return { id, createdAt, cwd: 'C:\\work' } as unknown as SessionHeader
}

function foldContent(): string {
  return [
    '# SideChat 澄清结论：压力保护',
    '- 背景：b',
    '- 结论：c',
    '- 依据：d',
    '- 对父会话的影响：e',
    '- 未决：f',
  ].join('\n')
}

function record(): SideChatRecord {
  const fold: FoldRecord = {
    foldId: FOLD_ID,
    revision: 1,
    state: 'prepared',
    generatedContent: foldContent(),
    baselineSeq: 0,
    previewThroughSeq: 0,
    estimatedTokens: 20,
    structureValid: true,
    createdAt: 3,
    updatedAt: 3,
  }
  return {
    schema: 1,
    childSessionId: 'child',
    parentSessionId: 'parent',
    parent: { createdAt: 1, cwd: 'C:\\work' },
    child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q',
    title: 't',
    status: 'open',
    seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 2, messages: [] },
    modelStrategy: { kind: 'default' },
    createdAt: 2,
    updatedAt: 3,
    revision: 1,
    folds: [fold],
    cites: [],
  }
}

function harness(initialTokens: number, compactedTokens: number | null) {
  const table = new MemoryTable()
  table.rows.set('child', record())
  const parentEvents: SessionEvent[] = []
  const childEvents: SessionEvent[] = []
  let pressureTokens = initialTokens
  let maintenanceActive = false
  const order: string[] = []
  type MaintenanceAgent = {
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
  }
  const agentContext: {
    tools: { schemas: () => never[] }
    compaction?: { compactNow(agent: MaintenanceAgent, signal: AbortSignal): Promise<{ compactionId: string } | null> }
  } = {
    tools: { schemas: () => [] },
  }
  const parentAgent = {
    id: 'parent',
    status: 'idle' as const,
    session: {
      id: 'parent',
      header: header('parent', 1),
      events: parentEvents,
      requestContext: () => ({ provider: 'mock', model: 'm', contextWindow: 1_000 }),
      append: (type: string, data: unknown) => {
        parentEvents.push({ seq: parentEvents.length, time: parentEvents.length, type, data } as SessionEvent)
        order.push('append')
      },
    },
    ctx: agentContext,
    options: {},
    whenIdle: vi.fn(async () => undefined),
    runMaintenance: vi.fn(async <T>(task: (signal: AbortSignal) => Promise<T>) => {
      if (maintenanceActive) throw new Error('nested maintenance')
      maintenanceActive = true
      order.push('maintenance:start')
      try { return await task(new AbortController().signal) }
      finally { order.push('maintenance:end'); maintenanceActive = false }
    }),
  }
  const compactNow = vi.fn(async (agent: MaintenanceAgent, signal: AbortSignal) => {
    order.push('compact')
    return agent.runMaintenance(async () => {
      signal.throwIfAborted()
      if (compactedTokens === null) return null
      pressureTokens = compactedTokens
      return { compactionId: 'compact-1' }
    })
  })
  agentContext.compaction = { compactNow }
  const flush = vi.fn(async () => { order.push('flush'); return true })
  const ctx = new Context()
  ctx.provide('sessionController', {
    inspect: vi.fn(async (sessionId: string) => sessionId === 'parent'
      ? { meta: header('parent', 1), events: parentEvents }
      : { meta: header('child', 2), events: childEvents }),
    resolveAgent: vi.fn(async () => ({ agent: parentAgent })),
  })
  ctx.provide('sessions', { flush })
  ctx.provide('tokenMeter', {
    measure: vi.fn(() => ({ totalTokens: pressureTokens })),
    estimateMessage: vi.fn(() => 50),
  })
  const service = new SideChatService(ctx, { foldAppendThresholdRatio: 0.8 })
  Object.defineProperty(service, 'table', { value: table, writable: true })
  return { service, table, parentEvents, compactNow, order, agentContext }
}

describe('Fold context pressure delivery', () => {
  it('does not require a root compaction service during plugin activation', () => {
    expect(SideChatService.inject).toContain('tokenMeter')
    expect(SideChatService.inject).not.toContain('compaction')
  })

  it('appends the complete Fold directly while projected pressure stays below the threshold', async () => {
    const target = harness(700, 300)
    await expect(target.service.commitFold({ childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true }))
      .resolves.toMatchObject({ ok: true, value: { state: 'committed' } })
    expect(target.compactNow).not.toHaveBeenCalled()
    expect(target.parentEvents.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(target.order).toEqual(['maintenance:start', 'append', 'flush', 'maintenance:end'])
  })

  it('leaves maintenance, compacts old parent history, remeasures, then appends the complete Fold', async () => {
    const target = harness(780, 300)
    await expect(target.service.commitFold({ childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true }))
      .resolves.toMatchObject({ ok: true, value: { state: 'committed' } })
    expect(target.compactNow).toHaveBeenCalledOnce()
    expect(target.parentEvents.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(target.order).toEqual([
      'maintenance:start', 'maintenance:end',
      'compact', 'maintenance:start', 'maintenance:end',
      'maintenance:start', 'append', 'flush', 'maintenance:end',
    ])
  })

  it('does not append or truncate the Fold when compaction cannot lower pressure enough', async () => {
    const target = harness(780, 770)
    const result = await target.service.commitFold({ childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'fold-delivery-failed' } })
    expect(target.parentEvents.filter(event => event.type === 'user/message')).toHaveLength(0)
    expect(target.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'failed' })
  })

  it('fails explicitly without appending when the parent has no safe compactable range', async () => {
    const target = harness(780, null)
    const result = await target.service.commitFold({ childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'fold-delivery-failed', message: expect.stringMatching(/no safe useful history range/u) },
    })
    expect(target.parentEvents.filter(event => event.type === 'user/message')).toHaveLength(0)
    expect(target.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'failed' })
  })

  it('fails at Fold delivery rather than plugin startup when the parent preset has no compaction backend', async () => {
    const target = harness(780, 300)
    delete target.agentContext.compaction
    const result = await target.service.commitFold({ childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'fold-delivery-failed', message: expect.stringMatching(/preset has no compaction backend/u) },
    })
    expect(target.parentEvents.filter(event => event.type === 'user/message')).toHaveLength(0)
  })
})
