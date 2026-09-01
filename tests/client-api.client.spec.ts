import { describe, expect, it, vi } from 'vitest'
import { SideChatApi } from '../src/client/api.ts'

describe('Client authenticated SideChat RPC bridge', () => {
  it('uses the package-owned channel and exact request envelope', async () => {
    const call = vi.fn(async () => ({ ok: true, value: { ok: true, value: { record: null } } }))
    const ctx = { get: (name: string) => name === 'connection' ? { rpc: { call } } : undefined }
    const api = new SideChatApi(ctx as never)
    await expect(api.get('s1')).resolves.toEqual({ record: null })
    expect(call).toHaveBeenCalledWith('/sidechat', 'get', { request: { sessionId: 's1' } }, expect.any(AbortSignal))
  })

  it('surfaces business failures instead of accepting unchecked JSON', async () => {
    const ctx = { get: () => ({ rpc: { call: async () => ({ ok: true, value: { ok: false, error: { code: 'orphaned', message: 'gone' } } }) } }) }
    await expect(new SideChatApi(ctx as never).get('s1')).rejects.toThrow('gone')
  })

  it('reads full tool detail only through an exact immutable trajectory ref', async () => {
    const value = {
      seq: 4, eventId: 'call-1', kind: 'tool-call', digest: 'digest-1',
      text: '{"apiKey":"visible"}', chars: 20, estimatedTokens: 5, redacted: false,
    }
    const call = vi.fn(async () => ({ ok: true, value: { ok: true, value } }))
    const api = new SideChatApi({ get: () => ({ rpc: { call } }) } as never)
    await expect(api.trajectoryDetail('parent', {
      seq: 4, eventId: 'call-1', kind: 'tool-call', digest: 'digest-1',
    })).resolves.toEqual(value)
    expect(call).toHaveBeenCalledWith('/sidechat', 'trajectoryDetail', { request: {
      sessionId: 'parent',
      ref: { seq: 4, eventId: 'call-1', kind: 'tool-call', digest: 'digest-1' },
    } }, expect.any(AbortSignal))
  })

  it('uses the M2 tree, revision, withdrawal and cross-parent Cite wire contracts', async () => {
    const call = vi.fn(async (_path, method: string) => ({
      ok: true,
      value: { ok: true, value: method === 'tree'
        ? { items: [] }
        : method === 'prepareFold'
          ? { fold: {
              foldId: '11111111-1111-4111-8111-111111111111', revision: 1, state: 'prepared',
              generatedContent: 'x', baselineSeq: 0, previewThroughSeq: 0, estimatedTokens: 1,
              structureValid: false, mode: 'incremental', baseRevision: 1, createdAt: 1, updatedAt: 1,
            } }
          : { state: 'pending' } },
    }))
    const api = new SideChatApi({ get: () => ({ rpc: { call } }) } as never)
    await api.tree('root')
    await api.prepareFold('child', '11111111-1111-4111-8111-111111111111', 'incremental', 1)
    await api.withdrawFold('child', '11111111-1111-4111-8111-111111111111', 'obsolete')
    await api.crossCite('target', 'child', 'm1', '22222222-2222-4222-8222-222222222222')
    expect(call.mock.calls.map(callArgs => callArgs[1])).toEqual([
      'tree', 'prepareFold', 'withdrawFold', 'crossCite',
    ])
    expect(call.mock.calls[1]?.[2]).toEqual({ request: {
      childSessionId: 'child', foldId: '11111111-1111-4111-8111-111111111111', mode: 'incremental', baseRevision: 1,
    } })
  })

  it('validates workspace catalog and exact usage report contracts', async () => {
    const call = vi.fn(async (_path, method: string) => ({
      ok: true,
      value: { ok: true, value: method === 'catalog'
        ? { items: [] }
        : {
            childSessionId: 'child',
            child: { complete: false, completedTurns: 0, incompleteTurns: 1 },
            parentDeltaSinceCreate: { available: false, complete: false },
            noReplyModelCalls: 0,
          } },
    }))
    const api = new SideChatApi({ get: () => ({ rpc: { call } }) } as never)
    await expect(api.catalog('parent')).resolves.toEqual({ items: [] })
    await expect(api.usage('child')).resolves.toMatchObject({ childSessionId: 'child', noReplyModelCalls: 0 })
    expect(call.mock.calls.map(callArgs => callArgs[1])).toEqual(['catalog', 'usage'])
  })
})
