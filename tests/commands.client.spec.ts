// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

interface TestCommand {
  readonly name: string
  readonly description: string
  readonly available: (session: { sessionId: string }) => boolean
  readonly ui: {
    readonly options: (
      session: { sessionId: string },
      signal: AbortSignal,
    ) => Promise<Array<{ readonly id: string; readonly active?: boolean; readonly detail?: string }>>
  }
}

describe('SideChat slash command surface', () => {
  it('registers operational workflows as commands instead of Header actions', () => {
    const commands: TestCommand[] = []
    const ctx = {
      effect: (setup: () => unknown) => { setup(); return () => undefined },
      locale: {
        register: vi.fn(() => () => undefined),
        bind: vi.fn(() => (key: keyof typeof zh) => zh[key]),
      },
      slots: { inject: vi.fn(() => () => undefined), register: vi.fn() },
      sessions: { open: vi.fn(), refresh: vi.fn() },
      commandUi: {
        register: vi.fn((command) => { commands.push(command); return () => undefined }),
      },
      get: vi.fn(),
    }
    apply(ctx as never)
    expect(commands.map(command => command.name)).toEqual([
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
    ])
    expect(commands.find(command => command.name === 'sidefold')?.description).toContain('预览')
    expect(commands.find(command => command.name === 'sideabandon')?.description).toContain('transcript')
    expect(ctx.slots.inject).not.toHaveBeenCalledWith('conversation.chat.assistant-actions', expect.anything())
  })

  it('makes tail:1 the recommended default and warns that task costs an extra model call', async () => {
    const commands: TestCommand[] = []
    const ctx = {
      effect: (setup: () => unknown) => { setup(); return () => undefined },
      locale: { register: vi.fn(), bind: vi.fn(() => (key: keyof typeof zh) => zh[key]) },
      slots: { inject: vi.fn(), register: vi.fn() },
      sessions: { open: vi.fn(), refresh: vi.fn() },
      commandUi: { register: vi.fn((command: TestCommand) => { commands.push(command); return () => undefined }) },
      get: vi.fn(),
    }
    apply(ctx as never)
    const side = commands.find(command => command.name === 'side')
    if (side === undefined) throw new Error('/side was not registered')
    const options = await side.ui.options({ sessionId: 'parent' }, new AbortController().signal)
    expect(options[0]).toMatchObject({ id: 'tail:1', active: true })
    expect(options.find((option: { id: string }) => option.id === 'task')?.detail).toContain('额外调用一次模型')
  })

  it('does not expose B-only commands before SideChat identity has been established', () => {
    const commands: TestCommand[] = []
    const ctx = {
      effect: (setup: () => unknown) => { setup(); return () => undefined },
      locale: { register: vi.fn(), bind: vi.fn(() => (key: keyof typeof zh) => zh[key]) },
      slots: { inject: vi.fn(), register: vi.fn() },
      sessions: { open: vi.fn(), refresh: vi.fn() },
      commandUi: { register: vi.fn((command: TestCommand) => { commands.push(command); return () => undefined }) },
      get: vi.fn(),
    }
    apply(ctx as never)
    for (const name of ['sideback', 'sidefold', 'sidecompare', 'sidewithdraw', 'sidearchive', 'siderestore', 'sideabandon', 'sidecites', 'sideusage']) {
      const command = commands.find(candidate => candidate.name === name)
      if (command === undefined) throw new Error(`/${name} was not registered`)
      expect(command.available({ sessionId: 'ordinary' })).toBe(false)
    }
  })
})
