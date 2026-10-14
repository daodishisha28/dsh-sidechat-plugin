import { Context, Service } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { computePermissionScope, PTC_TRANSPORT_RUN_CODE } from '../src/tool-contract.ts'
import { SIDECHAT_PERSONA_PREFIX, SIDECHAT_PERSONA_PREFIX_SECTION } from '../src/persona.ts'
import { SideChatService } from '../src/service.ts'
import type { SideChatRecord } from '../src/types.ts'

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

function v2Record(permission: SideChatRecord['permission']): SideChatRecord {
  return {
    schema: 2, logFormat: 4, projectionVersion: PROJECTION_VERSION,
    childSessionId: 'child', parentSessionId: 'parent',
    parent: { createdAt: 1, cwd: 'C:\\work' }, child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q', title: 't', status: 'open',
    seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 2, coordinates: { epoch: 'v4-offset', logFormat: 4 }, messages: [] },
    permission,
    modelStrategy: { kind: 'default' }, createdAt: 2, updatedAt: 3, revision: 0, folds: [], cites: [],
  }
}

interface CreateHarnessOptions {
  readonly parentToolNames: readonly string[]
  readonly childToolNames: readonly string[]
  readonly restrict?: () => void
}

/**
 * Mock of the upstream `agent/pre-step` waterfall on one agent-scoped context
 * (packages/core/agent/src/runtime-types.ts:310-320): listeners registered via
 * `ctx.on('agent/pre-step', ...)` are collected; `proposeStep()` runs them in
 * order, where a listener that returns without calling `next()` owns the
 * decision. A step admitted past the waterfall models the loop reaching the
 * provider: `providerInvocations` counts those —the persistent admission
 * gate must keep it at ZERO for blocked children.
 */
function makePreStepWaterfall() {
  const listeners: Array<(payload: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
  const providerInvocations = { count: 0 }
  const on = vi.fn((name: string, listener: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>) => {
    if (name === 'agent/pre-step') listeners.push(listener)
    return () => {
      const at = listeners.indexOf(listener)
      if (at >= 0) listeners.splice(at, 1)
    }
  })
  const proposeStep = async (): Promise<{ kind: string; messages?: unknown[] }> => {
    const next = async (): Promise<{ kind: string; messages: unknown[] }> => ({ kind: 'enter', messages: [] })
    let decision: { kind: string; messages?: unknown[] } | undefined
    for (const listener of listeners) decision = await listener({ messages: [] }, next) as { kind: string; messages?: unknown[] }
    const final = decision ?? { kind: 'enter', messages: [] }
    if (final.kind === 'enter') providerInvocations.count += 1
    return final
  }
  return { on, proposeStep, listeners, providerInvocations }
}

function makeCreateHarness(options: CreateHarnessOptions) {
  const table = new MemoryTable()
  const parentEvents: SessionEvent[] = [
    event(1, 'user/message', { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'base question' }] }),
  ]
  const childEvents: SessionEvent[] = []
  const childRestrict = vi.fn(options.restrict ?? (() => vi.fn()))
  const childGuard = vi.fn(() => vi.fn())
  const childPreStep = makePreStepWaterfall()
  const childAgent = {
    id: 'child',
    options: { provider: 'child-provider', model: 'child-model' },
    session: {
      id: 'child', header: header('child', 2), seq: childEvents.length, inheritedEventCount: 0,
      events: childEvents,
      append: (type: string, data: unknown) => { childEvents.push(event(childEvents.length + 1, type, data)) },
    },
    ctx: {
      tools: {
        schemas: vi.fn(() => options.childToolNames.map(name => ({ name }))),
        restrict: childRestrict,
        guard: childGuard,
      },
      systemPrompt: { section: vi.fn(() => vi.fn()), getSectionOrder: vi.fn(() => 10200) },
      on: childPreStep.on,
    },
    followup: vi.fn(),
  }
  const parentAgent = {
    id: 'parent',
    options: { provider: 'parent-provider', model: 'parent-model' },
    session: {
      id: 'parent', header: header('parent', 1), seq: parentEvents.length, inheritedEventCount: 0,
      events: parentEvents,
      append: (type: string, data: unknown) => { parentEvents.push(event(parentEvents.length + 1, type, data)) },
    },
    ctx: { tools: { schemas: vi.fn(() => options.parentToolNames.map(name => ({ name }))) } },
  }
  const ctx = new Context()
  ctx.provide('sessionController', {
    inspect: vi.fn(async (sessionId: string) => sessionId === 'parent'
      ? { meta: header('parent', 1), events: parentEvents, inheritedEventCount: 0 }
      : { meta: header('child', 2), events: childEvents, inheritedEventCount: 0 }),
    resolveAgent: vi.fn(async (sessionId: string) => sessionId === 'parent'
      ? { agent: parentAgent }
      : sessionId === 'child' ? { agent: childAgent } : { error: { message: 'not loaded' } }),
    create: vi.fn(async () => ({ sessionId: 'child', agentPreset: 'sidechat-clarifier' })),
    rename: vi.fn(async () => ({ title: 't', seq: 1 })),
    selectModel: vi.fn(async () => ({ selected: { provider: 'child-provider', model: 'child-model' } })),
  })
  ctx.provide('sessionQuery', {
    readSurface: vi.fn(async () => ({ events: parentEvents, capturedThroughSeq: parentEvents.length })),
    readSession: vi.fn(async (sessionId: string) => ({
      session: sessionId === 'parent' ? header('parent', 1) : header('child', 2),
      inheritedEventCount: 0,
      events: sessionId === 'parent' ? parentEvents : childEvents,
    })),
  })
  ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => []) })
  ctx.provide('agentPresets', {
    composedPreset: vi.fn((agentContext: unknown) => agentContext === parentAgent.ctx ? 'standard' : 'sidechat-clarifier'),
    serviceFor: vi.fn(() => undefined),
  })
  ctx.provide('sandboxPolicy', { resolve: vi.fn(() => ({ mode: 'workspace-write' })) })
  ctx.provide('approval', { overrideOf: vi.fn(() => 'ask'), config: { policy: 'ask' } })
  ctx.provide('agentDefaultModel', { currentSelection: vi.fn(() => ({ provider: 'child-provider', model: 'child-model' })) })
  ctx.provide('llm', { stream: vi.fn(), resolveModelInfo: vi.fn(async () => ({})) })
  ctx.provide('sessions', { flush: vi.fn(async () => true) })
  ctx.provide('tokenMeter', { measure: vi.fn(() => ({ totalTokens: 0 })), estimateMessage: vi.fn(() => 0) })
  const service = new SideChatService(ctx)
  Object.defineProperty(service, 'table', { value: table, writable: true })
  return { service, table, childAgent, childRestrict, childGuard, childPreStep, createSession: ctx.sessionController.create as ReturnType<typeof vi.fn> }
}

function noneSeedRequest(overrides: Record<string, unknown> = {}) {
  return {
    parentSessionId: 'parent',
    question: 'Why does the build fail?',
    seedMode: 'none',
    modelStrategy: { kind: 'default' },
    ...overrides,
  }
}

describe('SideChat permission enforcement (alpha.2 tools surface)', () => {
  it('takes the terminal parent ceiling from tools.schemas minus the PTC run_code transport', async () => {
    const harness = makeCreateHarness({
      parentToolNames: ['read', 'glob', 'pwsh', 'run_code'],
      childToolNames: ['read', 'glob', 'pwsh', 'run_code', 'write'],
    })
    const result = await harness.service.create(noneSeedRequest({ permissionMode: 'inherit' }))
    expect(result).toMatchObject({ ok: true })
    const permission = harness.table.rows.get('child')?.permission
    expect(permission?.parentTools).toEqual(['glob', 'pwsh', 'read'])
    expect(permission?.parentTools).not.toContain('run_code')
    // The child preset's extra capability outside the parent ceiling is excluded.
    expect(permission?.allowedTools).toEqual(['glob', 'pwsh', 'read'])
    expect(harness.childRestrict).toHaveBeenCalledWith({ allow: ['glob', 'pwsh', 'read'] })
  })

  it('blocks the first question when the restriction cannot be installed, keeping a deny guard', async () => {
    const harness = makeCreateHarness({
      parentToolNames: ['read', 'glob'],
      childToolNames: ['read', 'glob'],
      restrict: () => { throw new Error('restrict rejected a scope-local name') },
    })
    const result = await harness.service.create(noneSeedRequest())
    expect(result).toMatchObject({ ok: false, error: { code: 'create-failed' } })
    expect(harness.childAgent.followup).not.toHaveBeenCalled()
    expect(harness.childGuard).toHaveBeenCalled()
  })

  it('installs sandbox read-only and approval never alongside the readonly restriction', async () => {
    const harness = makeCreateHarness({
      parentToolNames: ['read', 'glob', 'write'],
      childToolNames: ['read', 'glob', 'write'],
    })
    const result = await harness.service.create(noneSeedRequest())
    expect(result).toMatchObject({ ok: true })
    const modes = harness.childAgent.session.events.filter(item => item.type === 'sandbox/mode')
    const approvals = harness.childAgent.session.events.filter(item => item.type === 'approval/policy')
    expect(modes.at(-1)?.data).toEqual({ mode: 'read-only' })
    expect(approvals.at(-1)?.data).toEqual({ policy: 'never' })
  })
})

function makeResumeHarness(options: {
  readonly childToolNames: readonly string[]
  readonly persistedPermission: SideChatRecord['permission']
  /** Fail the child's restrict() install (cold-resume blocked path). */
  readonly restrict?: () => () => void
}) {
  const table = new MemoryTable()
  table.rows.set('child', v2Record(options.persistedPermission))
  const childRestrict = vi.fn(options.restrict ?? (() => vi.fn()))
  const childGuard = vi.fn(() => vi.fn())
  const childCancel = vi.fn()
  const childPreStep = makePreStepWaterfall()
  const childAgent = {
    id: 'child',
    options: {},
    session: { id: 'child', header: header('child', 2), seq: 0, inheritedEventCount: 0 },
    ctx: {
      tools: {
        schemas: vi.fn(() => options.childToolNames.map(name => ({ name }))),
        restrict: childRestrict,
        guard: childGuard,
      },
      systemPrompt: { section: vi.fn(() => vi.fn()), getSectionOrder: vi.fn(() => 10200) },
      on: childPreStep.on,
    },
    cancel: childCancel,
  }
  const listeners = new Map<string, (payload: unknown) => void>()
  const ctx = new Context()
  ctx.provide('storageDomain', { open: vi.fn(async () => ({ table: vi.fn(() => table), close: vi.fn(async () => undefined) })) })
  ctx.provide('sessionController', { inspect: vi.fn(), resolveAgent: vi.fn() })
  ctx.provide('sessionQuery', { readSession: vi.fn() })
  ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => []) })
  ctx.provide('agentPresets', { composedPreset: vi.fn(() => undefined), serviceFor: vi.fn(() => undefined) })
  ctx.provide('sandboxPolicy', { resolve: vi.fn() })
  ctx.provide('approval', { overrideOf: vi.fn(), config: {} })
  ctx.provide('llm', { stream: vi.fn(), resolveModelInfo: vi.fn() })
  ctx.provide('sessions', { flush: vi.fn() })
  ctx.provide('tokenMeter', { measure: vi.fn(), estimateMessage: vi.fn() })
  ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  ctx.provide('effect', vi.fn())
  ctx.provide('on', vi.fn((name: string, listener: (payload: unknown) => void) => {
    listeners.set(name, listener)
    return () => undefined
  }))
  ctx.provide('connection', { rpc: { handle: vi.fn(() => () => undefined) } })
  const service = new SideChatService(ctx)
  Object.defineProperty(service, 'table', { value: table, writable: true })
  const init = async (): Promise<void> => {
    await (service as unknown as { [Service.init]: () => Promise<void> })[Service.init]()
  }
  return { init, listeners, childAgent, childRestrict, childGuard, childCancel, childPreStep, table, service, systemPrompt: childAgent.ctx.systemPrompt }
}

describe('cold resume and repeated resume permission restoration', () => {
  it('restores the persisted snapshot on cold resume without adopting a larger tool set', async () => {
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob', 'write', 'subagent'],
      persistedPermission: {
        mode: 'readonly',
        parentSandboxMode: 'workspace-write',
        childSandboxMode: 'read-only',
        parentApprovalPolicy: 'ask',
        childApprovalPolicy: 'never',
        parentTools: ['read', 'glob'],
        allowedTools: ['read', 'glob'],
        capturedAt: 5,
      },
    })
    await harness.init()
    // Resume delivers the restored agent through the agent/created event.
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    expect(harness.childRestrict).toHaveBeenCalledWith({ allow: ['glob', 'read'] })
    // The scoped guard rejects everything beyond the persisted snapshot.
    expect(harness.childGuard).toHaveBeenCalled()
    const guard = harness.childGuard.mock.calls[0]?.[0] as (execution: { name: string }) => string | undefined
    expect(guard({ name: 'read' })).toBeUndefined()
    expect(guard({ name: 'write' })).toContain('permission snapshot')
    expect(guard({ name: 'subagent' })).toContain('permission snapshot')
  })

  it('repeated resume does not stack duplicate guards or restrictions', async () => {
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob'],
      persistedPermission: {
        mode: 'inherit',
        parentSandboxMode: 'workspace-write',
        childSandboxMode: 'workspace-write',
        parentApprovalPolicy: 'ask',
        childApprovalPolicy: 'ask',
        parentTools: ['read', 'glob'],
        allowedTools: ['read', 'glob'],
        capturedAt: 5,
      },
    })
    await harness.init()
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    expect(harness.childGuard).toHaveBeenCalledOnce()
    expect(harness.childRestrict).toHaveBeenCalledOnce()
  })

  it('keeps an empty parent ceiling tool-less: guard denies all, restrict stays untouched', async () => {
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob'],
      persistedPermission: {
        mode: 'readonly',
        parentSandboxMode: 'workspace-write',
        childSandboxMode: 'read-only',
        parentApprovalPolicy: 'ask',
        childApprovalPolicy: 'never',
        parentTools: [],
        allowedTools: [],
        capturedAt: 5,
      },
    })
    await harness.init()
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    expect(harness.childRestrict).not.toHaveBeenCalled()
    expect(harness.childGuard).toHaveBeenCalledOnce()
    const guard = harness.childGuard.mock.calls[0]?.[0] as (execution: { name: string }) => string | undefined
    expect(guard({ name: 'read' })).toContain('permission snapshot')
  })

  it('reports a restored legacy run_code snapshot without re-adding the transport', async () => {
    const harness = makeResumeHarness({
      childToolNames: ['read', 'run_code'],
      persistedPermission: {
        mode: 'inherit',
        parentSandboxMode: 'workspace-write',
        childSandboxMode: 'workspace-write',
        parentApprovalPolicy: 'ask',
        childApprovalPolicy: 'ask',
        parentTools: ['read', 'run_code'],
        allowedTools: ['read'],
        capturedAt: 5,
      },
    })
    await harness.init()
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    expect(harness.childRestrict).toHaveBeenCalledWith({ allow: ['read'] })
    expect(harness.childRestrict.mock.calls[0]?.[0]?.allow).not.toContain('run_code')
  })
})

function makeDirectHarness(options: {
  readonly restrict?: () => () => void
  readonly guard?: () => () => void
}) {
  const table = new MemoryTable()
  table.rows.set('child', v2Record({
    mode: 'inherit',
    parentSandboxMode: 'workspace-write',
    childSandboxMode: 'workspace-write',
    parentApprovalPolicy: 'ask',
    childApprovalPolicy: 'ask',
    parentTools: ['read', 'glob'],
    allowedTools: ['read', 'glob'],
    capturedAt: 5,
  }))
  const childRestrict = vi.fn(options.restrict ?? (() => vi.fn()))
  const childGuard = vi.fn(options.guard ?? (() => vi.fn()))
  const childCancel = vi.fn()
  const childPreStep = makePreStepWaterfall()
  const childAgent = {
    id: 'child',
    options: {},
    session: { id: 'child', header: header('child', 2), seq: 0, inheritedEventCount: 0 },
    ctx: {
      tools: {
        schemas: vi.fn(() => ['read', 'glob'].map(name => ({ name }))),
        restrict: childRestrict,
        guard: childGuard,
      },
      systemPrompt: { section: vi.fn(() => vi.fn()), getSectionOrder: vi.fn(() => 10200) },
      on: childPreStep.on,
    },
    cancel: childCancel,
  }
  const ctx = new Context()
  ctx.provide('storageDomain', { open: vi.fn(async () => ({ table: vi.fn(() => table), close: vi.fn(async () => undefined) })) })
  ctx.provide('sessionController', { inspect: vi.fn(), resolveAgent: vi.fn() })
  ctx.provide('sessionQuery', { readSession: vi.fn() })
  ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => []) })
  ctx.provide('agentPresets', { composedPreset: vi.fn(() => undefined), serviceFor: vi.fn(() => undefined) })
  ctx.provide('sandboxPolicy', { resolve: vi.fn() })
  ctx.provide('approval', { overrideOf: vi.fn(), config: {} })
  ctx.provide('llm', { stream: vi.fn(), resolveModelInfo: vi.fn() })
  ctx.provide('sessions', { flush: vi.fn() })
  ctx.provide('tokenMeter', { measure: vi.fn(), estimateMessage: vi.fn() })
  ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  ctx.provide('effect', vi.fn())
  ctx.provide('on', vi.fn())
  ctx.provide('connection', { rpc: { handle: vi.fn(() => () => undefined) } })
  const service = new SideChatService(ctx)
  Object.defineProperty(service, 'table', { value: table, writable: true })
  const ensurePermission = (agent: unknown): boolean =>
    (service as unknown as { ensurePermission: (agent: unknown) => boolean }).ensurePermission(agent)
  return { ensurePermission, childAgent, childRestrict, childGuard, childCancel, childPreStep, table }
}
describe('permission install semantics (success vs blocked state)', () => {

  const inheritedSnapshot = {
    mode: 'inherit' as const,
    parentSandboxMode: 'workspace-write' as const,
    childSandboxMode: 'workspace-write' as const,
    parentApprovalPolicy: 'ask' as const,
    childApprovalPolicy: 'ask' as const,
    parentTools: ['read', 'glob'],
    allowedTools: ['read', 'glob'],
    capturedAt: 5,
  }

  it('returns true for an already-successful install without reinstalling', () => {
    const harness = makeDirectHarness({})
    expect(harness.ensurePermission(harness.childAgent)).toBe(true)
    const guardCalls = harness.childGuard.mock.calls.length
    const restrictCalls = harness.childRestrict.mock.calls.length
    expect(harness.ensurePermission(harness.childAgent)).toBe(true)
    expect(harness.childGuard).toHaveBeenCalledTimes(guardCalls)
    expect(harness.childRestrict).toHaveBeenCalledTimes(restrictCalls)
  })

  it('records a blocked state with a deny-all guard when restrict throws, and a retry may recover', () => {
    let allow = false
    const harness = makeDirectHarness({
      restrict: () => {
        if (!allow) throw new Error('restrict rejected a scope-local name')
        return vi.fn()
      },
    })
    expect(harness.ensurePermission(harness.childAgent)).toBe(false)
    // Blocking deny-all guard: the last guard registration denies everything.
    const blockingGuard = harness.childGuard.mock.calls.at(-1)?.[0] as (execution: { name: string }) => string | undefined
    expect(blockingGuard({ name: 'read' })).toContain('blocked')
    expect(blockingGuard({ name: 'glob' })).toContain('blocked')
    // Retry lifts the block and installs the snapshot.
    allow = true
    expect(harness.ensurePermission(harness.childAgent)).toBe(true)
    const snapshotGuard = harness.childGuard.mock.calls.at(-1)?.[0] as (execution: { name: string }) => string | undefined
    expect(snapshotGuard({ name: 'read' })).toBeUndefined()
    expect(snapshotGuard({ name: 'write' })).toContain('permission snapshot')
    // The retried install also carries the PTC transport allowance.
    expect(snapshotGuard({ name: PTC_TRANSPORT_RUN_CODE })).toBeUndefined()
  })

  it('records the blocked state even when the blocking guard itself throws', () => {
    const harness = makeDirectHarness({
      restrict: () => { throw new Error('restrict rejected a scope-local name') },
      guard: () => { throw new Error('guard registration exploded') },
    })
    expect(() => harness.ensurePermission(harness.childAgent)).not.toThrow()
    expect(harness.ensurePermission(harness.childAgent)).toBe(false)
  })

  it('cancels a blocked child through the agent/created handler and the cold sweep, but not ordinary agents', async () => {
    const table = new MemoryTable()
    table.rows.set('child', v2Record(inheritedSnapshot))
    const childRestrict = vi.fn(() => { throw new Error('tools.restrict() requires a scoped context') })
    const childGuard = vi.fn(() => vi.fn())
    const childCancel = vi.fn()
    const childPreStep = makePreStepWaterfall()
    const childAgent = {
      id: 'child', options: {}, cancel: childCancel,
      session: { id: 'child', header: header('child', 2), seq: 0, inheritedEventCount: 0 },
      ctx: {
        tools: { schemas: vi.fn(() => ['read'].map(name => ({ name }))), restrict: childRestrict, guard: childGuard },
        systemPrompt: { section: vi.fn(() => vi.fn()), getSectionOrder: vi.fn(() => 10200) },
        on: childPreStep.on,
      },
    }
    const ordinaryCancel = vi.fn()
    const ordinaryAgent = {
      id: 'ordinary', options: {}, cancel: ordinaryCancel,
      session: { id: 'ordinary', header: header('ordinary', 3), seq: 0, inheritedEventCount: 0 },
      ctx: { tools: { schemas: vi.fn(() => []), restrict: vi.fn(), guard: vi.fn() }, systemPrompt: { section: vi.fn(), getSectionOrder: vi.fn(() => 0) } },
    }
    const listeners = new Map<string, (payload: unknown) => void>()
    const ctx = new Context()
    ctx.provide('storageDomain', { open: vi.fn(async () => ({ table: vi.fn(() => table), close: vi.fn(async () => undefined) })) })
    ctx.provide('sessionController', { inspect: vi.fn(), resolveAgent: vi.fn() })
    ctx.provide('sessionQuery', { readSession: vi.fn() })
    ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => [childAgent, ordinaryAgent]) })
    ctx.provide('agentPresets', { composedPreset: vi.fn(() => undefined), serviceFor: vi.fn(() => undefined) })
    ctx.provide('sandboxPolicy', { resolve: vi.fn() })
    ctx.provide('approval', { overrideOf: vi.fn(), config: {} })
    ctx.provide('llm', { stream: vi.fn(), resolveModelInfo: vi.fn() })
    ctx.provide('sessions', { flush: vi.fn() })
    ctx.provide('tokenMeter', { measure: vi.fn(), estimateMessage: vi.fn() })
    ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    ctx.provide('effect', vi.fn())
    ctx.provide('on', vi.fn((name: string, listener: (payload: unknown) => void) => { listeners.set(name, listener) }))
    ctx.provide('connection', { rpc: { handle: vi.fn(() => () => undefined) } })
    const service = new SideChatService(ctx)
    Object.defineProperty(service, 'table', { value: table, writable: true })
    await (service as unknown as { [Service.init]: () => Promise<void> })[Service.init]()
    // Cold sweep blocks the persisted child whose enforcement failed.
    expect(childCancel).toHaveBeenCalledWith({ kind: 'hook', reason: expect.stringContaining('SideChat permission enforcement failed') })
    // An ordinary agent without a SideChat record is never blocked.
    expect(ordinaryCancel).not.toHaveBeenCalled()
    expect(ordinaryAgent.ctx.tools.guard).not.toHaveBeenCalled()
    // Resume through the serial agent/created event blocks again.
    childCancel.mockClear()
    listeners.get('agent/created')?.({ agent: childAgent })
    expect(childCancel).toHaveBeenCalledOnce()
  })
})

describe('persistent admission gate (agent/pre-step waterfall)', () => {
  const snapshot = {
    mode: 'readonly' as const,
    parentSandboxMode: 'workspace-write' as const,
    childSandboxMode: 'read-only' as const,
    parentApprovalPolicy: 'ask' as const,
    childApprovalPolicy: 'never' as const,
    parentTools: ['read', 'glob'],
    allowedTools: ['read', 'glob'],
    capturedAt: 5,
  }

  it('uses a service-scoped model gate when agent listener and tool guard registration fail', async () => {
    const harness = makeResumeHarness({ childToolNames: ['read'], persistedPermission: snapshot })
    await harness.init()
    harness.childAgent.ctx.on.mockImplementation(() => { throw new Error('agent scope listener unavailable') })
    harness.childGuard.mockImplementation(() => { throw new Error('tool guard unavailable') })
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    const gate = harness.listeners.get('agent/pre-step') as unknown as (payload: { agent: unknown }, next: () => Promise<{ kind: string }>) => Promise<{ kind: string }>
    expect(gate).toBeTypeOf('function')
    const provider = vi.fn(async () => ({ kind: 'enter' }))
    for (let i = 0; i < 3; i += 1) expect(await gate({ agent: harness.childAgent }, provider)).toEqual({ kind: 'reject' })
    expect(provider).not.toHaveBeenCalled()
    const ordinary = { id: 'ordinary' }
    expect(await gate({ agent: ordinary }, provider)).toEqual({ kind: 'enter' })
    expect(provider).toHaveBeenCalledOnce()
    // A new lifecycle with the same id is not poisoned by a stale gate.
    expect(await gate({ agent: { ...harness.childAgent } }, provider)).toEqual({ kind: 'enter' })
  })

  it('rejects fresh work enqueued AFTER a failed cold-resume install: provider invocations stay zero', async () => {
    // EXACT resume-then-fresh-enqueue sequence: the persisted child's install
    // fails during the cold sweep, the handler completes, and only then does
    // a normal controller/UI submit enqueue fresh model work. Upstream
    // Agent.cancel with no active activity is a no-op and does not arm later
    // work (runtime-types.ts:176-183), so the pre-step waterfall is what
    // rejects the fresh step —the provider/stream counter must stay ZERO.
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob'],
      restrict: () => { throw new Error('restrict rejected a scope-local name') },
      persistedPermission: snapshot,
    })
    await harness.init()
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    expect(harness.childCancel).toHaveBeenCalledWith({ kind: 'hook', reason: expect.stringContaining('SideChat permission enforcement failed') })
    expect(harness.childPreStep.listeners.length).toBe(1)
    // AFTER the handler completes: fresh user input (followup/queue wake)
    // proposes a step —the gate rejects it, so no model call is prepared.
    const decision = await harness.childPreStep.proposeStep()
    expect(decision).toEqual({ kind: 'reject' })
    expect(harness.childPreStep.providerInvocations.count).toBe(0)
    // Repeated fresh submissions never reach the provider either.
    await harness.childPreStep.proposeStep()
    await harness.childPreStep.proposeStep()
    expect(harness.childPreStep.providerInvocations.count).toBe(0)
  })

  it('legacy child without a permission snapshot: gate rejects with an actionable error, record bytes untouched, recovery flips admission', async () => {
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob'],
      persistedPermission: undefined,
    })
    const before = structuredClone(harness.table.rows.get('child'))
    await harness.init()
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    // The gate is registered for the legacy child (no blocked install needed).
    expect(harness.childPreStep.listeners.length).toBe(1)
    expect(await harness.childPreStep.proposeStep()).toEqual({ kind: 'reject' })
    expect(harness.childPreStep.providerInvocations.count).toBe(0)
    // The plugin-side assert surfaces the actionable admission error too.
    expect(() => (harness.service as unknown as { assertPermissionNotBlocked: (id: string) => void }).assertPermissionNotBlocked('child'))
      .toThrow(/permission snapshot unavailable.*legacy data.*preserved untouched/su)
    // Legacy data is left intact (unchanged bytes) —never auto-migrated.
    expect(harness.table.rows.get('child')).toEqual(before)
    // Recovery: writing a proper snapshot and a successful ensurePermission
    // retry lifts the gate; the next proposed step is admitted (decision
    // flips). No provider invocation is needed for the admission flip itself.
    harness.table.rows.set('child', v2Record(snapshot))
    const installed = (harness.service as unknown as { ensurePermission: (agent: unknown) => boolean }).ensurePermission(harness.childAgent)
    expect(installed).toBe(true)
    expect(harness.childPreStep.listeners.length).toBe(0)
    expect(await harness.childPreStep.proposeStep()).toMatchObject({ kind: 'enter' })
    expect(harness.childPreStep.providerInvocations.count).toBe(1)
  })

  it('ordinary session without a SideChat record: no gate is registered and steps are admitted', async () => {
    const table = new MemoryTable()
    const childPreStep = makePreStepWaterfall()
    const ordinaryAgent = {
      id: 'ordinary', options: {}, cancel: vi.fn(),
      session: { id: 'ordinary', header: header('ordinary', 3), seq: 0, inheritedEventCount: 0 },
      ctx: {
        tools: { schemas: vi.fn(() => ['read'].map(name => ({ name }))), restrict: vi.fn(() => vi.fn()), guard: vi.fn(() => vi.fn()) },
        systemPrompt: { section: vi.fn(() => vi.fn()), getSectionOrder: vi.fn(() => 10200) },
        on: childPreStep.on,
      },
    }
    const listeners = new Map<string, (payload: unknown) => void>()
    const ctx = new Context()
    ctx.provide('storageDomain', { open: vi.fn(async () => ({ table: vi.fn(() => table), close: vi.fn(async () => undefined) })) })
    ctx.provide('sessionController', { inspect: vi.fn(), resolveAgent: vi.fn() })
    ctx.provide('sessionQuery', { readSession: vi.fn() })
    ctx.provide('agents', { get: vi.fn(() => undefined), list: vi.fn(() => [ordinaryAgent]) })
    ctx.provide('agentPresets', { composedPreset: vi.fn(() => undefined), serviceFor: vi.fn(() => undefined) })
    ctx.provide('sandboxPolicy', { resolve: vi.fn() })
    ctx.provide('approval', { overrideOf: vi.fn(), config: {} })
    ctx.provide('llm', { stream: vi.fn(), resolveModelInfo: vi.fn() })
    ctx.provide('sessions', { flush: vi.fn() })
    ctx.provide('tokenMeter', { measure: vi.fn(), estimateMessage: vi.fn() })
    ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    ctx.provide('effect', vi.fn())
    ctx.provide('on', vi.fn((name: string, listener: (payload: unknown) => void) => { listeners.set(name, listener) }))
    ctx.provide('connection', { rpc: { handle: vi.fn(() => () => undefined) } })
    const service = new SideChatService(ctx)
    Object.defineProperty(service, 'table', { value: table, writable: true })
    await (service as unknown as { [Service.init]: () => Promise<void> })[Service.init]()
    // Cold sweep touches the ordinary agent: no gate, no logs, no cancel.
    expect(childPreStep.on).not.toHaveBeenCalled()
    expect(childPreStep.listeners.length).toBe(0)
    expect(ordinaryAgent.cancel).not.toHaveBeenCalled()
    expect(await childPreStep.proposeStep()).toMatchObject({ kind: 'enter' })
    // The agent/created path behaves identically.
    listeners.get('agent/created')?.({ agent: ordinaryAgent })
    expect(childPreStep.listeners.length).toBe(0)
    expect(ordinaryAgent.cancel).not.toHaveBeenCalled()
  })

  it('blocked child whose install later succeeds on retry: gate lifted and steps admitted', async () => {
    let allow = false
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob'],
      restrict: () => {
        if (!allow) throw new Error('restrict rejected a scope-local name')
        return vi.fn()
      },
      persistedPermission: snapshot,
    })
    await harness.init()
    // The failed cold-resume install arms the persistent gate.
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    expect(harness.childPreStep.listeners.length).toBe(1)
    expect(await harness.childPreStep.proposeStep()).toEqual({ kind: 'reject' })
    expect(harness.childPreStep.providerInvocations.count).toBe(0)
    // Retry succeeds: the gate is lifted together with the blocking guard.
    allow = true
    const installed = (harness.service as unknown as { ensurePermission: (agent: unknown) => boolean }).ensurePermission(harness.childAgent)
    expect(installed).toBe(true)
    expect(harness.childPreStep.listeners.length).toBe(0)
    expect(await harness.childPreStep.proposeStep()).toMatchObject({ kind: 'enter' })
    expect(harness.childPreStep.providerInvocations.count).toBe(1)
  })

  it('absorbs ONLY the proven unknown-global restrict shape: an arbitrary per-name probe error fails the install into the blocked state', () => {
    // Batch attempt hits the proven unknown-global shape (absorbable), then
    // the per-name probe for 'glob' throws an arbitrary error —that error
    // must propagate and fail the install (blocked), never be silently
    // treated as a rejected scope-local name.
    const harness = makeDirectHarness({
      restrict: (filter?: { readonly allow?: readonly string[] }) => {
        const allow = filter?.allow ?? []
        if (allow.length > 1) {
          throw new Error('tools.restrict() names unknown global tools "read", "glob"; known global tools: (none)')
        }
        if (allow[0] === 'glob') throw new Error('kaboom')
        return vi.fn()
      },
    })
    expect(harness.ensurePermission(harness.childAgent)).toBe(false)
    const blockingGuard = harness.childGuard.mock.calls.at(-1)?.[0] as (execution: { name: string }) => string | undefined
    expect(blockingGuard({ name: 'read' })).toContain('blocked')
    expect(blockingGuard({ name: 'glob' })).toContain('blocked')
  })

  it('absorbs the proven per-name unknown-global shape and keeps the accepted subset', async () => {
    // A snapshot naming a capability upstream no longer knows: the batch
    // attempt fails with the proven unknown-global shape, then the per-name
    // probe rejects exactly 'gone_tool' (the proven shape naming that one
    // tool) while 'read' installs as the accepted restriction.
    const harness = makeDirectHarness({
      restrict: (filter?: { readonly allow?: readonly string[] }) => {
        const allow = filter?.allow ?? []
        const unknown = allow.filter(name => name === 'gone_tool')
        if (unknown.length > 0) {
          throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? 's' : ''} ${unknown.map(n => `"${n}"`).join(', ')}; known global tools: read`)
        }
        return vi.fn()
      },
    })
    harness.table.rows.set('child', v2Record({
      mode: 'inherit',
      parentSandboxMode: 'workspace-write',
      childSandboxMode: 'workspace-write',
      parentApprovalPolicy: 'ask',
      childApprovalPolicy: 'ask',
      parentTools: ['read', 'gone_tool'],
      allowedTools: ['read', 'gone_tool'],
      capturedAt: 5,
    }))
    ;(harness.childAgent.ctx.tools.schemas as ReturnType<typeof vi.fn>).mockReturnValue(['read', 'gone_tool'].map(name => ({ name })))
    expect(harness.ensurePermission(harness.childAgent)).toBe(true)
    const restrictCalls = harness.childRestrict.mock.calls.map(call => call[0] as { allow?: readonly string[] })
    expect(restrictCalls[0]?.allow).toEqual(['gone_tool', 'read'])
    expect(restrictCalls[1]?.allow).toEqual(['gone_tool'])
    expect(restrictCalls[2]?.allow).toEqual(['read'])
    expect(restrictCalls[3]?.allow).toEqual(['read'])
  })
})

describe('SideChat persona prefix (runtime section for inherit-mode children)', () => {
  it('installs the full persona prefix for a child whose preset differs from the configured preset', async () => {
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob'],
      persistedPermission: {
        mode: 'inherit',
        childAgentPreset: 'standard',
        parentSandboxMode: 'workspace-write',
        childSandboxMode: 'workspace-write',
        parentApprovalPolicy: 'ask',
        childApprovalPolicy: 'ask',
        parentTools: ['read', 'glob'],
        allowedTools: ['read', 'glob'],
        capturedAt: 5,
      },
    })
    await harness.init()
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    const sections = (harness.systemPrompt.section as ReturnType<typeof vi.fn>).mock.calls
      .map(call => call[0] as { name: string; text: string })
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_PREFIX_SECTION)).toMatchObject({ text: SIDECHAT_PERSONA_PREFIX })
    expect(sections.find(section => section.name === 'sidechat:persona-suffix')).toBeDefined()
  })

  it('keeps a same-layer foreign parent persona prefix AND installs the full SideChat role under the distinct section', async () => {
    // A custom parent preset already installed a foreign persona prefix under
    // the deployment's PERSONA_PREFIX_SECTION (same layer, foreign text): a
    // same-name registration would throw upstream. The SideChat role must
    // register under its OWN section name so BOTH texts survive, and the
    // install must succeed (no swallow-catch, no blocked state).
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob'],
      persistedPermission: {
        mode: 'inherit',
        childAgentPreset: 'custom-parent-preset',
        parentSandboxMode: 'workspace-write',
        childSandboxMode: 'workspace-write',
        parentApprovalPolicy: 'ask',
        childApprovalPolicy: 'ask',
        parentTools: ['read', 'glob'],
        allowedTools: ['read', 'glob'],
        capturedAt: 5,
      },
    })
    const FOREIGN_PARENT_PERSONA = 'FOREIGN PARENT ROLE PREFIX (custom preset persona)'
    // Make the mock registry honest: same-layer duplicate section names throw
    // (upstream systemPrompt.section, packages/core/system-prompt/src/index.ts:466-483).
    const registered = new Set<string>()
    ;(harness.systemPrompt.section as ReturnType<typeof vi.fn>).mockImplementation((section: { name: string }) => {
      if (registered.has(section.name)) throw new Error(`duplicate prompt section "${section.name}"`)
      registered.add(section.name)
      return () => undefined
    })
    // Foreign prefix first: installing 'deployment:persona-prefix' now is a
    // same-layer duplicate for anyone registering that name again.
    harness.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: FOREIGN_PARENT_PERSONA })
    // Same-layer duplicate registration of the deployment name really throws.
    expect(() => harness.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: 'again' })).toThrow()
    await harness.init()
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    const sections = (harness.systemPrompt.section as ReturnType<typeof vi.fn>).mock.calls
      .map(call => call[0] as { name: string; text: string })
    // Both survive: the foreign parent prefix AND the full SideChat role.
    expect(sections.find(section => section.name === 'deployment:persona-prefix')).toMatchObject({ text: FOREIGN_PARENT_PERSONA })
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_PREFIX_SECTION)).toMatchObject({ text: SIDECHAT_PERSONA_PREFIX })
    // The install succeeded (no blocked state): enforcement disposers exist.
    expect((harness.service as unknown as { permissionDisposers: Map<string, unknown> }).permissionDisposers.has('child')).toBe(true)
  })

  it('does not duplicate the runtime prefix when the child preset already provides it', async () => {
    const harness = makeResumeHarness({
      childToolNames: ['read', 'glob'],
      persistedPermission: {
        mode: 'readonly',
        childAgentPreset: 'sidechat-clarifier',
        parentSandboxMode: 'workspace-write',
        childSandboxMode: 'read-only',
        parentApprovalPolicy: 'ask',
        childApprovalPolicy: 'never',
        parentTools: ['read', 'glob'],
        allowedTools: ['read', 'glob'],
        capturedAt: 5,
      },
    })
    await harness.init()
    harness.listeners.get('agent/created')?.({ agent: harness.childAgent })
    const sections = (harness.systemPrompt.section as ReturnType<typeof vi.fn>).mock.calls
      .map(call => call[0] as { name: string; text: string })
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_PREFIX_SECTION)).toBeUndefined()
    expect(sections.find(section => section.name === 'sidechat:persona-suffix')).toBeDefined()
  })

  it('keeps cordis.patch.yml and the shared persona constant in sync', () => {
    const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    for (const line of SIDECHAT_PERSONA_PREFIX.split('\n')) {
      expect(patch).toContain(line)
    }
  })
})

describe('computePermissionScope (pure permission computation)', () => {
  it('intersects the snapshot with the visible surface and the parent ceiling', () => {
    const scope = computePermissionScope({
      parentTools: ['read', 'glob', 'write'],
      allowedTools: ['read', 'glob', 'subagent'],
      visibleNames: ['read', 'glob', 'write', PTC_TRANSPORT_RUN_CODE],
    })
    expect(scope.allowed).toEqual(['glob', 'read'])
    expect(scope.allowForRestrict).toEqual(['glob', 'read'])
    expect(scope.guard({ name: 'read' })).toBeUndefined()
    expect(scope.guard({ name: 'write' })).toContain('permission snapshot')
    expect(scope.guard({ name: 'subagent' })).toContain('permission snapshot')
  })

  it('always allows the reserved PTC transport through the guard and keeps it out of restrict', () => {
    const scope = computePermissionScope({
      parentTools: ['read'],
      allowedTools: ['read', PTC_TRANSPORT_RUN_CODE],
      visibleNames: ['read', PTC_TRANSPORT_RUN_CODE],
      restrictableNames: ['read', PTC_TRANSPORT_RUN_CODE],
    })
    expect(scope.guard({ name: PTC_TRANSPORT_RUN_CODE })).toBeUndefined()
    expect(scope.allowForRestrict).not.toContain(PTC_TRANSPORT_RUN_CODE)
    expect(scope.allowForRestrict).toEqual(['read'])
  })

  it('filters the restrict list down to upstream-restrictable names while the guard still covers the rest', () => {
    const scope = computePermissionScope({
      parentTools: ['read', 'glob'],
      allowedTools: ['read', 'glob'],
      visibleNames: ['read', 'glob', 'local_tool'],
      restrictableNames: ['read', 'glob'],
    })
    expect(scope.allowForRestrict).toEqual(['glob', 'read'])
    // Scope-local registrations never enter restrict; the snapshot ceiling
    // never contains them, so the guard deny is the correct outcome.
    expect(scope.guard({ name: 'local_tool' })).toContain('permission snapshot')
  })
})
