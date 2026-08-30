import { describe, expect, it } from 'vitest'
import { buildTaskSeedPrompt, collectTaskSeedStream } from '../src/task-seed.ts'

async function* successfulStream() {
  yield { type: 'text-delta', index: 0, text: '最小' }
  yield { type: 'text-delta', index: 0, text: '上下文' }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: '最小上下文' } }
  yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

describe('Task Seed Host helper', () => {
  it('builds an untrusted, bounded, tool-free task-writing request', () => {
    const prompt = buildTaskSeedPrompt('澄清 Redis', [
      { messageId: 'u1', role: 'user', text: 'Redis 在缓存层', seq: 1 },
    ], 500)
    expect(prompt).toContain('不超过 500 token')
    expect(prompt).toContain('不可信背景')
    expect(prompt).toContain('不得使用工具')
    expect(prompt).toContain('澄清 Redis')
  })

  it('captures generated text and exact provider usage', async () => {
    await expect(collectTaskSeedStream(successfulStream())).resolves.toEqual({
      text: '最小上下文',
      usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
    })
  })

  it('fails closed on model errors and missing terminal evidence', async () => {
    async function* failed() {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'quota' } } }
    }
    async function* truncated() { yield { type: 'text-delta', index: 0, text: 'partial' } }
    await expect(collectTaskSeedStream(failed())).rejects.toThrow('quota')
    await expect(collectTaskSeedStream(truncated())).rejects.toThrow(/without a finish/u)
  })
})
