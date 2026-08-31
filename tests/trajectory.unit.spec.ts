import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { projectTrajectory, selectTrajectorySnapshots, trajectoryOverview } from '../src/trajectory.ts'

const events: SessionEvent[] = [
  { seq: 1, time: 1_000, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, time: 1_010, type: 'user/message', data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'check login' }] } },
  { seq: 3, time: 1_020, type: 'step/start', data: { turn: 1, step: 1 } },
  { seq: 4, time: 1_030, type: 'assistant/message', data: { turn: 1, message: { id: 'a1', source: { kind: 'model', provider: 'deepseek', model: 'chat' }, content: [
    { type: 'tool-call', id: 'c1', name: 'read', arguments: { path: 'src/login.ts', apiKey: 'secret-value' } },
    { type: 'tool-call', id: 'c2', name: 'Task', arguments: { prompt: 'search' }, turns: 3 },
    { type: 'text', text: 'final answer' },
  ] } } },
  { seq: 5, time: 1_080, type: 'tool/result', data: { id: 'r1', name: 'read', content: [{ type: 'text', text: 'Authorization: Bearer abcdefghijklmnop' }] } },
  { seq: 6, time: 1_090, type: 'user/message', data: { id: 'fold', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[SideChat fold id=x rev=1 source=B]\nFold result' }] } },
  { seq: 7, time: 1_100, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

describe('trajectory Host projection', () => {
  it('projects L3 event kinds, redacts secrets and exposes a bounded overview', () => {
    const items = projectTrajectory('parent', events)
    expect(items.map(item => item.kind)).toEqual(expect.arrayContaining(['turn', 'user', 'request', 'tool-call', 'subagent', 'assistant', 'tool-result', 'fold-note']))
    const read = items.find(item => item.eventId === 'c1')
    expect(read?.preview).toContain('[REDACTED]')
    expect(read?.redacted).toBe(true)
    const result = items.find(item => item.eventId === 'r1')
    expect(result?.preview).not.toContain('abcdefghijklmnop')
    expect(items.find(item => item.kind === 'fold-note')).toMatchObject({ selectable: false })
    expect(trajectoryOverview(items, events, 7)).toMatchObject({ turns: 1, calls: 2, subagents: 1, failures: 0, durationMs: 100 })
  })

  it('accepts exact immutable refs and fails closed for changed digests or fold notes', () => {
    const items = projectTrajectory('parent', events)
    const call = items.find(item => item.eventId === 'c1')!
    expect(selectTrajectorySnapshots(items, [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: call.digest }])).toMatchObject([{ eventId: 'c1', kind: 'tool-call' }])
    expect(() => selectTrajectorySnapshots(items, [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: 'stale' }])).toThrow(/stale/u)
    const note = items.find(item => item.kind === 'fold-note')!
    expect(() => selectTrajectorySnapshots(items, [{ seq: note.seq, eventId: note.eventId, kind: note.kind, digest: note.digest }])).toThrow(/unavailable/u)
  })
})
