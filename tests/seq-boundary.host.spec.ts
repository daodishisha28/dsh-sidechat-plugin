import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SideChatService } from '../src/service.ts'
import { finalAssistantAtOrAfter, logNextSeq, readRawLog, userTextEntries } from '../src/session-history.ts'
import type { SideChatRecord } from '../src/types.ts'

const FOLD_ID = '11111111-1111-4111-8111-111111111111'
const PROJECTION_VERSION = 'test-projection-v1'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

function header(id: string, createdAt: number): SessionHeader {
  return { id, createdAt, cwd: 'C:\\work', isSeeded: false, version: 4 } as unknown as SessionHeader
}

function assistantData(turn: number, id: string, text: string): unknown {
  return { turn, step: 1, message: { id, source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text }] } }
}

function v2Record(): SideChatRecord {
  return {
    schema: 2, logFormat: 4, projectionVersion: PROJECTION_VERSION,
    childSessionId: 'child', parentSessionId: 'parent',
    parent: { createdAt: 1, cwd: 'C:\\work' }, child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q', title: 't', status: 'open',
    seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 2, coordinates: { epoch: 'v4-offset', logFormat: 4 }, messages: [] },
    // Fold generation requires a SUCCESSFULLY enforced snapshot, so the
    // harness persists one matching the composed child preset.
    permission: {
      mode: 'inherit',
      childAgentPreset: 'sidechat-clarifier',
      parentSandboxMode: 'workspace-write',
      childSandboxMode: 'workspace-write',
      parentApprovalPolicy: 'ask',
      childApprovalPolicy: 'ask',
      parentTools: ['read', 'glob'],
      allowedTools: ['read', 'glob'],
      capturedAt: 5,
    },
    modelStrategy: { kind: 'default' }, createdAt: 2, updatedAt: 3, revision: 0, folds: [], cites: [],
  }
}

interface FakeLoopOptions {
  readonly seedEvents?: SessionEvent[]
  /** Final assistant text per turn (index = turn - 1); a missing entry means the turn produced no assistant text. */
  readonly turnOutputs: readonly string[]
  /** Extra events appended inside a turn AFTER its user/message and BEFORE its final assistant message. */
  readonly turnPreScripts?: Readonly<Record<number, (append: (event: SessionEvent) => void, turn: number) => void>>
  /**
   * Simulate ANOTHER ordinary user turn queued right after the Nth plugin
   * followup (1-based) — the user submitted fresh input while the Fold/rewrite
   * turn was pending. Its answer lands in its own later turn.
   */
  readonly ordinaryQueuedAfterFollowup?: number
  /** Answer text of the ordinary queued turn (valid Fold-structured text in the regressions). */
  readonly ordinaryTurnAnswer?: string
  /** Simulate a parked/discarded prompt: followup enqueues nothing and whenIdle resolves without any turn. */
  readonly dropQueuedPrompt?: boolean
  /** Simulate a failed permission install (restrict throws) → blocked child. */
  readonly restrictThrows?: boolean
  readonly cold?: boolean
  readonly turnEndKind?: string
  readonly interruptedOutput?: boolean
}

/**
 * Simulated live child with the REAL upstream turn shapes:
 * `agent.followup(message)` returns void; when the turn is claimed the loop
 * appends `turn/start {turn}`, then the claimed message itself as
 * `user/message` (data IS the UserMessage with its stable id), then
 * `assistant/message` whose data carries `turn` and `step`
 * (packages/core/session/src/types.ts:283-309, 334-350). `session.seq` is the
 * next offset; whenIdle drains the whole pending queue in order, so a turn
 * queued behind the Fold prompt settles BEFORE whenIdle resolves — exactly
 * the "whenIdle does not identify the settlement of any particular message"
 * contract (packages/core/agent/src/runtime-types.ts:191-199).
 */
function makeFakeAgent(options: FakeLoopOptions) {
  const events: SessionEvent[] = [...options.seedEvents ?? []]
  const session = {
    id: 'child',
    header: header('child', 2),
    get seq(): number { return events.length },
    inheritedEventCount: 0,
    events,
  }
  const append = (type: string, data: unknown): SessionEvent => {
    const appended = event(events.length, type, data)
    events.push(appended)
    return appended
  }
  let turn = 0
  let followupCount = 0
  interface Queued { readonly message: { readonly id: string }; readonly ordinary: boolean }
  const queue: Queued[] = []
  const runTurn = (queued: Queued): void => {
    turn += 1
    append('turn/start', { turn })
    if (queued.ordinary) {
      append('user/message', { id: `ordinary-${turn}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'one more ordinary question' }] })
    } else {
      append('user/message', queued.message)
    }
    options.turnPreScripts?.[turn]?.(entry => { append(entry.type, entry.data) }, turn)
    const text = options.turnOutputs[turn - 1]
    if (text !== undefined) append('assistant/message', { ...assistantData(turn, `reply-${turn}`, text) as object, ...(options.interruptedOutput ? { interrupted: true } : {}) })
    if (options.turnEndKind !== 'unsettled') append('turn/end', { turn, reason: { kind: options.turnEndKind ?? 'completed' } })
  }
  const followup = vi.fn((message: { readonly id: string }) => {
    followupCount += 1
    if (options.dropQueuedPrompt === true) return
    queue.push({ message, ordinary: false })
    if (options.ordinaryQueuedAfterFollowup === followupCount && options.ordinaryTurnAnswer !== undefined) {
      queue.push({ message: { id: `ordinary-pending-${followupCount}` }, ordinary: true })
    }
  })
  const childRestrict = vi.fn(options.restrictThrows === true
    ? () => { throw new Error('tools.restrict() requires a scoped context') }
    : () => vi.fn())
  const childGuard = vi.fn(() => vi.fn())
  const agent = {
    id: 'child',
    status: 'idle' as const,
    session,
    ctx: {
      tools: { schemas: () => [{ name: 'read' }, { name: 'glob' }], restrict: childRestrict, guard: childGuard },
      systemPrompt: { section: vi.fn(() => vi.fn()), getSectionOrder: vi.fn(() => 10200) },
    },
    options: { provider: 'p', model: 'm' },
    followup,
    whenIdle: vi.fn(async () => {
      while (queue.length > 0) runTurn(queue.shift()!)
    }),
    runMaintenance: vi.fn(async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal)),
  }
  return { agent, events, followup, childRestrict, childGuard }
}

function makeGenerateHarness(options: FakeLoopOptions) {
  const table = {
    rows: new Map<string, SideChatRecord>([['child', v2Record()]]),
    get: (key: string) => (table.rows as Map<string, SideChatRecord>).get(key),
    entries: () => (table.rows as Map<string, SideChatRecord>).entries(),
    put: async (key: string, value: SideChatRecord) => { (table.rows as Map<string, SideChatRecord>).set(key, value) },
    update: async (key: string, update: (current: SideChatRecord) => SideChatRecord) => {
      const next = update((table.rows as Map<string, SideChatRecord>).get(key)!)
      ;(table.rows as Map<string, SideChatRecord>).set(key, next)
      return next
    },
  }
  const { agent, events, followup, childRestrict } = makeFakeAgent(options)
  const ctx = new Context()
  ctx.provide('sessionController', {
    inspect: vi.fn(async (sessionId: string) => ({
      meta: sessionId === 'parent' ? header('parent', 1) : header('child', 2),
      events,
      inheritedEventCount: 0,
    })),
    resolveAgent: vi.fn(async () => ({ agent })),
  })
  ctx.provide('sessionQuery', {
    readSession: vi.fn(async () => ({ session: header('child', 2), inheritedEventCount: 0, events })),
  })
  ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => []) })
  ctx.provide('agentPresets', { composedPreset: vi.fn(() => 'sidechat-clarifier'), serviceFor: vi.fn(() => undefined) })
  ctx.provide('sessions', { flush: vi.fn() })
  ctx.provide('tokenMeter', { measure: vi.fn(), estimateMessage: vi.fn() })
  ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  const service = new SideChatService(ctx)
  Object.defineProperty(service, 'table', { value: table, writable: true })
  // Install the persisted snapshot through the real ensurePermission path so
  // generateFold's strict `assertPermissionEnforced` gate passes.
  const install = options.cold === true ? true : (service as unknown as { ensurePermission: (agent: unknown) => boolean }).ensurePermission(agent)
  expect(install).toBe(options.cold === true || options.restrictThrows !== true)
  return { service, rows: table.rows as Map<string, SideChatRecord>, followup, events, childRestrict, agent }
}

const VALID_FOLD = '# SideChat 澄清结论：t\n- 背景：b\n- 结论：c\n- 依据：d\n- 对父会话的影响：e\n- 未决：f'

describe('half-open seq boundaries (session.seq is the next offset)', () => {
  it('reads an empty log at offset 0 with no sentinel event', async () => {
    const log = await readRawLog({ readSession: async () => ({ session: header('child', 2), inheritedEventCount: 0, events: [] }) }, 'child')
    expect(logNextSeq(log)).toBe(0)
    expect(finalAssistantAtOrAfter(log.events, 0)).toBeUndefined()
  })

  it('includes the assistant exactly at the exclusive baseline and excludes earlier ones', () => {
    const events = [
      event(3, 'assistant/message', assistantData(1, 'old', 'old answer')),
      event(10, 'assistant/message', assistantData(2, 'new', 'new answer')),
    ]
    expect(finalAssistantAtOrAfter(events, 10)?.messageId).toBe('new')
    expect(finalAssistantAtOrAfter(events, 4)?.messageId).toBe('new')
    expect(finalAssistantAtOrAfter(events, 11)).toBeUndefined()
  })

  it('recognizes only SideChat producer user messages, not plain user text', () => {
    const events = [
      event(1, 'user/message', { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '[SideChat fold id=x]' }] }),
      event(2, 'user/message', { id: 'u2', source: { kind: 'plugin:dsh-sidechat' }, content: [{ type: 'text', text: '[SideChat fold id=x]' }] }),
      event(3, 'user/message', { id: 'u3', source: { kind: 'plugin', plugin: 'dsh-sidechat' }, content: [{ type: 'text', text: '[SideChat fold id=x]' }] }),
      event(4, 'user/message', { id: 'u4', source: { kind: 'plugin', plugin: 'other-plugin' }, content: [{ type: 'text', text: '[SideChat fold id=x]' }] }),
    ]
    const entries = userTextEntries(events)
    expect(entries.map(entry => entry.producer)).toEqual([undefined, 'current', 'legacy', undefined])
  })
})

describe('Fold generation exclusive offsets', () => {
  it('captures baseline 0 on an empty log and reads the first new reply', async () => {
    const harness = makeGenerateHarness({ turnOutputs: [VALID_FOLD] })
    const fold = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(fold).toMatchObject({ ok: true })
    const reserved = harness.rows.get('child')?.folds[0]
    expect(reserved).toMatchObject({
      state: 'prepared',
      coordinates: { epoch: 'v4-offset', logFormat: 4, baselineNextSeq: 0, previewNextSeq: 4 },
    })
    expect(harness.followup).toHaveBeenCalledOnce()
  })

  it('reads the new assistant after a 10-event prefix (no off-by-one)', async () => {
    const seedEvents = Array.from({ length: 10 }, (_value, index) =>
      event(index, 'user/message', { id: `seed-${index}`, source: { kind: 'user' }, content: [{ type: 'text', text: `seed ${index}` }] }))
    const harness = makeGenerateHarness({
      seedEvents,
      turnOutputs: [VALID_FOLD],
    })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: true })
    const fold = harness.rows.get('child')?.folds[0]
    expect(fold).toMatchObject({
      coordinates: { baselineNextSeq: 10, previewNextSeq: 14 },
    })
    expect(fold?.generatedContent).toContain('SideChat 澄清结论')
    // The seed events at seq 0-9 were never mistaken for the generated reply,
    // and the answer is the turn-1 assistant event.
    const last = harness.events.findLast(item => item.type === 'assistant/message')
    expect(last?.type).toBe('assistant/message')
    expect((last!.data as { turn: number }).turn).toBe(1)
    expect(last?.seq).toBe(12)
  })

  it('re-previews after exactly one new child event and marks the old preview stale', async () => {
    const seedEvents = Array.from({ length: 10 }, (_value, index) =>
      event(index, 'user/message', { id: `seed-${index}`, source: { kind: 'user' }, content: [{ type: 'text', text: `seed ${index}` }] }))
    const harness = makeGenerateHarness({
      seedEvents,
      turnOutputs: [VALID_FOLD],
    })
    await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    const prepared = harness.rows.get('child')?.folds[0]
    expect(prepared?.coordinates).toMatchObject({ previewNextSeq: 14 })
    // Exactly one new event after the preview: nextSeq 15 > previewNextSeq 14 → stale.
    harness.events.push(event(14, 'user/message', { id: 'late', source: { kind: 'user' }, content: [{ type: 'text', text: 'one more question' }] }))
    // Committing through commitFold requires the prepared state; exercising the
    // stale predicate directly keeps this test independent of the RPC layer.
    const { foldStaleReason } = await import('../src/record-compat.ts')
    expect(foldStaleReason(prepared!, 15)).toBe('stale')
    expect(foldStaleReason(prepared!, 14)).toBeUndefined()
  })

  it('rewrites an invalid first preview from the post-first-turn offset', async () => {
    const valid = VALID_FOLD
    const harness = makeGenerateHarness({ turnOutputs: ['结构不合格的输出', valid] })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: true })
    expect(harness.followup).toHaveBeenCalledTimes(2)
    const fold = harness.rows.get('child')?.folds[0]
    expect(fold).toMatchObject({ state: 'prepared', structureValid: true, coordinates: { baselineNextSeq: 0, previewNextSeq: 8 } })
    expect(fold?.generatedContent).toBe(valid)
  })

  it('picks the final answer of a generation window containing planning narration and tool steps', async () => {
    const valid = VALID_FOLD
    const harness = makeGenerateHarness({
      seedEvents: [event(0, 'tool/call', { id: 'seed-call', tool: 'read' })],
      turnPreScripts: {
        1: (append, turn) => {
          append(event(0, 'assistant/message', assistantData(turn, 'plan-narration', '计划叙述：先分析，再作答')))
          append(event(0, 'tool/call', { turn, step: 1, id: 'call', tool: 'read' }))
          append(event(0, 'tool/result', { turn, step: 1, id: 'result', content: 'ok' }))
        },
      },
      turnOutputs: [valid],
    })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: true })
    const fold = harness.rows.get('child')?.folds[0]
    // The whole window [plan narration, tool call/result, final answer] came
    // from ONE turn: the plan narration must not become the Fold payload.
    expect(fold?.generatedContent).toBe(valid)
    expect(harness.followup).toHaveBeenCalledOnce()
  })

  it('binds the answer to the Fold prompt turn: a later ordinary queued turn with a VALID Fold answer is not adopted', async () => {
    // Regression for the weak window-last selection: the Fold prompt is
    // queued, then ANOTHER ordinary user turn is queued behind it; whenIdle
    // resolves only after BOTH turns settle. The old
    // finalAssistantAtOrAfter(window) selection adopted the LAST assistant at
    // or after the baseline — the ordinary turn's later (valid, different)
    // answer. The turn-bound selection must return the FIRST turn's answer.
    const ordinaryAnswer = VALID_FOLD.replace('结论：c', '结论：普通追问的回答（不是 Fold 生成轮的答案）')
    const harness = makeGenerateHarness({
      turnOutputs: [VALID_FOLD, ordinaryAnswer],
      ordinaryQueuedAfterFollowup: 1,
      ordinaryTurnAnswer: ordinaryAnswer,
    })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: true })
    const fold = harness.rows.get('child')?.folds[0]
    expect(fold?.generatedContent).toBe(VALID_FOLD)
    expect(fold?.generatedContent).not.toContain('普通追问的回答')
    // Both turns really settled before the selection ran.
    const turns = harness.events.filter(item => item.type === 'turn/start')
    expect(turns).toHaveLength(2)
    expect(harness.followup).toHaveBeenCalledOnce()
    const { foldStaleReason } = await import('../src/record-compat.ts')
    expect(fold?.coordinates.previewNextSeq).toBe(4)
    expect(foldStaleReason(fold!, harness.events.length)).toBe('stale')
  })

  it('rewrite path: an ordinary turn queued behind the rewrite prompt is never adopted; the rewrite turn wins', async () => {
    const rewrittenAnswer = VALID_FOLD.replace('结论：c', '结论：重写后的合格结论')
    const ordinaryAnswer = VALID_FOLD.replace('结论：c', '结论：重写之后才到达的普通追问回答')
    const harness = makeGenerateHarness({
      turnOutputs: ['结构不合格的输出', rewrittenAnswer, ordinaryAnswer],
      ordinaryQueuedAfterFollowup: 2,
      ordinaryTurnAnswer: ordinaryAnswer,
    })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: true })
    expect(harness.followup).toHaveBeenCalledTimes(2)
    const fold = harness.rows.get('child')?.folds[0]
    expect(fold?.state).toBe('prepared')
    expect(fold?.structureValid).toBe(true)
    // The rewrite turn's answer wins; the later ordinary turn (valid Fold
    // text, different tail) is never adopted.
    expect(fold?.generatedContent).toBe(rewrittenAnswer)
    expect(fold?.generatedContent).not.toContain('普通追问回答')
    const turns = harness.events.filter(item => item.type === 'turn/start')
    expect(turns).toHaveLength(3)
  })

  it('fails with a diagnosable error when the Fold prompt was never admitted to a turn', async () => {
    const harness = makeGenerateHarness({ turnOutputs: [], dropQueuedPrompt: true })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: false, error: { code: 'fold-failed' } })
    expect(result.error?.message).toMatch(/was never admitted to a turn.*refusing to guess/u)
    // The reservation stays 'generating' (prepareFold surfaces the failure in
    // the outcome; the cold sweep recovers interrupted generations).
    expect(harness.rows.get('child')?.folds[0]).toMatchObject({ state: 'generating' })
  })

  it('fails with a diagnosable error when the admitted turn produced no direct assistant text', async () => {
    // The turn settles with the prompt but produces only a tool call (no
    // assistant text): the selection must refuse instead of borrowing a later
    // turn's answer.
    const harness = makeGenerateHarness({
      turnOutputs: [],
      turnPreScripts: {
        1: (append, turn) => {
          append(event(0, 'tool/call', { turn, step: 1, id: 'call', tool: 'read' }))
        },
      },
    })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: false, error: { code: 'fold-failed' } })
    expect(result.error?.message).toMatch(/turn 1 \(prompt [\w-]+\) produced no direct assistant text.*refusing to adopt an answer from another turn/u)
  })

  it('never runs Fold generation for a blocked child', async () => {
    const harness = makeGenerateHarness({
      turnOutputs: [VALID_FOLD],
      restrictThrows: true,
    })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: false, error: { code: 'fold-failed' } })
    expect(result.error?.message).toMatch(/permission enforcement is not active/u)
    expect(harness.followup).not.toHaveBeenCalled()
    expect(harness.rows.get('child')?.folds).toHaveLength(0)
  })

  it('cold Fold resumes and installs the persisted ceiling before its first followup', async () => {
    const harness = makeGenerateHarness({ turnOutputs: [VALID_FOLD], cold: true })
    expect(harness.childRestrict).not.toHaveBeenCalled()
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result.ok).toBe(true)
    expect(harness.childRestrict).toHaveBeenCalledOnce()
    expect(harness.childRestrict.mock.invocationCallOrder[0]).toBeLessThan(harness.followup.mock.invocationCallOrder[0]!)
    const { foldStaleReason } = await import('../src/record-compat.ts')
    expect(foldStaleReason(harness.rows.get('child')!.folds[0]!, harness.events.length)).toBeUndefined()
  })

  it('cold Fold refuses provider work when restoring its ceiling fails', async () => {
    const harness = makeGenerateHarness({ turnOutputs: [VALID_FOLD], cold: true, restrictThrows: true })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result.ok).toBe(false)
    expect(harness.followup).not.toHaveBeenCalled()
  })

  it.each(['aborted', 'error', 'blocked', 'interrupted', 'max-tokens', 'unsettled'])('rejects %s turns even when planning text has valid Fold structure', async turnEndKind => {
    const harness = makeGenerateHarness({ turnOutputs: [VALID_FOLD], turnEndKind })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result).toMatchObject({ ok: false, error: { code: 'fold-failed' } })
    expect(result.error?.message).toContain('did not complete successfully')
    expect(harness.rows.get('child')?.folds[0]?.state).not.toBe('prepared')
  })

  it('rejects interrupted assistant prefixes even with a completed closer', async () => {
    const harness = makeGenerateHarness({ turnOutputs: [VALID_FOLD], interruptedOutput: true })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result.ok).toBe(false)
  })

  it('rewrite explicitly binds the original invalid draft and keeps intervening ordinary context stale', async () => {
    const invalid = 'original-invalid-draft'
    const ordinary = VALID_FOLD.replace('结论：c', '结论：unrelated-new-conclusion')
    const harness = makeGenerateHarness({ turnOutputs: [invalid, ordinary, VALID_FOLD], ordinaryQueuedAfterFollowup: 1, ordinaryTurnAnswer: ordinary })
    const result = await harness.service.prepareFold({ childSessionId: 'child', foldId: FOLD_ID, mode: 'full' })
    expect(result.ok).toBe(true)
    const rewrite = harness.followup.mock.calls[1]?.[0] as unknown as { content: { text: string }[] }
    expect(rewrite.content[0]?.text).toContain(JSON.stringify({ messageId: 'reply-1', text: invalid }))
    expect(rewrite.content[0]?.text).not.toContain('unrelated-new-conclusion')
    const { foldStaleReason } = await import('../src/record-compat.ts')
    expect(foldStaleReason(harness.rows.get('child')!.folds[0]!, harness.events.length)).toBe('stale')
  })

})
