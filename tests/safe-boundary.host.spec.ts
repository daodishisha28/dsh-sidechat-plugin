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
})
