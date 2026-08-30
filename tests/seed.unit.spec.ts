import { describe, expect, it } from 'vitest'
import {
  buildInitialPrompt,
  extractSeedCandidates,
  makeSeedProvenance,
  selectSeedMessages,
  selectTaskSeedWindow,
} from '../src/seed.ts'

const events = [
  { type: 'user/message', seq: 1, data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'direct user' }] } },
  { type: 'user/message', seq: 2, data: { id: 'p1', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'plugin context' }] } },
  { type: 'assistant/reasoning', seq: 3, data: { text: 'secret reasoning' } },
  { type: 'assistant/message', seq: 4, data: { message: { id: 'a1', content: [{ type: 'text', text: 'assistant answer' }, { type: 'tool-call', name: 'x' }] } } },
  { type: 'tool/result', seq: 5, data: { content: [{ type: 'text', text: 'tool result' }] } },
  { type: 'user/message', seq: 6, data: { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: 'last user' }] } },
]

describe('Seed extraction', () => {
  it('keeps only direct user and assistant text', () => {
    expect(extractSeedCandidates(events)).toEqual([
      { messageId: 'u1', role: 'user', text: 'direct user', seq: 1 },
      { messageId: 'a1', role: 'assistant', text: 'assistant answer', seq: 4 },
      { messageId: 'u2', role: 'user', text: 'last user', seq: 6 },
    ])
  })

  it('implements none, tail and exact pick without transcript copying', () => {
    const candidates = extractSeedCandidates(events)
    expect(selectSeedMessages(candidates, 'none')).toEqual([])
    expect(selectSeedMessages(candidates, 'tail:1').map(item => item.messageId)).toEqual(['u2'])
    expect(selectSeedMessages(candidates, 'tail:2').map(item => item.messageId)).toEqual(['a1', 'u2'])
    expect(selectSeedMessages(candidates, 'tail:4').map(item => item.messageId)).toEqual(['u1', 'a1', 'u2'])
    expect(selectSeedMessages(candidates, 'pick:1', { pickMessageId: 'a1' }).map(item => item.messageId)).toEqual(['a1'])
    expect(selectSeedMessages(candidates, 'pick:1', { pickMessageId: 'missing' })).toEqual([])
  })

  it('builds a newest-first bounded Task window and restores chronological order', () => {
    const candidates = extractSeedCandidates(events)
    expect(selectTaskSeedWindow(candidates, 25, 20)).toEqual({
      messages: [
        { messageId: 'a1', role: 'assistant', text: 'assistant answer', seq: 4 },
        { messageId: 'u2', role: 'user', text: 'last user', seq: 6 },
      ],
      droppedOlderMessages: 1,
    })
    expect(() => selectTaskSeedWindow([
      { messageId: 'u', role: 'user', text: 'x'.repeat(25), seq: 1 },
    ], 24, 20)).toThrow(/use selection, pick, or summary/u)
  })

  it('allows an empty default tail:1 Seed and preserves its mode', () => {
    expect(makeSeedProvenance({
      parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 1, mode: 'tail:1', candidates: [],
    })).toMatchObject({ mode: 'tail:1', messages: [] })
  })

  it('supports multi-message, turn, fragment and bounded summary sources', () => {
    const turnEvents = [
      { type: 'turn/start', seq: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 2, data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'abcdef' }] } },
      { type: 'assistant/message', seq: 3, data: { message: { id: 'a1', content: [{ type: 'text', text: 'answer one' }] } } },
      { type: 'turn/start', seq: 4, data: { turn: 2 } },
      { type: 'user/message', seq: 5, data: { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] } },
    ]
    const candidates = extractSeedCandidates(turnEvents)
    expect(selectSeedMessages(candidates, 'pick:many', { selectedMessageIds: ['a1', 'u2'] }).map(item => item.messageId)).toEqual(['a1', 'u2'])
    expect(selectSeedMessages(candidates, 'turn', { turn: 1 }).map(item => item.messageId)).toEqual(['u1', 'a1'])
    expect(selectSeedMessages(candidates, 'selection', { selection: { messageId: 'u1', start: 1, end: 4 } })).toEqual([
      { messageId: 'u1', role: 'user', text: 'bcd', seq: 2, turn: 1, selection: { start: 1, end: 4 } },
    ])
    expect(selectSeedMessages(candidates, 'summary', { summarySourceMessageIds: ['u2', 'u1'] }).map(item => item.messageId)).toEqual(['u1', 'u2'])
  })

  it('fails closed when a seed exceeds its immutable snapshot budget', () => {
    expect(() => makeSeedProvenance({
      parentSessionId: 'parent', capturedThroughSeq: 1, capturedAt: 1, mode: 'tail:2',
      candidates: [{ messageId: 'u1', role: 'user', text: 'x'.repeat(13_000), seq: 1 }],
    })).toThrow(/12000 characters/u)
  })

  it('records immutable provenance facts and marks the context untrusted', () => {
    const seed = makeSeedProvenance({
      parentSessionId: 'parent', capturedThroughSeq: 6, capturedAt: 123,
      mode: 'tail:2', candidates: extractSeedCandidates(events),
    })
    expect(seed).toMatchObject({ parentSessionId: 'parent', capturedThroughSeq: 6, capturedAt: 123, mode: 'tail:2' })
    const prompt = buildInitialPrompt('clarify this', seed)
    expect(prompt).toContain('不可信背景')
    expect(prompt).toContain('assistant answer')
    expect(prompt).not.toContain('secret reasoning')
    expect(prompt).not.toContain('tool result')
  })
})
