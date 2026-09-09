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
    expect(notes.map(item => ({ label: item.label, selectable: item.selectable }))).toEqual([
      { label: '↩ SideChat Fold', selectable: true },
      { label: '↩ SideChat Cite', selectable: true },
      { label: '↩ SideChat Fold 撤回', selectable: false },
    ])
    expect(notes.every(item => item.turn === undefined)).toBe(true)
    expect(trajectoryOverview(items, events, 9)).toMatchObject({ turns: 1, calls: 2, subagents: 1, failures: 0, durationMs: 120 })
  })

  it('accepts exact immutable refs and preserves selectable Fold provenance', () => {
    const items = projectTrajectory('parent', events)
    const call = items.find(item => item.eventId === 'c1')!
    const snapshots = selectTrajectorySnapshots(items, events, [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: call.digest }])
    expect(snapshots).toMatchObject([{ eventId: 'c1', kind: 'tool-call', redacted: false }])
    expect(snapshots[0]?.text).toContain('x'.repeat(4_500))
    expect(() => selectTrajectorySnapshots(items, events, [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: 'stale' }])).toThrow(/stale/u)
    const fold = items.find(item => item.eventId === 'fold')!
    const foldSnapshots = selectTrajectorySnapshots(items, events, [{ seq: fold.seq, eventId: fold.eventId, kind: fold.kind, digest: fold.digest }])
    expect(foldSnapshots[0]?.text).toBe('[SideChat fold id=x rev=1 source=B]\nFold result')
    const cite = items.find(item => item.eventId === 'cite')!
    const citeSnapshots = selectTrajectorySnapshots(items, events, [{ seq: cite.seq, eventId: cite.eventId, kind: cite.kind, digest: cite.digest }])
    expect(citeSnapshots[0]?.text).toBe('[SideChat cite id=y source=B message=m1]\nCited reply')
  })

  it('correlates canonical subagent tool results with their calls and exposes the returned text', () => {
    const subagentEvents: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'assistant-1', source: { kind: 'model', provider: 'deepseek', model: 'chat' }, content: [
        { type: 'tool-call', id: 'subagent-call', name: 'subagent', arguments: { prompt: 'inspect this' }, turns: 1 },
      ] } } },
      { seq: 4, time: 4, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'subagent-result-message', source: { kind: 'tool', callId: 'subagent-call' }, content: [
        { type: 'tool-result', toolCallId: 'subagent-call', content: [{ type: 'text', text: 'child final answer' }] },
      ] } } },
    ]
    const projected = projectTrajectory('parent', subagentEvents)
    const call = projected.find(item => item.kind === 'subagent')!
    const result = projected.find(item => item.kind === 'tool-result')!

    expect(call).toMatchObject({ callId: 'subagent-call', toolName: 'subagent' })
    expect(result).toMatchObject({ callId: 'subagent-call', toolName: 'subagent', selectable: true })
    expect(result.preview).toContain('child final answer')
    expect(trajectoryDetail(projected, subagentEvents, {
      seq: result.seq,
      eventId: result.eventId,
      kind: result.kind,
      digest: result.digest,
    }).text).toContain('child final answer')
  })

  it('uses the supplied model-aware trajectory budget instead of the former fixed 8k cap', () => {
    const longEvents: SessionEvent[] = [{
      seq: 1,
      time: 1,
      type: 'tool/result',
      data: { id: 'long', name: 'read', content: [{ type: 'text', text: 'x'.repeat(40_000) }] },
    }]
    const items = projectTrajectory('parent', longEvents)
    const item = items[0]!
    const refs = [{ seq: item.seq, eventId: item.eventId, kind: item.kind, digest: item.digest }]
    expect(selectTrajectorySnapshots(items, longEvents, refs)[0]?.text).toContain('x'.repeat(40_000))
    expect(() => selectTrajectorySnapshots(items, longEvents, refs, {
      maxItems: 64,
      maxTokens: 9_000,
      maxChars: 36_000,
      description: '30% of a 30k context window',
    })).toThrow(/allows 9,000 tokens/u)
  })

  it('represents empty and cancelled turns from their real lifecycle boundaries', () => {
    const lifecycle: SessionEvent[] = [
      { seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 140, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { seq: 3, time: 200, type: 'turn/start', data: { turn: 2 } },
      { seq: 4, time: 240, type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
    ]
    const turns = projectTrajectory('parent', lifecycle).filter(item => item.kind === 'turn')
    expect(turns).toHaveLength(2)
    expect(turns.map(item => ({ turn: item.turn, status: item.status, durationMs: item.durationMs, preview: item.preview }))).toEqual([
      { turn: 1, status: 'success', durationMs: 40, preview: 'Turn 1 (empty)' },
      { turn: 2, status: 'cancelled', durationMs: 40, preview: 'Turn 2 (empty)' },
    ])
  })

  it('leaves an unanswered call unknown after a completed step instead of claiming success', () => {
    const incomplete: SessionEvent[] = [
      { seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 110, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 120, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }] } } },
      { seq: 4, time: 130, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{}' } },
      { seq: 5, time: 140, type: 'step/end', data: { turn: 1, step: 1 } },
      { seq: 6, time: 150, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const call = projectTrajectory('parent', incomplete).find(item => item.kind === 'tool-call')
    expect(call).toMatchObject({ callId: 'call-1' })
    expect(call?.status).toBeUndefined()
  })

  it('does not turn one terminal Turn error into failures for every unresolved call', () => {
    const interrupted: SessionEvent[] = [
      { seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 110, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 120, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [
        { type: 'tool-call', id: 'call-a', name: 'read', arguments: '{}' },
        { type: 'tool-call', id: 'call-b', name: 'read', arguments: '{}' },
      ] } } },
      { seq: 4, time: 130, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-a', name: 'read', arguments: '{}' } },
      { seq: 5, time: 140, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-b', name: 'read', arguments: '{}' } },
      { seq: 6, time: 150, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'loop failed' } } } },
    ]
    const projected = projectTrajectory('parent', interrupted)
    expect(projected.filter(item => item.kind === 'tool-call').map(item => item.status)).toEqual([undefined, undefined])
    expect(trajectoryOverview(projected, interrupted, 6).failures).toBe(1)

    const cancelled = interrupted.map(event => event.type === 'turn/end'
      ? { ...event, data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } } as SessionEvent
      : event)
    expect(projectTrajectory('parent', cancelled).filter(item => item.kind === 'tool-call').map(item => item.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('does not infer successful Turn completion from a partial log', () => {
    const partial: SessionEvent[] = [
      { seq: 1, time: 100, type: 'assistant/message', data: { turn: 3, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'partial' }] } } },
    ]
    const turn = projectTrajectory('parent', partial).find(item => item.kind === 'turn')
    expect(turn).toMatchObject({ turn: 3, status: undefined })
    expect(turn?.preview).toContain('[assistant] assistant ✓')
  })

  it('counts a failed call and its failed result/terminal turn as one logical failure', () => {
    const failed: SessionEvent[] = [
      { seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 110, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 120, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }] } } },
      { seq: 4, time: 130, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{}' } },
      { seq: 5, time: 140, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'result-1', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'failed' }], isError: true }] } } },
      { seq: 6, time: 150, type: 'step/end', data: { turn: 1, step: 1 } },
      { seq: 7, time: 160, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'tool failed', code: 'TOOL_FAILED' } } } },
    ]
    const projected = projectTrajectory('parent', failed)
    expect(projected.filter(item => item.status === 'error').map(item => item.kind)).toEqual(['turn', 'tool-call', 'error'])
    expect(trajectoryOverview(projected, failed, 7).failures).toBe(1)

    const withAggregate = [...failed, { seq: 8, time: 170, type: 'error', data: { turn: 1, message: 'aggregate failure diagnostic' } } as SessionEvent]
    const aggregateItems = projectTrajectory('parent', withAggregate)
    expect(aggregateItems.filter(item => item.status === 'error')).toHaveLength(4)
    expect(trajectoryOverview(aggregateItems, withAggregate, 8).failures).toBe(1)
  })
})
