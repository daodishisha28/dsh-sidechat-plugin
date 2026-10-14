import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { buildFoldParentMessage } from '../src/fold.ts'
import { SideChatService } from '../src/service.ts'
import type { CiteRecord, FoldRecord, SideChatRecord } from '../src/types.ts'

const FOLD_ID = '11111111-1111-4111-8111-111111111111'
const CITE_ID = '22222222-2222-4222-8222-222222222222'
const PROJECTION_VERSION = 'test-projection-v1'

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

function foldContent(): string {
  return ['# SideChat 澄清结论：交付恢复', '- 背景：b', '- 结论：c', '- 依据：d', '- 对父会话的影响：e', '- 未决：f'].join('\n')
}

function foldMarker(foldId: string, revision: number, child: string): string {
  return `[SideChat fold id=${foldId} rev=${revision} source=${child}]`
}

/** The exact parent delivery text deliverFold builds for the pending fixture fold. */
function foldDeliveryText(): string {
  return buildFoldParentMessage(foldMarker(FOLD_ID, 1, 'child'), 't', foldContent())
}

function deliveryEvent(id: string, seq: number, source: Record<string, unknown>, text: string): SessionEvent {
  return event(seq, 'user/message', { id, role: 'user', source, content: [{ type: 'text', text }] })
}

function pendingFoldRecord(): SideChatRecord {
  const fold: FoldRecord = {
    foldId: FOLD_ID, revision: 1, state: 'pending', generatedContent: foldContent(),
    committedContent: foldContent(),
    coordinates: { epoch: 'v4-offset', logFormat: 4, baselineNextSeq: 0, previewNextSeq: 0 },
    estimatedTokens: 20, structureValid: true, createdAt: 3, updatedAt: 4,
  }
  return {
    schema: 2, logFormat: 4, projectionVersion: PROJECTION_VERSION,
    childSessionId: 'child', parentSessionId: 'parent',
    parent: { createdAt: 1, cwd: 'C:\\work' }, child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q', title: 't', status: 'open',
    seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 2, coordinates: { epoch: 'v4-offset', logFormat: 4 }, messages: [] },
    modelStrategy: { kind: 'default' }, createdAt: 2, updatedAt: 4, revision: 1,
    folds: [fold], cites: [],
  }
}

function pendingCiteRecord(): SideChatRecord {
  const cite: CiteRecord = {
    citeId: CITE_ID, messageId: 'reply-1', state: 'pending', content: 'referenced reply',
    estimatedTokens: 5, createdAt: 3, updatedAt: 3, targetSessionId: 'other-parent',
    target: { createdAt: 9, cwd: 'C:\\work' }, crossParent: true,
  }
  return { ...pendingFoldRecord(), cites: [cite] }
}

interface HarnessOptions {
  /** Whether the persistence listener accepts flushes; flipped by tests to simulate recovery. */
  readonly flushWorks?: boolean
  /** Disk state at construction; the live agent reattaches from this log. */
  readonly parentPersisted?: SessionEvent[]
  readonly otherPersisted?: SessionEvent[]
  /** Gate every parent flush behind a deferred the test controls. */
  readonly gateParentFlush?: boolean
}

/**
 * Honest live-vs-disk model matching the real alpha.2 behavior:
 * - `session.append` only adds the event to the agent's IN-MEMORY list;
 * - `ctx.sessions.flush` copies memory → persisted and returns true (or false
 *   when simulating a failing persistence listener);
 * - `sessionQuery.readSession` is LIVE-PREFERRED: it returns the IN-MEMORY
 *   list while the agent is live (including appended-but-unflushed events),
 *   exactly like upstream `snapshotLive`
 *   (packages/session-query/session-query/src/corpus.ts:98-127).
 */
function makeRecoveryHarness(table: MemoryTable, options: HarnessOptions = {}) {
  const makeLists = (persisted: SessionEvent[]) => ({ memory: [...persisted], disk: [...persisted] })
  const parentLists = makeLists(options.parentPersisted ?? [])
  const otherLists = makeLists(options.otherPersisted ?? [])
  const childLists = makeLists([])
  const sessionLists: Record<string, { memory: SessionEvent[]; disk: SessionEvent[] }> = {
    parent: parentLists, 'other-parent': otherLists, child: childLists,
  }
  const flushState = { works: options.flushWorks ?? true }
  const flushGateResolvers: Array<() => void> = []
  const parentAppends: SessionEvent[] = []

  const parentAgent = {
    id: 'parent',
    status: 'idle' as const,
    session: {
      id: 'parent', header: header('parent', 1), seq: parentLists.memory.length, inheritedEventCount: 0,
      events: parentLists.memory,
      requestContext: () => ({ provider: 'mock', model: 'm', contextWindow: 1_000_000 }),
      append: (type: string, data: unknown) => {
        const appended = event(parentLists.memory.length, type, data)
        parentLists.memory.push(appended)
        parentAppends.push(appended)
        return appended
      },
    },
    ctx: { tools: { schemas: () => [] } },
    options: {},
    whenIdle: vi.fn(async () => undefined),
    runMaintenance: vi.fn(async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal)),
  }
  const otherAgent = {
    ...parentAgent,
    id: 'other-parent',
    session: {
      id: 'other-parent', header: header('other-parent', 9), seq: otherLists.memory.length, inheritedEventCount: 0,
      events: otherLists.memory,
      requestContext: () => ({ provider: 'mock', model: 'm', contextWindow: 1_000_000 }),
      append: (type: string, data: unknown) => {
        const appended = event(otherLists.memory.length, type, data)
        otherLists.memory.push(appended)
        return appended
      },
    },
  }
  const sessionController = {
    inspect: vi.fn(async (sessionId: string) => {
      if (sessionId === 'parent') return { meta: header('parent', 1), events: parentLists.memory, inheritedEventCount: 0 }
      if (sessionId === 'other-parent') return { meta: header('other-parent', 9), events: otherLists.memory, inheritedEventCount: 0 }
      if (sessionId === 'child') return { meta: header('child', 2), events: childLists.memory, inheritedEventCount: 0 }
      throw new Error('not found')
    }),
    resolveAgent: vi.fn(async (sessionId: string) => sessionId === 'parent'
      ? { agent: parentAgent }
      : sessionId === 'other-parent' ? { agent: otherAgent } : { error: { message: 'not loaded' } }),
  }
  const ctx = new Context()
  const closeOrder: string[] = []
  ctx.provide('storageDomain', { open: vi.fn(async () => ({ table: vi.fn(() => table), close: vi.fn(async () => { closeOrder.push('domain:close') }) })) })
  ctx.provide('sessionController', sessionController)
  ctx.provide('sessionQuery', {
    readSession: vi.fn(async (sessionId: string) => {
      const id = String(sessionId)
      const lists = sessionLists[id]
      if (lists === undefined) throw new Error('not found')
      return {
        session: id === 'parent' ? header('parent', 1) : id === 'other-parent' ? header('other-parent', 9) : header('child', 2),
        inheritedEventCount: 0,
        events: lists.memory,
      }
    }),
  })
  ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => []) })
  ctx.provide('agentPresets', { composedPreset: vi.fn(() => undefined), serviceFor: vi.fn(() => undefined) })
  ctx.provide('sessions', {
    flush: vi.fn(async (session: { readonly id: string }) => {
      const lists = sessionLists[session.id]
      if (lists === undefined) return false
      if (session.id === 'parent' && options.gateParentFlush === true) {
        await new Promise<void>(resolve => { flushGateResolvers.push(resolve) })
      }
      if (!flushState.works) return false
      for (const appended of lists.memory) {
        if (!lists.disk.some(diskEvent => diskEvent.seq === appended.seq && diskEvent.type === appended.type)) {
          lists.disk.push(appended)
        }
      }
      return true
    }),
  })
  ctx.provide('tokenMeter', { measure: vi.fn(() => ({ totalTokens: 0 })), estimateMessage: vi.fn(() => 10) })
  const effect = vi.fn()
  ctx.provide('effect', effect)
  ctx.provide('on', vi.fn())
  ctx.provide('connection', { rpc: { handle: vi.fn(() => () => undefined) } })
  const service = new SideChatService(ctx)
  Object.defineProperty(service, 'table', { value: table, writable: true })
  const init = async (): Promise<void> => {
    await (service as unknown as { [Service.init]: () => Promise<void> })[Service.init]()
  }
  return {
    service, table, ctx, init, flushState, flushGateResolvers, parentAppends,
    parentMemory: parentLists.memory, parentDisk: parentLists.disk,
    otherMemory: otherLists.memory, closeOrder, effect,
  }
}

async function settle(maxMs = 2_000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
}

async function waitFor(predicate: () => boolean, maxMs = 2_000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  expect(predicate()).toBe(true)
}

function parentUserMessages(events: readonly SessionEvent[]): SessionEvent[] {
  return events.filter(item => item.type === 'user/message')
}

describe('unified delivery transactions and crash recovery', () => {
  it('delivers a pending Fold once and anchors the commit to the persisted message', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const harness = makeRecoveryHarness(table)
    await harness.init()
    await settle()
    const committed = harness.table.rows.get('child')?.folds[0]
    expect(committed).toMatchObject({ state: 'committed', revisionState: 'current' })
    expect(committed?.committedMessageId).toEqual(expect.any(String))
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(1)
    expect(parentUserMessages(harness.parentDisk)).toHaveLength(1)
    expect(parentUserMessages(harness.parentMemory)[0]?.data.source.kind).toBe('plugin:dsh-sidechat')
    expect(parentUserMessages(harness.parentMemory)[0]?.data.content[0]?.text).toContain(foldMarker(FOLD_ID, 1, 'child'))
  })

  it('crash point 3 — an already committed record is never re-delivered by the cold sweep', async () => {
    const table = new MemoryTable()
    const committedRecord: SideChatRecord = {
      ...pendingFoldRecord(),
      folds: pendingFoldRecord().folds.map(fold => ({
        ...fold, state: 'committed' as const, revisionState: 'current' as const,
        committedMessageId: 'committed-message', committedAt: 5, updatedAt: 5,
      })),
    }
    table.rows.set('child', committedRecord)
    const harness = makeRecoveryHarness(table, {
      parentPersisted: [deliveryEvent('committed-message', 0, { kind: 'plugin:dsh-sidechat', form: 'notice', summary: 'Fold SideChat revision 1' }, foldDeliveryText())],
    })
    await harness.init()
    await settle()
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'committed', committedMessageId: 'committed-message' })
    expect(harness.parentAppends).toHaveLength(0)
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(1)
  })

  it('crash point 2 — flush-before-domain-commit: the persisted delivery is adopted without a second append', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    // Crash artifact: append + flush succeeded, then the process died before
    // the storage domain committed. After restart the live agent reattaches
    // from the persisted log, so memory and disk both carry the message.
    const harness = makeRecoveryHarness(table, {
      parentPersisted: [deliveryEvent('crash-message', 0, { kind: 'plugin:dsh-sidechat', form: 'notice', summary: 'Fold SideChat revision 1' }, foldDeliveryText())],
    })
    await harness.init()
    await settle()
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({
      state: 'committed',
      committedMessageId: 'crash-message',
    })
    expect(harness.parentAppends).toHaveLength(0)
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(1)
    expect(parentUserMessages(harness.parentDisk)).toHaveLength(1)
  })

  it('crash point 1 — append-before-flush: retries never commit an unproven delivery and never append twice', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const harness = makeRecoveryHarness(table, { flushWorks: false })
    await harness.init()
    await settle()
    // First attempt appended to memory but the flush failed: the fold failed
    // with the flush error and the marker exists ONLY in memory, never on disk.
    const afterFirst = harness.table.rows.get('child')?.folds[0]
    expect(afterFirst?.state).toBe('failed')
    expect(afterFirst?.committedMessageId).toBeUndefined()
    expect(afterFirst?.failure).toContain('no persistence listener flushed')
    expect(harness.parentAppends).toHaveLength(1)
    expect(parentUserMessages(harness.parentDisk)).toHaveLength(0)
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(1)

    // Retry with the flush STILL failing: the marker is found in the
    // live-preferred read, but durability cannot be proven — the record must
    // stay non-committed with an explicit delivery-not-proven error.
    const retryFailure = await harness.service.commitFold({
      childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true,
    })
    expect(retryFailure).toMatchObject({ ok: false, error: { code: 'fold-delivery-failed' } })
    expect(retryFailure.error?.message).toMatch(/durability is unproven|may have happened/u)
    const afterRetry = harness.table.rows.get('child')?.folds[0]
    expect(afterRetry?.state).toBe('failed')
    expect(afterRetry?.committedMessageId).toBeUndefined()
    expect(afterRetry?.failure).toMatch(/durability is unproven|may have happened/u)
    expect(harness.parentAppends).toHaveLength(1)
    expect(parentUserMessages(harness.parentDisk)).toHaveLength(0)

    // Retry with the flush working: the same delivery is adopted (flush proof
    // + re-read) and committed WITHOUT a second append.
    harness.flushState.works = true
    const retrySuccess = await harness.service.commitFold({
      childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true,
    })
    expect(retrySuccess).toMatchObject({ ok: true, value: { state: 'committed' } })
    const committed = harness.table.rows.get('child')?.folds[0]
    expect(committed?.state).toBe('committed')
    expect(committed?.committedMessageId).toEqual(expect.any(String))
    expect(harness.parentAppends).toHaveLength(1)
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(1)
    expect(parentUserMessages(harness.parentDisk)).toHaveLength(1)
  })

  it('a FAILED fold keeps its frozen payload: changed content is rejected, identical content recovers', async () => {
    // Actual sequence: delivery flush fails → fold marked failed WITH its
    // frozen committedContent (possibly already appended to the parent live
    // log) → commitFold with CHANGED content must NOT rewrite the frozen body
    // under the same foldId/marker; commitFold with the SAME content recovers
    // through re-delivery without a duplicate append.
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const harness = makeRecoveryHarness(table, { flushWorks: false })
    await harness.init()
    await settle()
    // First attempt appended to memory but the flush failed: the fold is
    // failed and its payload stays frozen.
    const failed = harness.table.rows.get('child')?.folds[0]
    expect(failed?.state).toBe('failed')
    expect(failed?.committedContent).toBe(foldContent())
    expect(harness.parentAppends).toHaveLength(1)

    // Changed content under the same foldId: rejected as payload-frozen.
    const changed = await harness.service.commitFold({
      childSessionId: 'child', foldId: FOLD_ID, content: `${foldContent()}\n- 未决：被篡改的结尾`, allowStale: true,
    })
    expect(changed).toMatchObject({ ok: false, error: { code: 'payload-frozen' } })
    expect(harness.table.rows.get('child')?.folds[0]?.committedContent).toBe(foldContent())
    expect(harness.table.rows.get('child')?.folds[0]?.state).toBe('failed')

    // Identical content: the existing recovery path — re-delivery succeeds,
    // no duplicate append.
    harness.flushState.works = true
    const recovered = await harness.service.commitFold({
      childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true,
    })
    expect(recovered).toMatchObject({ ok: true, value: { state: 'committed' } })
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'committed' })
    expect(harness.parentAppends).toHaveLength(1)
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(1)
    expect(parentUserMessages(harness.parentDisk)).toHaveLength(1)
  })

  it('keeps a failed flush from committing: the Fold stays failed with its reason', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const harness = makeRecoveryHarness(table, { flushWorks: false })
    await harness.init()
    await settle()
    expect(harness.table.rows.get('child')?.folds[0]?.state).toBe('failed')
    expect(harness.table.rows.get('child')?.folds[0]?.failure).toContain('no persistence listener flushed')
  })

  it('does not treat a user-pasted marker as an already-delivered operation', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const marker = foldMarker(FOLD_ID, 1, 'child')
    const harness = makeRecoveryHarness(table, {
      parentPersisted: [deliveryEvent('pasted', 0, { kind: 'user' }, `用户手工粘贴了 marker：${marker}`)],
    })
    await harness.init()
    await settle()
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'committed' })
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(2)
    expect(harness.table.rows.get('child')?.folds[0]?.committedMessageId).not.toBe('pasted')
  })

  it('does not treat a SideChat snapshot message quoting the full marker and payload as a delivery', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const harness = makeRecoveryHarness(table, {
      parentPersisted: [deliveryEvent('snapshot-quote', 0, { kind: 'plugin:dsh-sidechat', form: 'snapshot', sections: [] }, foldDeliveryText())],
    })
    await harness.init()
    await settle()
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'committed' })
    // A fresh delivery was appended next to the quoting snapshot message.
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(2)
    expect(harness.table.rows.get('child')?.folds[0]?.committedMessageId).not.toBe('snapshot-quote')
  })

  it('does not treat a plain SideChat producer message quoting the delivery as a delivery', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const harness = makeRecoveryHarness(table, {
      parentPersisted: [deliveryEvent('plain-quote', 0, { kind: 'plugin:dsh-sidechat' }, foldDeliveryText())],
    })
    await harness.init()
    await settle()
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'committed' })
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(2)
    expect(harness.table.rows.get('child')?.folds[0]?.committedMessageId).not.toBe('plain-quote')
  })

  it('does not adopt a SideChat notice with the right marker but a different frozen payload', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const marker = foldMarker(FOLD_ID, 1, 'child')
    const harness = makeRecoveryHarness(table, {
      parentPersisted: [deliveryEvent('imposter', 0, { kind: 'plugin:dsh-sidechat', form: 'notice', summary: 'Fold SideChat revision 1' }, `${marker}\n\n> 来自 SideChat：t\n\n完全不同的冻结载荷，不属于本次交付`)],
    })
    await harness.init()
    await settle()
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'committed' })
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(2)
    expect(harness.table.rows.get('child')?.folds[0]?.committedMessageId).not.toBe('imposter')
  })

  it('still adopts the explicit legacy delivery format (legacy producer + notice form)', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const harness = makeRecoveryHarness(table, {
      parentPersisted: [deliveryEvent('legacy-message', 0, { kind: 'plugin', plugin: 'dsh-sidechat', form: 'notice', summary: 'Fold SideChat revision 1' }, foldDeliveryText())],
    })
    await harness.init()
    await settle()
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({
      state: 'committed',
      committedMessageId: 'legacy-message',
    })
    expect(harness.parentAppends).toHaveLength(0)
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(1)
  })

  it('recovers a pending cross-parent Cite once against its frozen target identity', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingCiteRecord())
    const harness = makeRecoveryHarness(table)
    await harness.init()
    await settle()
    const cite = harness.table.rows.get('child')?.cites[0]
    expect(cite).toMatchObject({ state: 'committed' })
    expect(cite?.committedMessageId).toEqual(expect.any(String))
    expect(parentUserMessages(harness.otherMemory)).toHaveLength(1)
    expect(parentUserMessages(harness.otherMemory)[0]?.data.source.kind).toBe('plugin:dsh-sidechat')
  })

  it('delivers a pending withdrawal through its own marker without starting a parent turn', async () => {
    const table = new MemoryTable()
    const record = pendingFoldRecord()
    const withdrawn: SideChatRecord = {
      ...record,
      folds: record.folds.map(fold => ({
        ...fold,
        state: 'committed' as const,
        revisionState: 'withdrawn' as const,
        withdrawalState: 'pending' as const,
        withdrawalReason: 'obsolete',
        withdrawnAt: 5,
      })),
    }
    table.rows.set('child', withdrawn)
    const harness = makeRecoveryHarness(table)
    await harness.init()
    await settle()
    const fold = harness.table.rows.get('child')?.folds[0]
    expect(fold).toMatchObject({ withdrawalState: 'committed', revisionState: 'withdrawn' })
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(1)
    expect(parentUserMessages(harness.parentMemory)[0]?.data.content[0]?.text).toContain(`[SideChat fold-withdrawal id=${FOLD_ID} rev=1 source=child]`)
    expect(parentUserMessages(harness.parentMemory)[0]?.data.content[0]?.text).not.toContain(foldMarker(FOLD_ID, 1, 'child'))
  })

  it('recovers a fold left generating by a restart as explicitly failed, without running the model', async () => {
    const table = new MemoryTable()
    const generating: SideChatRecord = {
      ...pendingFoldRecord(),
      folds: pendingFoldRecord().folds.map(fold => ({
        ...fold, state: 'generating' as const, committedContent: undefined, generatedContent: '',
      })),
    }
    table.rows.set('child', generating)
    const harness = makeRecoveryHarness(table)
    await harness.init()
    await settle()
    const fold = harness.table.rows.get('child')?.folds[0]
    expect(fold?.state).toBe('failed')
    expect(fold?.failure).toMatch(/interrupted by a restart|re-run the preview/u)
    // The cold sweep never starts a model turn or a delivery for it.
    expect(harness.parentAppends).toHaveLength(0)
    expect(parentUserMessages(harness.parentMemory)).toHaveLength(0)
    // The record is not locked: the explicit retry pipeline accepts it again
    // (previously the 'generating' state rejected commitFold forever).
    const retry = await harness.service.commitFold({
      childSessionId: 'child', foldId: FOLD_ID, content: foldContent(), allowStale: true,
    })
    expect(retry).toMatchObject({ ok: true, value: { state: 'committed' } })
    expect(harness.parentAppends).toHaveLength(1)
  })

  it('drains in-flight deliveries BEFORE releasing read-tool and permission restrictions on dispose', async () => {
    const table = new MemoryTable()
    table.rows.set('child', pendingFoldRecord())
    const harness = makeRecoveryHarness(table, { gateParentFlush: true })
    await harness.init()
    // Register the real disposer maps with spies (the disposals whose ordering
    // the contract fixes).
    const order: string[] = []
    const internal = harness.service as unknown as {
      readToolDisposers: Map<string, () => void>
      permissionDisposers: Map<string, () => void>
    }
    internal.readToolDisposers.set('child', () => { order.push('readTool:dispose') })
    internal.permissionDisposers.set('child', () => { order.push('permission:dispose') })
    // The delivery is in flight: append already ran, flush is gated.
    await waitFor(() => harness.parentAppends.length > 0)
    order.push('delivery:append')

    // Trigger the dispose effect registered during init: the effect execute
    // returns the async disposer, which must be invoked (real Cordis invokes
    // it during fiber unload and awaits it).
    const effectMock = harness.effect as unknown as ReturnType<typeof vi.fn>
    expect(effectMock).toHaveBeenCalled()
    const execute = effectMock.mock.calls[0]?.[0] as () => () => Promise<void>
    const disposing = execute()()
    await new Promise(resolve => setTimeout(resolve, 20))
    // The delivery is still draining: restrictions are NOT yet released.
    expect(order).not.toContain('readTool:dispose')
    expect(order).not.toContain('permission:dispose')
    expect(harness.closeOrder).not.toContain('domain:close')

    // Let the delivery settle: disposers run only afterwards, then the domain closes.
    for (const resolve of harness.flushGateResolvers.splice(0)) resolve()
    await disposing
    order.push('disposal:done')
    expect(order.indexOf('delivery:append')).toBeLessThan(order.indexOf('readTool:dispose'))
    expect(order.indexOf('delivery:append')).toBeLessThan(order.indexOf('permission:dispose'))
    expect(order.indexOf('readTool:dispose')).toBeLessThan(order.indexOf('disposal:done'))
    expect(harness.closeOrder).toEqual(['domain:close'])
    expect(harness.table.rows.get('child')?.folds[0]).toMatchObject({ state: 'committed' })
  })
})
