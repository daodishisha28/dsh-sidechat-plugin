// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SideChatApi, apply } from '../src/client/index.ts'
import { SideChatWorkflowHost } from '../src/client/workflow-dialogs.tsx'
import { zh } from '../src/client/locales.ts'
import type { SideChatRecord } from '../src/types.ts'

const COMMAND_NAMES = [
  'traceask',
  'side',
  'btw',
  'sideback',
  'sidechats',
  'sideresume',
  'sidefold',
  'sidecompare',
  'sidewithdraw',
  'sidearchive',
  'siderestore',
  'sideabandon',
  'sidecites',
  'sidecite',
  'sideusage',
  'sidecite-cross',
] as const

interface TestCommand {
  readonly name: string
  readonly description: () => string
  readonly available: (session: { sessionId: string }) => boolean
  readonly ui: {
    readonly options: (
      session: { sessionId: string },
      signal: AbortSignal,
    ) => Promise<Array<{ readonly id: string; readonly active?: boolean; readonly detail?: string }>>
    readonly onSelect?: (option: { readonly id: string }, session: { readonly sessionId: string }) => unknown
  }
}

/** Minimal valid v1 SideChatRecord accepted by sideChatRecordSchema. */
function sideChatRecord(childSessionId: string, parentSessionId: string): SideChatRecord {
  return {
    schema: 1, childSessionId, parentSessionId,
    parent: { createdAt: 1, cwd: 'C:\\work' }, child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q', title: '澄清：q', status: 'open',
    seed: { mode: 'none', parentSessionId, capturedThroughSeq: 0, capturedAt: 2, messages: [] },
    modelStrategy: { kind: 'default' }, selectedModel: { provider: 'deepseek', model: 'chat' },
    createdAt: 2, updatedAt: 2, revision: 0, folds: [], cites: [],
  }
}

/**
 * Mock at the REAL RPC boundary: `SideChatApi` resolves `ctx.get('connection')`
 * and calls `connection.rpc.call('/sidechat', method, { request }, signal)`.
 * The handler maps a command method name to the carrier value the Host would
 * return, so the genuine command option callbacks and the genuine
 * `SideChatApi` client run end to end. A method without a canned value fails
 * loud instead of silently returning nothing.
 */
function clientContext(rpc?: (method: string, request: unknown) => unknown) {
  const commands: TestCommand[] = []
  // alpha.2 has no `ctx.sessions.open`; navigation is `ctx.uiWorkspace.openSession`.
  // The sessions mock deliberately has no `open` so a stale call site fails loud.
  const rpcCall = vi.fn(async (path: string, method: string, payload: { request: unknown }) => {
    expect(path).toBe('/sidechat')
    const value = rpc?.(method, payload.request)
    if (value === undefined) {
      return { ok: false, error: { message: `unexpected SideChat RPC in test: ${method}` } }
    }
    return { ok: true, value: { ok: true, value } }
  })
  const ctx = {
    effect: (setup: () => unknown) => { setup(); return () => undefined },
    locale: {
      register: vi.fn(() => () => undefined),
      bind: vi.fn(() => (key: keyof typeof zh) => zh[key]),
    },
    slots: { inject: vi.fn(() => () => undefined), register: vi.fn() },
    sessions: { refresh: vi.fn(async () => undefined) },
    uiWorkspace: { openSession: vi.fn() },
    commandUi: {
      register: vi.fn((command: TestCommand) => { commands.push(command); return () => undefined }),
    },
    get: vi.fn((name: string) => name === 'connection' ? { rpc: { call: rpcCall } } : undefined),
  }
  return { ctx, commands, openSession: ctx.uiWorkspace.openSession, rpcCall }
}

afterEach(() => { cleanup() })

describe('SideChat slash command surface', () => {
  it('registers operational workflows as commands instead of Header actions', () => {
    const { ctx, commands } = clientContext()
    apply(ctx as never)
    expect(commands.map(command => command.name)).toEqual([...COMMAND_NAMES])
    // The alpha.2 contract is a callback: the row copy must be produced by
    // calling `description()`, and it must come from the locale dictionary.
    const sidefold = commands.find(command => command.name === 'sidefold')
    expect(typeof sidefold?.description).toBe('function')
    expect(sidefold?.description()).toBe(zh['command.sidefold'])
    expect(sidefold?.description()).toContain('预览')
    expect(commands.find(command => command.name === 'sideabandon')?.description()).toContain('transcript')
    expect(ctx.slots.inject).not.toHaveBeenCalledWith('conversation.chat.assistant-actions', expect.anything())
  })

  it('gives all 16 commands a callable localized description', () => {
    const { ctx, commands } = clientContext()
    apply(ctx as never)
    expect(commands).toHaveLength(COMMAND_NAMES.length)
    for (const command of commands) {
      const description = command.description()
      expect(typeof description).toBe('string')
      expect(description.length).toBeGreaterThan(0)
      expect(Object.values(zh)).toContain(description)
    }
  })

  it('navigates back to the parent through uiWorkspace.openSession, not the removed sessions.open', async () => {
    // /sideback resolves the parent through the plugin RPC (`api.get`), then
    // the command's real onSelect drives the pure navigation callback.
    const { ctx, commands, openSession, rpcCall } = clientContext(method => {
      if (method !== 'get') return undefined
      return { record: sideChatRecord('child-1', 'parent-9') }
    })
    apply(ctx as never)
    expect(ctx.sessions).not.toHaveProperty('open')
    const sideback = commands.find(command => command.name === 'sideback')
    expect(sideback).toBeDefined()
    expect(openSession).not.toHaveBeenCalled()

    const session = { sessionId: 'child-1' }
    const options = await sideback!.ui.options(session, new AbortController().signal)
    expect(options).toEqual([{ id: 'parent-9', label: '返回父会话', detail: 'parent-9' }])
    expect(rpcCall).toHaveBeenCalledWith('/sidechat', 'get', { request: { sessionId: 'child-1' } }, expect.any(AbortSignal))

    await sideback!.ui.onSelect!(options[0]!, session)
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith('parent-9')
  })

  it('resumes a child SideChat from /sideresume rows through the plugin RPC catalog', async () => {
    const { ctx, commands, openSession, rpcCall } = clientContext(method => {
      if (method !== 'catalog') return undefined
      return {
        items: [{
          childSessionId: 'child-9', parentSessionId: 'parent-1', title: '澄清：登录态',
          status: 'open', revision: 2, model: 'deepseek/chat', updatedAt: 5,
        }],
      }
    })
    apply(ctx as never)
    const sideresume = commands.find(command => command.name === 'sideresume')
    expect(sideresume).toBeDefined()
    const session = { sessionId: 'parent-1' }
    const options = await sideresume!.ui.options(session, new AbortController().signal)
    expect(options).toEqual([{
      id: 'child-9',
      label: '澄清：登录态',
      detail: '直接子会话 · open · rev 2 · deepseek/chat',
    }])
    expect(rpcCall).toHaveBeenCalledWith('/sidechat', 'catalog', { request: { sessionId: 'parent-1' } }, expect.any(AbortSignal))

    await sideresume!.ui.onSelect!(options[0]!, session)
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith('child-9')
  })

  it('creates a child SideChat and enters it through the real workflow over the plugin RPC', async () => {
    // Full create-then-enter path: the real /side command onSelect opens the
    // real workflow host, whose create submit calls the REAL SideChatApi over
    // the mocked connection RPC and finally navigates with the returned
    // childSessionId.
    const { ctx, commands, openSession } = clientContext(method => {
      if (method === 'seedChoices') {
        return { items: [{ messageId: 'm1', role: 'assistant', text: '冻结的父会话回答', seq: 3, turn: 1 }] }
      }
      if (method === 'create') {
        return {
          childSessionId: 'child-created',
          record: sideChatRecord('child-created', 'parent-1'),
          modelSelectionChangesGlobalDefault: false,
        }
      }
      return undefined
    })
    apply(ctx as never)
    const side = commands.find(command => command.name === 'side')
    expect(side).toBeDefined()
    const refreshSessions = vi.fn(async () => undefined)
    const api = new SideChatApi(ctx as never)
    // Plain .ts spec: build the element with createElement instead of JSX so
    // the file needs no .tsx rename (the real component code path is the same).
    render(createElement(SideChatWorkflowHost, {
      sessionId: 'parent-1' as never,
      api: api as never,
      openSession,
      refreshSessions,
    }))

    await act(async () => {
      await side!.ui.onSelect!({ id: 'tail:1' }, { sessionId: 'parent-1' })
    })
    // /side opens the permission step first; confirming it opens the create form.
    const permissions = await screen.findByRole('listbox', { name: 'SideChat 权限模式' })
    fireEvent.keyDown(permissions, { key: 'Enter' })
    const dialog = await screen.findByRole('dialog', { name: '创建 SideChat · 最近 1 条 · 只读模式' })
    await screen.findByText('冻结的父会话回答')
    const question = screen.getByPlaceholderText(/描述你希望/u)
    await waitFor(() => { expect(document.activeElement).toBe(question) })
    fireEvent.change(question, { target: { value: 'Redis 在哪里配置？' } })
    fireEvent.submit(dialog.querySelector('form')!)

    await waitFor(() => { expect(openSession).toHaveBeenCalledTimes(1) })
    expect(openSession).toHaveBeenCalledWith('child-created')
    expect(refreshSessions).toHaveBeenCalled()
  })

  it('makes tail:1 the recommended default and warns that task costs an extra model call', async () => {
    const { ctx, commands } = clientContext()
    apply(ctx as never)
    const side = commands.find(command => command.name === 'side')
    if (side === undefined) throw new Error('/side was not registered')
    const options = await side.ui.options({ sessionId: 'parent' }, new AbortController().signal)
    expect(options[0]).toMatchObject({ id: 'tail:1', active: true })
    expect(options.find((option: { id: string }) => option.id === 'task')?.detail).toContain('额外调用一次模型')
  })

  it('does not expose B-only commands before SideChat identity has been established', () => {
    const { ctx, commands } = clientContext()
    apply(ctx as never)
    for (const name of ['sideback', 'sidefold', 'sidecompare', 'sidewithdraw', 'sidearchive', 'siderestore', 'sideabandon', 'sidecites', 'sideusage']) {
      const command = commands.find(candidate => candidate.name === name)
      if (command === undefined) throw new Error(`/${name} was not registered`)
      expect(command.available({ sessionId: 'ordinary' })).toBe(false)
    }
  })
})
