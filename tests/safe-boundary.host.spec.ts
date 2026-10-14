import { describe, expect, it, vi } from 'vitest'
import { atSafeBoundary, type SafeBoundaryAgent } from '../src/safe-boundary.ts'

describe('Host safe no-reply boundary', () => {
  it('waits for idle and runs only a maintenance task', async () => {
    const order: string[] = []
    const agent: SafeBoundaryAgent = {
      status: 'idle',
      whenIdle: vi.fn(async () => { order.push('idle') }),
      runMaintenance: vi.fn(async task => {
        order.push('maintenance')
        return task(new AbortController().signal)
      }),
    }
    const append = vi.fn(() => { order.push('append') })
    const flush = vi.fn(async () => { order.push('flush'); return true })
    await atSafeBoundary(agent, async () => { append(); await flush() })
    expect(order).toEqual(['idle', 'maintenance', 'append', 'flush'])
    expect(agent.whenIdle).toHaveBeenCalledOnce()
    expect(agent.runMaintenance).toHaveBeenCalledOnce()
  })

  it('retries a wake that races the maintenance claim', async () => {
    let running = true
    let idleChecks = 0
    const agent: SafeBoundaryAgent = {
      get status() { return running ? 'running' : 'idle' },
      whenIdle: vi.fn(async () => { idleChecks += 1; if (idleChecks > 1) running = false }),
      runMaintenance: vi.fn(async task => {
        if (running) throw new Error('agent busy')
        return task(new AbortController().signal)
      }),
    }
    const task = vi.fn(async () => 'done')
    await expect(atSafeBoundary(agent, task)).resolves.toBe('done')
    expect(agent.runMaintenance).toHaveBeenCalledTimes(2)
    expect(task).toHaveBeenCalledOnce()
  })

  it('resolves the agent fresh on every attempt so a recreated target is picked up', async () => {
    const order: string[] = []
    const firstAgent: SafeBoundaryAgent = {
      status: 'running',
      whenIdle: vi.fn(async () => { order.push('idle:first') }),
      runMaintenance: vi.fn(async () => { order.push('maintenance:first'); throw new Error('agent busy') }),
    }
    const secondAgent: SafeBoundaryAgent = {
      status: 'idle',
      whenIdle: vi.fn(async () => { order.push('idle:second') }),
      runMaintenance: vi.fn(async task => {
        order.push('maintenance:second')
        return task(new AbortController().signal)
      }),
    }
    let resolved = 0
    const resolveAgent = vi.fn(async () => {
      resolved += 1
      return resolved === 1 ? firstAgent : secondAgent
    })
    const seen: string[] = []
    const result = await atSafeBoundary(resolveAgent, async signal => {
      signal.throwIfAborted()
      seen.push('task')
      return 'done' as const
    })
    expect(result).toBe('done')
    expect(resolveAgent).toHaveBeenCalledTimes(2)
    expect(order).toEqual(['idle:first', 'maintenance:first', 'idle:second', 'maintenance:second'])
    expect(seen).toEqual(['task'])
  })

  it('propagates a resolver failure (target gone or identity changed) to the caller', async () => {
    const resolveAgent = vi.fn(async () => { throw new Error('target Session lifecycle identity changed') })
    await expect(atSafeBoundary(resolveAgent, async () => 'never')).rejects.toThrow(/lifecycle identity changed/u)
    expect(resolveAgent).toHaveBeenCalledOnce()
  })
})
