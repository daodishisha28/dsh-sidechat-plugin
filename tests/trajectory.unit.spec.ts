import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { projectTrajectory, selectTrajectorySnapshots, trajectoryDetail, trajectoryOverview } from '../src/trajectory.ts'

const events: SessionEvent[] = [
  { seq: 1, time: 1_000, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, time: 1_010, type: 'user/message', data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'check login' }] } },
  { seq: 3, time: 1_020, type: 'step/start', data: { turn: 1, step: 1 } },
  { seq: 4, time: 1_030, type: 'assistant/message', data: { turn: 1, message: { id: 'a1', source: { kind: 'model', provider: 'deepseek', model: 'chat' }, content: [
    { type: 'tool-call', id: 'c1', name: 'read', arguments: { path: 'C:\\Users\\zzc\\secret.txt', apiKey: 'secret-value', unknownField: { nested: true }, stdout: 'x'.repeat(4_500) } },
    { type: 'tool-call', id: 'c2', name: 'Task', arguments: { prompt: 'search' }, turns: 3 },
    { type: 'text', text: 'final answer' },
  ] } } },
  { seq: 5, time: 1_080, type: 'tool/result', data: { id: 'r1', name: 'read', content: [{ type: 'text', text: 'Authorization: Bearer abcdefghijklmnop' }] } },
  { seq: 6, time: 1_090, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  { seq: 7, time: 1_100, type: 'user/message', data: { id: 'fold', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[SideChat fold id=x rev=1 source=B]\nFold result' }] } },
  { seq: 8, time: 1_110, type: 'user/message', data: { id: 'cite', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[SideChat cite id=y source=B message=m1]\nCited reply' }] } },
  { seq: 9, time: 1_120, type: 'user/message', data: { id: 'withdrawal', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[SideChat fold-withdrawal id=x rev=1 source=B]\nWithdrawn' }] } },
]

describe('trajectory Host projection', () => {
  it('projects raw tool content without redaction while keeping list previews bounded', () => {
    const items = projectTrajectory('parent', events)
    expect(items.map(item => item.kind)).toEqual(expect.arrayContaining(['turn', 'user', 'request', 'tool-call', 'subagent', 'assistant', 'tool-result', 'fold-note']))
    const read = items.find(item => item.eventId === 'c1')
    expect(read).toMatchObject({ redacted: false, truncated: true, fullContentAvailable: true })
    expect(read?.preview).toContain('secret-value')
    expect(read?.preview).toContain('C:\\\\Users\\\\zzc\\\\secret.txt')
    expect(read?.preview.length).toBeLessThan(4_100)
    const detail = trajectoryDetail(items, events, { seq: read!.seq, eventId: read!.eventId, kind: read!.kind, digest: read!.digest })
    expect(detail.text).toContain('unknownField')
    expect(detail.text).toContain('x'.repeat(4_500))
    expect(detail).toMatchObject({ redacted: false })
    const result = items.find(item => item.eventId === 'r1')
    expect(result?.preview).toContain('Authorization: Bearer abcdefghijklmnop')
    expect(result).toMatchObject({ redacted: false, fullContentAvailable: true })
    const notes = items.filter(item => item.kind === 'fold-note')
    expect(notes).toHaveLength(3)
    expect(notes.map(item => item.label)).toEqual(['↩ SideChat Fold', '↩ SideChat Cite', '↩ SideChat Fold 撤回'])
    expect(notes.every(item => item.turn === undefined && item.selectable === false)).toBe(true)
    expect(trajectoryOverview(items, events, 9)).toMatchObject({ turns: 1, calls: 2, subagents: 1, failures: 0, durationMs: 120 })
  })

  it('accepts exact immutable refs and fails closed for changed digests or fold notes', () => {
    const items = projectTrajectory('parent', events)
    const call = items.find(item => item.eventId === 'c1')!
    const snapshots = selectTrajectorySnapshots(items, events, [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: call.digest }])
    expect(snapshots).toMatchObject([{ eventId: 'c1', kind: 'tool-call', redacted: false }])
    expect(snapshots[0]?.text).toContain('x'.repeat(4_500))
    expect(() => selectTrajectorySnapshots(items, events, [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: 'stale' }])).toThrow(/stale/u)
    const note = items.find(item => item.kind === 'fold-note')!
    expect(() => selectTrajectorySnapshots(items, events, [{ seq: note.seq, eventId: note.eventId, kind: note.kind, digest: note.digest }])).toThrow(/unavailable/u)
  })
})
