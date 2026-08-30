import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SideChatService } from '../src/service.ts'
import type { SideChatRecord } from '../src/types.ts'

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
}

function makeHarness(options: HarnessOptions) {
  const parentEvents = [
    event(1, 'user/message', {
      id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Redis is used by the cache layer.' }],
    }),
    event(2, 'request/header', {
      header: { config: { provider: 'parent-provider', model: 'parent-model', reasoningEffort: 'low' } },
    }),
  ]
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
  const ctx = new Context()
  ctx.provide('sessionController', sessionController)
  ctx.provide('sessionQuery', {
    readSurface: vi.fn(async () => ({ events: parentEvents, capturedThroughSeq: 2 })),
  })
  ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => []) })
  ctx.provide('agentPresets', {
    composedPreset: vi.fn((agentContext: unknown) => agentContext === parentAgent.ctx ? 'standard' : childPreset),
  })
  ctx.provide('sandboxPolicy', { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: 'C:\\work' })) })
  ctx.provide('approval', { overrideOf: vi.fn(() => 'ask'), config: { policy: 'ask' } })
  ctx.provide('llm', {
    stream: vi.fn((request: unknown) => { requests.push(request); return options.stream(request) }),
  })
  const table = new MemoryTable()
  const service = new SideChatService(ctx, { seedTaskMaxTokens: 500 })
  Object.defineProperty(service, 'table', { value: table, writable: true })
  return { service, table, requests, parentEvents, createSession, childAgent, childRestrict }
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
