import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SideChatService } from '../src/service.ts'
import type { SideChatRecord } from '../src/types.ts'
import { projectTrajectory } from '../src/trajectory.ts'

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
  return { id, createdAt, cwd: 'C:\\work' } as unknown as SessionHeader
}

interface HarnessOptions {
  readonly stream: (request: unknown) => AsyncIterable<unknown>
  readonly parentCreatedAt?: readonly number[]
  readonly parentEvents?: SessionEvent[]
  readonly surfaceEvents?: SessionEvent[]
  readonly contextWindow?: number
}

function makeHarness(options: HarnessOptions) {
  const parentEvents = options.parentEvents ?? [
    event(1, 'user/message', {
      id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Redis is used by the cache layer.' }],
    }),
    event(2, 'request/header', {
      header: { config: { provider: 'parent-provider', model: 'parent-model', reasoningEffort: 'low' } },
    }),
  ]
  const surfaceEvents = options.surfaceEvents ?? parentEvents
  const childEvents: SessionEvent[] = []
  const createdAt = [...options.parentCreatedAt ?? [1, 1]]
  let parentInspections = 0
  let childPreset = 'sidechat-clarifier'
  const createSession = vi.fn(async (request: { readonly agentPreset?: string }) => {
    childPreset = request.agentPreset ?? 'standard'
    return { sessionId: 'child', agentPreset: childPreset }
  })
  const childToolNames = ['read', 'write', 'glob', 'grep', 'pwsh', 'web_search', 'ask_user_question', 'subagent', 'workflow']
  const append = (target: SessionEvent[]) => (type: string, data: unknown) => {
    target.push(event(target.length + 1, type, data))
  }
  const childRestrict = vi.fn(() => vi.fn())
  const childAgent = {
    id: 'child',
    options: { provider: 'child-provider', model: 'child-model' },
    session: { id: 'child', header: header('child', 2), events: childEvents, append: append(childEvents) },
    ctx: {
      tools: { schemas: vi.fn(() => childToolNames.map(name => ({ name }))), restrict: childRestrict },
      systemPrompt: { section: vi.fn(() => vi.fn()) },
    },
    followup: vi.fn(),
  }
  const parentAgent = {
    id: 'parent',
    options: { provider: 'parent-provider', model: 'parent-model' },
    session: { id: 'parent', header: header('parent', 1), events: parentEvents, append: append(parentEvents) },
    ctx: { tools: { schemas: vi.fn(() => childToolNames.filter(name => name !== 'write').map(name => ({ name }))) } },
  }
  const sessionController = {
    inspect: vi.fn(async (sessionId: string) => {
      if (sessionId === 'parent') {
        const identity = createdAt[Math.min(parentInspections, createdAt.length - 1)] ?? 1
        parentInspections += 1
        return { meta: header('parent', identity), events: parentEvents }
      }
      if (sessionId === 'child') return { meta: header('child', 2), events: childEvents }
      throw new Error('not found')
    }),
    create: createSession,
    resolveAgent: vi.fn(async (sessionId: string) => sessionId === 'child'
      ? { agent: childAgent }
      : sessionId === 'parent' ? { agent: parentAgent } : { error: { message: 'not loaded' } }),
    rename: vi.fn(async () => undefined),
  }
  const requests: unknown[] = []
  const readSurface = vi.fn(async () => ({ events: surfaceEvents, capturedThroughSeq: surfaceEvents.at(-1)?.seq ?? 0 }))
  const readSession = vi.fn(async () => ({ session: header('parent', 1), events: parentEvents }))
  const ctx = new Context()
  ctx.provide('sessionController', sessionController)
  ctx.provide('sessionQuery', {
    readSurface,
    readSession,
  })
  ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => []) })
  ctx.provide('agentPresets', {
    composedPreset: vi.fn((agentContext: unknown) => agentContext === parentAgent.ctx ? 'standard' : childPreset),
  })
  ctx.provide('sandboxPolicy', { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: 'C:\\work' })) })
  ctx.provide('approval', { overrideOf: vi.fn(() => 'ask'), config: { policy: 'ask' } })
  ctx.provide('agentDefaultModel', { currentSelection: vi.fn(() => ({ provider: 'child-provider', model: 'child-model' })) })
  ctx.provide('llm', {
    stream: vi.fn((request: unknown) => { requests.push(request); return options.stream(request) }),
    resolveModelInfo: vi.fn(async () => options.contextWindow === undefined
      ? { provider: 'child-provider', id: 'child-model' }
      : { provider: 'child-provider', id: 'child-model', context: { contextWindow: options.contextWindow } }),
  })
  const table = new MemoryTable()
  const service = new SideChatService(ctx, { seedTaskMaxTokens: 500 })
  Object.defineProperty(service, 'table', { value: table, writable: true })
  return { service, table, requests, parentEvents, createSession, childAgent, childRestrict, readSurface, readSession }
}

function taskRequest() {
  return {
    parentSessionId: 'parent',
    question: 'Where is Redis configured?',
    seedMode: 'task',
    modelStrategy: { kind: 'default' },
  } as const
}

describe('Task Seed create Host integration', () => {
  it('uses the latest parent route with no tools, freezes provenance and leaves A unchanged', async () => {
    const harness = makeHarness({ stream: async function* () {
      expect(harness.createSession).not.toHaveBeenCalled()
      yield { type: 'text-delta', index: 0, text: 'Clarify the Redis cache configuration.' }
      yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 8, totalTokens: 38 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } })
    const parentEventCount = harness.parentEvents.length
    await expect(harness.service.create(taskRequest())).resolves.toMatchObject({ ok: true })
    expect(harness.parentEvents).toHaveLength(parentEventCount)
    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0]).toMatchObject({
      provider: 'parent-provider', model: 'parent-model', reasoningEffort: 'low', maxTokens: 500, sessionId: 'parent',
    })
    expect(harness.requests[0]).not.toHaveProperty('tools')
    const record = harness.table.get('child')
    expect(record?.seed).toMatchObject({
      mode: 'task',
      messages: [{ messageId: 'u1', text: 'Redis is used by the cache layer.' }],
      generatedContext: {
        kind: 'task', text: 'Clarify the Redis cache configuration.', sourceMessageIds: ['u1'],
        model: { provider: 'parent-provider', model: 'parent-model', reasoningEffort: 'low' },
        usage: { inputTokens: 30, outputTokens: 8, totalTokens: 38 },
      },
    })
    expect(record?.permission).toMatchObject({
      mode: 'readonly',
      parentAgentPreset: 'standard',
      childAgentPreset: 'sidechat-clarifier',
      parentSandboxMode: 'workspace-write',
      childSandboxMode: 'read-only',
      parentApprovalPolicy: 'ask',
      childApprovalPolicy: 'never',
      allowedTools: ['ask_user_question', 'glob', 'grep', 'pwsh', 'read', 'subagent', 'web_search', 'workflow'],
    })
    expect(harness.childRestrict).toHaveBeenCalledWith({ allow: record?.permission?.allowedTools })
    expect(harness.childAgent.session.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'sandbox/mode', data: { mode: 'read-only' } }),
      expect.objectContaining({ type: 'approval/policy', data: { policy: 'never' } }),
    ]))
    expect(harness.childAgent.followup).toHaveBeenCalledOnce()
    await expect(harness.service.usage({ sessionId: 'child' })).resolves.toMatchObject({
      ok: true,
      value: {
        childSessionId: 'child',
        child: { complete: true, completedTurns: 0, incompleteTurns: 0, totals: { totalTokens: 0 } },
        noReplyModelCalls: 0,
      },
    })
  })

  it('does not create B when the independent model call fails', async () => {
    async function* stream() {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'quota exhausted' } } }
    }
    const harness = makeHarness({ stream })
    await expect(harness.service.create(taskRequest())).resolves.toMatchObject({ ok: false })
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.table.rows.size).toBe(0)
  })

  it('inherits the parent preset, effective sandbox, approval and visible tool ceiling', async () => {
    async function* stream() {
      yield { type: 'text-delta', index: 0, text: 'context' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    const harness = makeHarness({ stream })
    await expect(harness.service.create({ ...taskRequest(), permissionMode: 'inherit' })).resolves.toMatchObject({ ok: true })
    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({ agentPreset: 'standard' }))
    expect(harness.table.get('child')?.permission).toMatchObject({
      mode: 'inherit',
      parentAgentPreset: 'standard',
      childAgentPreset: 'standard',
      parentSandboxMode: 'workspace-write',
      childSandboxMode: 'workspace-write',
      parentApprovalPolicy: 'ask',
      childApprovalPolicy: 'ask',
      allowedTools: ['ask_user_question', 'glob', 'grep', 'pwsh', 'read', 'subagent', 'web_search', 'workflow'],
    })
  })

  it('rejects creation when the parent lifecycle identity changes during generation', async () => {
    async function* stream() {
      yield { type: 'text-delta', index: 0, text: 'context' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    const harness = makeHarness({ stream, parentCreatedAt: [1, 9] })
    await expect(harness.service.create(taskRequest())).resolves.toMatchObject({ ok: false })
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.table.rows.size).toBe(0)
  })
})

describe('trajectory Seed create budget', () => {
  function trajectoryHarness(textLength: number, contextWindow?: number) {
    const marker = '[SideChat fold id=fold-1 rev=1 source=source-child]'
    const parentEvents = [event(1, 'user/message', {
      id: 'fold-message',
      source: { kind: 'plugin' },
      content: [{ type: 'text', text: `${marker}\n${'x'.repeat(textLength)}` }],
    })]
    const harness = makeHarness({ stream: async function* () {}, parentEvents, contextWindow })
    const fold = projectTrajectory('parent', parentEvents)[0]!
    const request = {
      parentSessionId: 'parent',
      question: '继续分析这个 Fold 结论',
      seedMode: 'trajectory',
      modelStrategy: { kind: 'default' },
      trajectorySelection: {
        sourceSessionId: 'parent',
        capturedThroughSeq: 1,
        refs: [{ seq: fold.seq, eventId: fold.eventId, kind: fold.kind, digest: fold.digest }],
      },
    } as const
    return { ...harness, marker, request }
  }

  it('uses 30% of a known target context window before creating B', async () => {
    const harness = trajectoryHarness(124_000, 100_000)
    await expect(harness.service.create(harness.request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'create-failed', message: expect.stringMatching(/30%.*allows 30,000 tokens/u) },
    })
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.table.rows.size).toBe(0)
  })

  it('falls back to 48k and preserves the Fold source marker in the immutable Seed', async () => {
    const harness = trajectoryHarness(180_000)
    await expect(harness.service.create(harness.request)).resolves.toMatchObject({ ok: true })
    expect(harness.createSession).toHaveBeenCalledOnce()
    expect(harness.table.get('child')?.seed.trajectory?.snapshots[0]?.text).toContain(harness.marker)
    expect(harness.childAgent.followup).toHaveBeenCalledWith(expect.objectContaining({
      content: [expect.objectContaining({ text: expect.stringContaining(harness.marker) })],
    }))
  })

  it('uses one complete raw-log observation for trajectory endpoints and creation', async () => {
    const parentEvents: SessionEvent[] = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'request/header', { reason: 'initial', header: { config: { provider: 'p', model: 'm' } } }),
      event(4, 'assistant/message', { turn: 1, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a.ts"}' }] } }),
      event(5, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{"path":"a.ts"}' }),
      event(6, 'tool/result', { turn: 1, step: 1, message: { id: 'result-1', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] }] } }),
      event(7, 'step/end', { turn: 1, step: 1 }),
      event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const harness = makeHarness({
      stream: async function* () {},
      parentEvents,
      // This is the shape old code received from readSurface: execution
      // lifecycle and log-only call events are intentionally absent.
      surfaceEvents: [parentEvents[3]!],
    })
    const itemsResult = await harness.service.trajectoryItems({ sessionId: 'parent' })
    const overviewResult = await harness.service.trajectoryOverview({ sessionId: 'parent' })
    expect(itemsResult).toMatchObject({ ok: true, value: { capturedThroughSeq: 8 } })
    expect(overviewResult).toMatchObject({ ok: true, value: { turns: 1, calls: 1 } })
    const items = itemsResult.ok ? (itemsResult.value as { items: ReturnType<typeof projectTrajectory> }).items : []
    const call = items.find(item => item.kind === 'tool-call')!
    const detailResult = await harness.service.trajectoryDetail({
      sessionId: 'parent',
      ref: { seq: call.seq, eventId: call.eventId, kind: call.kind, digest: call.digest },
    })
    expect(detailResult).toMatchObject({ ok: true, value: { text: '{"path":"a.ts"}' } })

    const createResult = await harness.service.create({
      parentSessionId: 'parent',
      question: 'Explain this read result',
      seedMode: 'trajectory',
      modelStrategy: { kind: 'default' },
      trajectorySelection: {
        sourceSessionId: 'parent',
        capturedThroughSeq: 8,
        refs: [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: call.digest }],
      },
    })
    expect(createResult).toMatchObject({ ok: true })
    expect(harness.table.get('child')?.seed.trajectory?.snapshots).toEqual([
      expect.objectContaining({ eventId: 'call-1', kind: 'tool-call', text: '{"path":"a.ts"}' }),
    ])
    expect(harness.readSurface).not.toHaveBeenCalled()
    expect(harness.readSession).toHaveBeenCalledTimes(4)
  })
})
