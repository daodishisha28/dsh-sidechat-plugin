import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SideChatService } from '../src/service.ts'
import type { FoldRecord, SideChatRecord } from '../src/types.ts'

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

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

function header(id: string, createdAt: number): SessionHeader {
  return { id, createdAt, cwd: 'C:\\work', isSeeded: false, version: 4 } as unknown as SessionHeader
}

const RECORD_PROJECTION_VERSION = 'test-projection-v1'

const REV_1 = '11111111-1111-4111-8111-111111111111'
const REV_2 = '22222222-2222-4222-8222-222222222222'

function fold(id: string, revision: number, state: FoldRecord['state'], extra: Partial<FoldRecord> = {}): FoldRecord {
  return {
    foldId: id, revision, state, generatedContent: `generated rev-${revision}`,
    coordinates: { epoch: 'v4-offset', logFormat: 4, baselineNextSeq: 0, previewNextSeq: 5 },
    estimatedTokens: 10, structureValid: true,
    createdAt: 3, updatedAt: 3, ...extra,
  }
}

function sidechat(folds: FoldRecord[], revision: number): SideChatRecord {
  return {
    schema: 2, logFormat: 4, projectionVersion: RECORD_PROJECTION_VERSION,
    childSessionId: 'child', parentSessionId: 'parent',
    parent: { createdAt: 1, cwd: 'C:\\work' }, child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q', title: 't', status: 'open',
    seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 2, coordinates: { epoch: 'v4-offset', logFormat: 4 }, messages: [] },
    modelStrategy: { kind: 'default' }, createdAt: 2, updatedAt: 3,
    revision, folds, cites: [],
  }
}

function foldContent(label: string): string {
  return [
    `# SideChat 澄清结论：${label}`,
    '- 背景：b',
    '- 结论：c',
    '- 依据：d',
    '- 对父会话的影响：e',
    '- 未决：f',
  ].join('\n')
}

function makeHarness(table: MemoryTable) {
  const parentEvents: SessionEvent[] = []
  const childEvents: SessionEvent[] = []
  const flush = vi.fn(async () => true)
  const parentAgent = {
    id: 'parent',
    status: 'idle' as const,
    session: {
      id: 'parent', header: header('parent', 1), events: parentEvents,
      requestContext: () => ({ provider: 'mock', model: 'm', contextWindow: 1_000 }),
      append: (type: string, data: unknown) => { parentEvents.push(event(parentEvents.length + 1, type, data)) },
    },
    ctx: { tools: { schemas: () => [] }, compaction: { compactNow: vi.fn(async () => null) } },
    whenIdle: vi.fn(async () => undefined),
    runMaintenance: vi.fn(async (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal)),
  }
  const sessionController = {
    inspect: vi.fn(async (sessionId: string) => {
      if (sessionId === 'parent') return { meta: header('parent', 1), events: parentEvents, inheritedEventCount: 0 }
      if (sessionId === 'child') return { meta: header('child', 2), events: childEvents, inheritedEventCount: 0 }
      throw new Error('not found')
    }),
    resolveAgent: vi.fn(async (sessionId: string) => sessionId === 'parent'
      ? { agent: parentAgent }
      : { error: { message: 'not loaded' } }),
  }
  const ctx = new Context()
  ctx.provide('sessionController', sessionController)
  ctx.provide('sessionQuery', {
    readSession: vi.fn(async (sessionId: string) => ({
      session: sessionId === 'parent' ? header('parent', 1) : header('child', 2),
      inheritedEventCount: 0,
      events: sessionId === 'parent' ? parentEvents : childEvents,
    })),
  })
  ctx.provide('agentPresets', {
    composedPreset: vi.fn(() => undefined),
    serviceFor: vi.fn(() => undefined),
  })
  ctx.provide('sessions', { flush })
  ctx.provide('tokenMeter', { measure: () => ({ totalTokens: 0 }), estimateMessage: () => 50 })
  const service = new SideChatService(ctx)
  Object.defineProperty(service, 'table', { value: table, writable: true })
  return { service, table, parentEvents, flush }
}

function parentMessages(events: readonly SessionEvent[]): SessionEvent[] {
  return events.filter(item => item.type === 'user/message')
}

describe('commitFold revision fencing', () => {
  it('rejects committing an older prepared revision after a newer one is committed, even with allowStale', async () => {
    const table = new MemoryTable()
    const rev1 = fold(REV_1, 1, 'prepared')
    const rev2 = fold(REV_2, 2, 'committed', { committedContent: 'v2', revisionState: 'current', committedAt: 4, updatedAt: 4 })
    table.rows.set('child', sidechat([rev1, rev2], 2))
    const harness = makeHarness(table)

    const result = await harness.service.commitFold({
      childSessionId: 'child', foldId: REV_1, content: foldContent('old'), allowStale: true,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'fold-superseded' } })
    expect(table.rows.get('child')!.folds.find(item => item.foldId === REV_1)).toMatchObject({ state: 'prepared' })
    expect(table.rows.get('child')!.folds.find(item => item.foldId === REV_2)).toMatchObject({ revisionState: 'current' })
    expect(harness.parentEvents).toHaveLength(0)
  })

  it('counts a pending newer revision as a barrier too', async () => {
    const table = new MemoryTable()
    const rev1 = fold(REV_1, 1, 'prepared')
    const rev2 = fold(REV_2, 2, 'pending', { committedContent: 'v2', updatedAt: 4 })
    table.rows.set('child', sidechat([rev1, rev2], 2))
    const harness = makeHarness(table)

    const result = await harness.service.commitFold({
      childSessionId: 'child', foldId: REV_1, content: foldContent('old'), allowStale: true,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'fold-superseded' } })
    expect(harness.parentEvents).toHaveLength(0)
  })

  it('allows the older revision once the newer one is withdrawn, and commits it end to end', async () => {
    const table = new MemoryTable()
    const rev1 = fold(REV_1, 1, 'prepared')
    const rev2 = fold(REV_2, 2, 'committed', {
      committedContent: 'v2', revisionState: 'withdrawn', withdrawalState: 'committed',
      withdrawalReason: 'obsolete', withdrawnAt: 5, updatedAt: 5,
    })
    table.rows.set('child', sidechat([rev1, rev2], 2))
    const harness = makeHarness(table)

    const result = await harness.service.commitFold({
      childSessionId: 'child', foldId: REV_1, content: foldContent('restored'), allowStale: true,
    })

    expect(result).toMatchObject({ ok: true, value: { state: 'committed' } })
    expect(table.rows.get('child')!.folds.find(item => item.foldId === REV_1))
      .toMatchObject({ state: 'committed', revisionState: 'current' })
    expect(parentMessages(harness.parentEvents)).toHaveLength(1)
    expect(harness.flush).toHaveBeenCalled()
  })

  it('keeps same-foldId retries idempotent for an already committed revision', async () => {
    const table = new MemoryTable()
    const rev1 = fold(REV_1, 1, 'prepared')
    const rev2 = fold(REV_2, 2, 'committed', { committedContent: 'v2', revisionState: 'current', committedAt: 4, updatedAt: 4 })
    table.rows.set('child', sidechat([rev1, rev2], 2))
    const harness = makeHarness(table)

    // The idempotent path requires the IDENTICAL frozen content.
    const result = await harness.service.commitFold({
      childSessionId: 'child', foldId: REV_2, content: 'v2', allowStale: true,
    })

    expect(result).toMatchObject({ ok: true, value: { state: 'committed' } })
    expect(table.rows.get('child')!.folds.find(item => item.foldId === REV_2)).toMatchObject({ revisionState: 'current' })
    expect(parentMessages(harness.parentEvents)).toHaveLength(0)
  })

  it('rejects a commitFold retry that tries to change the frozen payload of a pending or committed fold', async () => {
    const table = new MemoryTable()
    const rev1 = fold(REV_1, 1, 'prepared')
    const rev2 = fold(REV_2, 2, 'pending', { committedContent: 'v2', updatedAt: 4 })
    table.rows.set('child', sidechat([rev1, rev2], 2))
    const harness = makeHarness(table)

    const result = await harness.service.commitFold({
      childSessionId: 'child', foldId: REV_2, content: foldContent('v2 rewritten payload'), allowStale: true,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'payload-frozen' } })
    expect(table.rows.get('child')!.folds.find(item => item.foldId === REV_2)).toMatchObject({ state: 'pending', committedContent: 'v2' })
    expect(parentMessages(harness.parentEvents)).toHaveLength(0)
  })

  it('rejects a withdrawal retry that tries to change the frozen reason, and keeps the identical retry idempotent', async () => {
    const table = new MemoryTable()
    const rev1 = fold(REV_1, 1, 'committed', {
      committedContent: 'v1', revisionState: 'withdrawn', withdrawalState: 'committed',
      withdrawalReason: 'obsolete', withdrawnAt: 5, updatedAt: 5,
    })
    table.rows.set('child', sidechat([rev1], 1))
    const harness = makeHarness(table)

    const changed = await harness.service.withdrawFold({
      childSessionId: 'child', foldId: REV_1, reason: 'a completely different reason',
    })
    expect(changed).toMatchObject({ ok: false, error: { code: 'payload-frozen' } })
    expect(table.rows.get('child')!.folds[0]).toMatchObject({ withdrawalState: 'committed', withdrawalReason: 'obsolete' })

    const identical = await harness.service.withdrawFold({
      childSessionId: 'child', foldId: REV_1, reason: 'obsolete',
    })
    expect(identical).toMatchObject({ ok: true, value: { state: 'committed' } })
    expect(parentMessages(harness.parentEvents)).toHaveLength(0)
  })

  it('still lets a newer revision commit in order after an older one', async () => {
    const table = new MemoryTable()
    const rev1 = fold(REV_1, 1, 'committed', { committedContent: 'v1', revisionState: 'current', committedAt: 4, updatedAt: 4 })
    const rev2 = fold(REV_2, 2, 'prepared')
    table.rows.set('child', sidechat([rev1, rev2], 2))
    const harness = makeHarness(table)

    const result = await harness.service.commitFold({
      childSessionId: 'child', foldId: REV_2, content: foldContent('new'), allowStale: true,
    })

    expect(result).toMatchObject({ ok: true, value: { state: 'committed' } })
    expect(table.rows.get('child')!.folds.find(item => item.foldId === REV_1)).toMatchObject({ revisionState: 'superseded' })
    expect(table.rows.get('child')!.folds.find(item => item.foldId === REV_2))
      .toMatchObject({ state: 'committed', revisionState: 'current' })
    expect(parentMessages(harness.parentEvents)).toHaveLength(1)
  })
})
