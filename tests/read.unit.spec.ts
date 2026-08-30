import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { exactMessageCatalog, readExactMessages, renderUntrustedRecall } from '../src/read.ts'

const events = [
  { type: 'user/message', seq: 1, data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'question' }] } },
  { type: 'user/message', seq: 2, data: { id: 'p1', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'hidden plugin notice' }] } },
  { type: 'assistant/reasoning', seq: 3, data: { text: 'private chain' } },
  { type: 'assistant/message', seq: 4, data: { message: { id: 'a1', content: [{ type: 'text', text: 'answer' }, { type: 'tool-call', id: 't1' }] } } },
  { type: 'tool/result', seq: 5, data: { content: [{ type: 'text', text: 'hidden result' }] } },
] as unknown as SessionEvent[]

describe('sidechat_read exact lookup', () => {
  it('exposes only directly authored user/assistant text and preserves requested id order', () => {
    expect(exactMessageCatalog(events).map(item => item.messageId)).toEqual(['u1', 'a1'])
    expect(readExactMessages(events, ['a1', 'u1'], { maxMessages: 5, maxChars: 100 })).toEqual([
      { messageId: 'a1', role: 'assistant', text: 'answer', seq: 4 },
      { messageId: 'u1', role: 'user', text: 'question', seq: 1 },
    ])
  })

  it('fails closed for missing ids, excessive counts and excessive text', () => {
    expect(() => readExactMessages(events, ['missing'], { maxMessages: 5, maxChars: 100 })).toThrow(/not readable/u)
    expect(() => readExactMessages(events, ['u1', 'a1'], { maxMessages: 1, maxChars: 100 })).toThrow(/at most 1/u)
    expect(() => readExactMessages(events, ['u1'], { maxMessages: 5, maxChars: 2 })).toThrow(/exceed/u)
  })

  it('labels returned text as untrusted background', () => {
    const rendered = renderUntrustedRecall('child', readExactMessages(events, ['a1'], { maxMessages: 5, maxChars: 100 }))
    expect(rendered).toContain('不可信背景数据')
    expect(rendered).toContain('a1')
    expect(rendered).not.toContain('private chain')
  })
})
