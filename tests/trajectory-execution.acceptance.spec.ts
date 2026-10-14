import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { projectTrajectory, selectTrajectorySnapshots, trajectoryDetail, trajectoryOverview } from '../src/trajectory.ts'
import { layoutTrajectory, nodeKey } from '../src/client/trajectory-layout.ts'

// Native session event vocabulary, including sparse request headers and separate
// tool/call records. No model calls or real user data are needed for this replay.
function nativeExecution(): SessionEvent[] {
  const events: SessionEvent[] = []
  const append = (type: string, data: unknown) => {
    const seq = events.length + 1
    events.push({ seq, time: seq * 100, type, data } as SessionEvent)
  }
  const response = (step: number, id: string, content: unknown[]) => append('assistant/message', {
    turn: 1, step, message: { id, role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model' }, content },
  })
  const result = (step: number, id: string, callId: string, text: string, isError = false) => append('tool/result', {
    turn: 1, step,
    message: { id, role: 'tool', source: { kind: 'tool', callId }, content: [{ type: 'text', text }], isError },
  })
  append('turn/start', { turn: 1 })
  append('user/message', { id: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect both files, then check the result.' }] })
  append('step/start', { turn: 1, step: 1 })
  append('request/header', { reason: 'initial', header: { config: { provider: 'test', model: 'test-model' } } })
  response(1, 'response-1', [
    { type: 'text', text: 'First inspect both files.' },
    { type: 'tool-call', id: 'call-a', name: 'read', arguments: '{"path":"a.ts"}' },
    { type: 'tool-call', id: 'call-b', name: 'read', arguments: '{"path":"b.ts"}' },
  ])
  append('tool/call', { turn: 1, step: 1, callId: 'call-a', name: 'read', arguments: '{"path":"a.ts"}' })
  append('tool/call', { turn: 1, step: 1, callId: 'call-b', name: 'read', arguments: '{"path":"b.ts"}' })
  result(1, 'result-b', 'call-b', 'B returned first')
  result(1, 'result-a', 'call-a', 'A returned second')
  append('step/end', { turn: 1, step: 1 })
  append('step/start', { turn: 1, step: 2 })
  response(2, 'response-2', [
    { type: 'text', text: 'Next verify the combined result.' },
    // Shares a delegation alias but settles with a normal text result —
    // an unrelated tool that must NOT be classified by name (Task: name-
    // unconditional subagent classification fix).
    { type: 'tool-call', id: 'call-c', name: 'subagent', arguments: '{"prompt":"verify"}' },
    // Non-alias delegation name; its result carries the real alpha.2
    // activation identity (`started subagent <id>` rendered by tool-subagent's
    // output.render and persisted as the tool/result message content).
    { type: 'tool-call', id: 'call-d', name: 'delegate', arguments: '{"prompt":"spawn the check"}' },
  ])
  append('tool/call', { turn: 1, step: 2, callId: 'call-c', name: 'subagent', arguments: '{"prompt":"verify"}' })
  append('tool/call', { turn: 1, step: 2, callId: 'call-d', name: 'delegate', arguments: '{"prompt":"spawn the check"}' })
  result(2, 'result-c', 'call-c', 'Verification failed with useful evidence', true)
  append('tool/result', {
    turn: 1, step: 2,
    message: { id: 'result-d', role: 'tool', source: { kind: 'tool', callId: 'call-d' }, content: [{ type: 'text', text: 'started subagent child-9' }], isError: false },
  })
  append('step/end', { turn: 1, step: 2 })
  append('step/start', { turn: 1, step: 3 })
  response(3, 'response-3', [{ type: 'text', text: 'Final explanation of the failed verification.' }])
  append('step/end', { turn: 1, step: 3 })
  append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  append('user/message', { id: 'context', source: { kind: 'plugin', name: 'dsh-sidechat' }, content: [{ type: 'text', text: '[SideChat cite id=cite source=child message=m1]\nCited conclusion' }] })
  append('turn/start', { turn: 2 })
  append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  return events
}

describe('trajectory execution acceptance across projection and layout', () => {
  it('replays all three steps, pairs reversed results, and counts one logical failure', () => {
    const events = nativeExecution()
    const items = projectTrajectory('parent', events)
    const calls = items.filter(item => item.kind === 'tool-call' || item.kind === 'subagent')
    expect(calls).toHaveLength(4)
    // `call-c` shares the historical delegation name but settled with a normal
    // error text result: evidence, not the name, classifies subagents.
    expect(items.find(item => item.callId === 'call-c')).toMatchObject({ kind: 'tool-call', status: 'error' })
    // `call-d` settled with the real alpha.2 activation identity
    // (`started subagent <id>`), so it is classified as a subagent, and the
    // activation is start acceptance only — no success verdict.
    const delegated = items.find(item => item.callId === 'call-d')!
    expect(delegated.kind).toBe('subagent')
    expect(delegated.status).toBeUndefined()
    expect(calls.map(item => item.status)).toEqual(['success', 'success', 'error', undefined])
    const models = items.filter(item => item.kind === 'request')
    expect(models.map(item => item.step)).toEqual([1, 2, 3])
    expect(items.filter(item => item.kind === 'assistant')).toHaveLength(3)
    expect(items.find(item => item.kind === 'turn' && item.turn === 2)?.status).toBe('cancelled')
    expect(trajectoryOverview(items, events, events.length)).toMatchObject({ turns: 2, calls: 4, subagents: 1, failures: 1 })

    const subagent = calls.find(item => item.kind === 'subagent')!
    const graph = layoutTrajectory(items, new Set([1, 2]), new Set([nodeKey(subagent)]))
    const canonicalKeys = new Set(graph.nodes.filter(node => node.target === undefined).map(node => nodeKey(node.item)))
    expect(new Set(graph.nodes.map(node => nodeKey(node.item))).size).toBe(graph.nodes.length)
    expect(new Set(graph.groups.map(group => group.id)).size).toBe(graph.groups.length)
    for (const item of items) expect(canonicalKeys.has(nodeKey(item)), `missing ${nodeKey(item)}`).toBe(true)
    for (const call of calls) {
      const result = items.find(item => item.callId === call.callId && (item.kind === 'tool-result' || item.kind === 'error'))!
      expect(graph.edges.some(edge => edge.from === nodeKey(call) && edge.to === nodeKey(result))).toBe(true)
    }
    const positions = models.map(model => graph.nodes.find(node => nodeKey(node.item) === nodeKey(model))!.x)
    expect(positions[0]).toBeLessThan(positions[1]!)
    expect(positions[1]).toBeLessThan(positions[2]!)
    const reaches = (from: string, to: string): boolean => {
      const visited = new Set<string>()
      const pending = [from]
      while (pending.length > 0) {
        const key = pending.pop()!
        if (key === to) return true
        if (visited.has(key)) continue
        visited.add(key)
        pending.push(...graph.edges.filter(edge => edge.from === key).map(edge => edge.to))
      }
      return false
    }
    const secondRequest = models.find(item => item.step === 2)!
    for (const resultId of ['result-a', 'result-b']) {
      const result = items.find(item => item.eventId === resultId)!
      expect(reaches(nodeKey(result), nodeKey(secondRequest)), `${resultId} should feed the next step`).toBe(true)
    }
    expect(graph.nodes.some(node => /^SA · t/u.test(node.item.label))).toBe(false)
    // The expanded subagent (call-d) exposes one result alias pointing back at
    // its canonical activation result.
    const alias = graph.nodes.find(node => node.target?.eventId === 'result-d')!
    expect(alias).toBeDefined()
    expect(alias.role).toBe('subagent-result-alias')
    expect(graph.edges.some(edge => edge.from === nodeKey(subagent) && edge.to === nodeKey(alias.item))).toBe(true)
    expect(trajectoryDetail(items, events, alias.target!).text).toContain('started subagent child-9')
    const canonicalSelection = items.filter(item => item.turn === 1 && item.kind !== 'turn' && item.selectable)
    const snapshots = selectTrajectorySnapshots(items, events, canonicalSelection)
    expect(snapshots).toHaveLength(canonicalSelection.length)
    expect(snapshots.filter(item => item.eventId === 'result-c')).toHaveLength(1)
    expect(snapshots.some(item => item.text.includes('Next verify the combined result.'))).toBe(true)
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x).toBeLessThan(graph.width)
      expect(node.y).toBeLessThan(graph.height)
    }
    const collapsed = layoutTrajectory(items, new Set(), new Set())
    expect(new Set(collapsed.nodes.map(node => nodeKey(node.item))).size).toBe(collapsed.nodes.length)
    expect(new Set(collapsed.groups.map(group => group.id)).size).toBe(collapsed.groups.length)
    expect(collapsed.nodes.filter(node => node.item.kind === 'turn')).toHaveLength(2)
  })

  it('does not drop standalone results or notes lacking turn and step metadata', () => {
    const events = [
      { seq: 1, time: 100, type: 'tool/result', data: { id: 'orphan-result', content: 'standalone evidence' } },
      { seq: 2, time: 200, type: 'user/message', data: { id: 'fold-note', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[SideChat fold id=fold source=child rev=1]\nConclusion' }] } },
    ] as SessionEvent[]
    const items = projectTrajectory('parent', events)
    const graph = layoutTrajectory(items, new Set(), new Set())
    expect(graph.nodes.map(node => nodeKey(node.item))).toEqual(items.map(nodeKey))
    expect(graph.nodes.every(node => node.target === undefined)).toBe(true)
  })

  it('keeps historical append-origin evidence without drawing compaction replacements as execution', () => {
    const events = nativeExecution()
    const seq = events.length + 1
    // Real alpha.2 surfaceOp replace shape: `{ op: 'replace', startSeq, endSeq }`
    // (upstream packages/core/session/src/types.ts SurfaceOp) — startSeq/endSeq
    // reference earlier surface nodes. Here the compacted copy replaces the
    // original user message (seq 2).
    events.push({
      seq, time: seq * 100, type: 'user/message',
      surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 },
      data: { id: 'replacement-copy', source: { kind: 'user' }, content: [{ type: 'text', text: 'Compacted copy, not another human input.' }] },
    } as SessionEvent)
    const items = projectTrajectory('parent', events)
    expect(items.some(item => item.eventId === 'user')).toBe(true)
    expect(items.some(item => item.eventId === 'replacement-copy')).toBe(false)
    expect(items.filter(item => item.kind === 'turn')).toHaveLength(2)
  })

  it('counts a tool failure only once when its Turn also fails', () => {
    const events = nativeExecution().map(event => event.type === 'turn/end' && (event.data as { turn: number }).turn === 1
      ? { ...event, data: { turn: 1, reason: { kind: 'error', error: { message: 'Verification failed', code: 'UNKNOWN' } } } } as SessionEvent
      : event)
    const items = projectTrajectory('parent', events)
    expect(items.find(item => item.kind === 'turn' && item.turn === 1)?.status).toBe('error')
    expect(trajectoryOverview(items, events, events.length).failures).toBe(1)
  })

  it('does not invent multiple tool failures from one terminal failure with missing results', () => {
    const events = nativeExecution().filter(event => event.seq <= 7)
    events.push({ seq: 8, time: 800, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'Execution interrupted before results were logged', code: 'UNKNOWN' } } } } as SessionEvent)
    const items = projectTrajectory('parent', events)
    expect(items.filter(item => item.kind === 'tool-call').map(item => item.status)).toEqual([undefined, undefined])
    expect(trajectoryOverview(items, events, 8).failures).toBe(1)
  })
})
