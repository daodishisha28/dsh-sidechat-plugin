import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SideChatService } from '../src/service.ts'

describe('SideChat Remote readiness', () => {
  it('owns an authenticated package channel after storage-backed init', async () => {
    const ctx = new Context()
    const table = { get: () => undefined, entries: () => [] as Array<readonly [string, never]> }
    const domain = { table: vi.fn(() => table), close: vi.fn(async () => undefined) }
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    ctx.provide('storageDomain', { open: vi.fn(async () => domain) })
    ctx.provide('agents', { list: vi.fn(() => []) })
    ctx.provide('effect', vi.fn())
    ctx.provide('on', vi.fn())
    ctx.provide('connection', { rpc: { handle: vi.fn((channel, next) => {
      expect(channel).toBe('/sidechat')
      handler = next
      return async () => undefined
    }) } })
    const service = new SideChatService(ctx)

    await (service as unknown as { [Service.init]: () => Promise<void> })[Service.init]()

    expect(domain.table).toHaveBeenCalledWith('chats')
    expect(handler).toBeTypeOf('function')
    await expect(handler?.('get', { request: { sessionId: 'ordinary' } }, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: { ok: true, value: { record: null } } })
    await expect(handler?.('notAnEndpoint', {}, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'not-found' } })
  })
})
