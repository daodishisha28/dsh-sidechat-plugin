import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  DEFAULT_TRAJECTORY_CONTEXT_WINDOW_RATIO,
  DEFAULT_TRAJECTORY_FALLBACK_MAX_TOKENS,
  DEFAULT_TRAJECTORY_MAX_ITEMS,
  type TrajectoryChoice,
  type TrajectoryDetail,
  type TrajectoryOverview,
  type TrajectorySelectionBudgetPolicy,
} from '../types.ts'
import type { CommonInjected } from './components.tsx'
import { layoutTrajectory, nodeKey, type TrajectoryLayout, type TrajectoryLayoutEdge, type TrajectoryLayoutNode } from './trajectory-layout.ts'
import { onTrajectoryPanelRequest, showCommandWorkflow } from './workflow-events.ts'

type Props = PropsRuntime<'conversation.session.header.actions'> & CommonInjected
type Point = { x: number; y: number }
type LayoutNode = TrajectoryLayoutNode
type LayoutEdge = TrajectoryLayoutEdge
type LayoutGraph = TrajectoryLayout

const MIN_ZOOM = .5
const MAX_ZOOM = 2
const DEFAULT_HEIGHT = 320
const MIN_HEIGHT = 240
const MAX_HEIGHT = 560

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function duration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m${totalSeconds % 60}s`
  return `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60}m`
}

function kindClass(item: TrajectoryChoice): string {
  if (item.kind === 'turn') return 'turn'
  if (item.kind === 'fold-note') return 'foldnote'
  if (item.kind === 'user') return 'evt user'
  if (item.kind === 'request') return 'evt model'
  if (item.kind === 'assistant') return 'evt final'
  if (item.kind === 'subagent') return 'evt subagent'
  if (item.kind === 'error' || item.status === 'error') return 'evt call errcall'
  return 'evt call'
}

function typeLabel(item: TrajectoryChoice): string {
  if (item.kind === 'fold-note') return 'context'
  if (item.kind === 'request') return 'model'
  if (item.kind === 'tool-call') return 'call'
  if (item.kind === 'tool-result') return 'result'
  return item.kind
}

function statusText(item: TrajectoryChoice): string {
  return item.status ?? 'unknown'
}

function statusGlyph(item: TrajectoryChoice): string {
  if (item.status === 'error') return '✗'
  if (item.status === 'success') return '✓'
  if (item.status === 'running') return '…'
  if (item.status === 'cancelled') return '■'
  return '·'
}

function details(item: TrajectoryChoice, all: readonly TrajectoryChoice[]): readonly [string, string][] {
  const belonging = item.turn === undefined ? 'Session' : `Turn ${item.turn} · 主 agent`
  const projection: [string, string] = item.fullContentAvailable
    ? ['内容', item.truncated ? '工具原文 · 列表预览已截断' : '工具原文 · 未脱敏']
    : ['投影', `Host 投影 · ${item.redacted ? '已脱敏 ✓' : '无敏感字段'}`]
  if (item.kind === 'turn') {
    const members = all.filter(candidate => candidate.turn === item.turn && candidate.kind !== 'turn')
    const calls = members.filter(candidate => candidate.kind === 'tool-call' || candidate.kind === 'subagent')
    return [
      ['seq 范围', `#${Math.min(...members.map(value => value.seq), item.seq)} – #${Math.max(...members.map(value => value.seq), item.seq)}`],
      ['耗时', duration(item.durationMs ?? 0)],
      ['工具调用', `${calls.length}（${calls.filter(value => value.parallelGroup !== undefined).length} 同批标记 · ${calls.filter(value => value.kind === 'subagent').length} subagent）`],
      ['digest', `${item.digest.slice(0, 6)}…${item.digest.slice(-4)}`], projection,
      ['状态', statusText(item)],
    ]
  }
  const common: [string, string][] = [['seq', `#${item.seq}`], ['所属', belonging]]
  if (item.kind === 'user' || item.kind === 'assistant') return [...common, ['字符/token', `${item.chars.toLocaleString()} / ≈${item.estimatedTokens.toLocaleString()}`], projection, ['状态', statusText(item)]]
  if (item.kind === 'request') return [...common, ['模型名', item.model ?? item.label], ['token in/out', 'provider usage 不可得'], ['耗时', duration(item.durationMs ?? 0)], ['digest', `${item.digest.slice(0, 6)}…${item.digest.slice(-4)}`], projection]
  if (item.kind === 'subagent') return [...common, ['子 agent', item.toolName ?? item.label], ['子 turns', item.childTurns === undefined ? '未知（未提供子轨迹）' : String(item.childTurns)], ['耗时', duration(item.durationMs ?? 0)], ['digest', `${item.digest.slice(0, 6)}…${item.digest.slice(-4)}`], projection, ['状态', statusText(item)]]
  if (item.kind === 'fold-note') return [...common, ['状态', statusText(item)], ['说明', item.selectable ? 'SideChat 回流上下文 · 可作为轨迹背景选择 · 不触发父模型调用' : '只读注释 · 不触发父模型调用']]
  return [...common, ['耗时', duration(item.durationMs ?? 0)], ['digest', `${item.digest.slice(0, 6)}…${item.digest.slice(-4)}`], projection, ['批次', item.parallelGroup ?? '—'], ['状态', statusText(item)]]
}

function EdgeLayer({ edges, selected, elements, width, height }: { edges: readonly LayoutEdge[]; selected: ReadonlySet<string>; elements: React.MutableRefObject<Map<string, HTMLElement>>; width: number; height: number }) {
  const [paths, setPaths] = useState<readonly { edge: LayoutEdge; d: string; label: Point }[]>([])
  useLayoutEffect(() => {
    const calculate = () => setPaths(edges.flatMap(edge => {
      const from = elements.current.get(edge.from)
      const to = elements.current.get(edge.to)
      if (from === undefined || to === undefined) return []
      const a = { x: from.offsetLeft + from.offsetWidth / 2, y: from.offsetTop + from.offsetHeight / 2 }
      const b = { x: to.offsetLeft + to.offsetWidth / 2, y: to.offsetTop + to.offsetHeight / 2 }
      const bend = Math.max(54, Math.abs(b.x - a.x) * .45)
      const sameColumn = from.offsetLeft === to.offsetLeft
      // Step groups stack events vertically. A call/result pair in one group
      // must leave the cards through their side ports, otherwise its line
      // would run through every intervening event card.
      const rightPort = sameColumn
        ? Math.max(...[...elements.current.values()].filter(element => element.offsetLeft === from.offsetLeft && ((element.offsetTop >= Math.min(from.offsetTop, to.offsetTop) && element.offsetTop <= Math.max(from.offsetTop, to.offsetTop)) || element === from || element === to)).map(element => element.offsetLeft + element.offsetWidth)) + 22
        : 0
      const d = sameColumn
        ? `M ${from.offsetLeft + from.offsetWidth} ${a.y} H ${rightPort} V ${b.y} H ${to.offsetLeft + to.offsetWidth}`
        : edge.curved ? `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
      return [{ edge, d, label: { x: sameColumn ? rightPort : (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 5 } }]
    }))
    calculate()
    const Observer = globalThis.ResizeObserver
    window.addEventListener('resize', calculate)
    if (Observer === undefined) return () => { window.removeEventListener('resize', calculate) }
    const observer = new Observer(calculate)
    for (const element of elements.current.values()) observer.observe(element)
    return () => { observer.disconnect(); window.removeEventListener('resize', calculate) }
  }, [edges, elements])
  return <svg className="dsh-trajectory-edges" width={width} height={height} aria-hidden="true">
    {paths.map(({ edge, d, label }) => {
      const active = selected.has(edge.from) && selected.has(edge.to)
      return <g key={edge.id}><path className={active ? 'is-selected' : ''} d={d} strokeDasharray={edge.dashed ? '6 5' : undefined} />{edge.label !== undefined && <text x={label.x} y={label.y}>{edge.label}</text>}</g>
    })}
  </svg>
}

export function TrajectoryPanel({ sessionId, api }: Props) {
  const [overview, setOverview] = useState<TrajectoryOverview | null>(null)
  const [items, setItems] = useState<readonly TrajectoryChoice[]>([])
  const [capturedThroughSeq, setCapturedThroughSeq] = useState(0)
  const [selectionBudgetPolicy, setSelectionBudgetPolicy] = useState<TrajectorySelectionBudgetPolicy>({
    contextWindowRatio: DEFAULT_TRAJECTORY_CONTEXT_WINDOW_RATIO,
    fallbackMaxTokens: DEFAULT_TRAJECTORY_FALLBACK_MAX_TOKENS,
    maxItems: DEFAULT_TRAJECTORY_MAX_ITEMS,
  })
  const [open, setOpen] = useState(false)
  const [panelHeight, setPanelHeight] = useState(() => {
    const stored = globalThis.localStorage?.getItem('dsh-sidechat-trajectory-height')
    if (stored === undefined || stored === null) return DEFAULT_HEIGHT
    const saved = Number(stored)
    return Number.isFinite(saved) ? clamp(saved, MIN_HEIGHT, MAX_HEIGHT) : DEFAULT_HEIGHT
  })
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [selectedListOpen, setSelectedListOpen] = useState(false)
  const [focused, setFocused] = useState<TrajectoryChoice | null>(null)
  const [focusedNodeKey, setFocusedNodeKey] = useState<string | null>(null)
  const [focusedDetail, setFocusedDetail] = useState<{ key: string; value?: TrajectoryDetail; error?: string } | null>(null)
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(() => new Set())
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => new Set())
  const [locateKey, setLocateKey] = useState<string | null>(null)
  const [flashing, setFlashing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bridgeRef = useRef<HTMLSpanElement>(null)
  const tabActionsRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounts, setMounts] = useState<{ tabs: HTMLElement; column: HTMLElement; top: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const drag = useRef<{ origin: Point; pan: Point } | null>(null)
  const resizedHeight = useRef(panelHeight)

  useLayoutEffect(() => {
    const bridge = bridgeRef.current
    const header = bridge?.closest('header')
    const tabs = header?.querySelector<HTMLElement>('[role="tablist"]')
    const column = header?.parentElement
    if (header === undefined || header === null || tabs === undefined || tabs === null || column === undefined || column === null) return undefined
    const update = () => {
      const columnRect = column.getBoundingClientRect()
      const tabsRect = tabs.getBoundingClientRect()
      const top = tabsRect.bottom - columnRect.top
      setMounts(current => current?.tabs === tabs && current.column === column && current.top === top ? current : { tabs, column, top })
    }
    update()
    window.addEventListener('resize', update)
    const Observer = globalThis.ResizeObserver
    if (Observer === undefined) return () => { window.removeEventListener('resize', update) }
    const observer = new Observer(update)
    observer.observe(header)
    observer.observe(tabs)
    observer.observe(column)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [sessionId])

  const reload = useCallback(() => {
    const abort = new AbortController()
    void Promise.all([api.trajectoryOverview(sessionId, abort.signal), api.trajectoryItems(sessionId, abort.signal)]).then(([nextOverview, nextItems]) => {
      setOverview(nextOverview)
      setItems(nextItems.items)
      setCapturedThroughSeq(nextItems.capturedThroughSeq)
      setSelectionBudgetPolicy(nextItems.selectionBudgetPolicy)
      setError(null)
    }, reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { abort.abort() }
  }, [api, sessionId])

  useEffect(() => reload(), [reload])
  useEffect(() => {
    if (focused === null || !focused.fullContentAvailable) return undefined
    const abort = new AbortController()
    const key = nodeKey(focused)
    void api.trajectoryDetail(sessionId, {
      seq: focused.seq,
      eventId: focused.eventId,
      kind: focused.kind,
      digest: focused.digest,
    }, abort.signal).then(
      value => { if (!abort.signal.aborted) setFocusedDetail({ key, value }) },
      reason => { if (!abort.signal.aborted) setFocusedDetail({ key, error: reason instanceof Error ? reason.message : String(reason) }) },
    )
    return () => { abort.abort() }
  }, [api, focused, sessionId])
  useEffect(() => onTrajectoryPanelRequest(sessionId, () => { setOpen(true); reload() }), [reload, sessionId])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !open) return
      if (document.querySelector('.dsh-sidechat-workflow') !== null) return
      if (focused !== null) { setFocused(null); setFocusedNodeKey(null); setFocusedDetail(null); return }
      setOpen(false)
    }
    window.addEventListener('keydown', keydown)
    return () => { window.removeEventListener('keydown', keydown) }
  }, [focused, open])
  useEffect(() => {
    if (!open) return undefined
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (tabActionsRef.current?.contains(target) === true || panelRef.current?.contains(target) === true) return
      const targetElement = target instanceof Element ? target : target.parentElement
      if (targetElement?.closest('.dsh-sidechat-dialog-backdrop') !== null) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => { document.removeEventListener('pointerdown', outside, true) }
  }, [open])

  const graph = useMemo<LayoutGraph>(() => layoutTrajectory(items, expandedTurns, expandedAgents), [expandedAgents, expandedTurns, items])
  const selectedItems = items.filter(item => selected.has(nodeKey(item)) && item.selectable)
  const selectedChars = selectedItems.reduce((sum, item) => sum + item.chars, 0)
  const selectedTokens = selectedItems.reduce((sum, item) => sum + item.estimatedTokens, 0)
  const budgetRatio = Math.round(selectionBudgetPolicy.contextWindowRatio * 100)
  const fallbackBudgetLabel = selectionBudgetPolicy.fallbackMaxTokens % 1_000 === 0
    ? `${selectionBudgetPolicy.fallbackMaxTokens / 1_000}k`
    : selectionBudgetPolicy.fallbackMaxTokens.toLocaleString()
  const selectionByTurn = new Map<number, number>()
  for (const item of selectedItems) if (item.turn !== undefined) selectionByTurn.set(item.turn, (selectionByTurn.get(item.turn) ?? 0) + 1)
  const selectableChildrenByTurn = new Map<number, readonly TrajectoryChoice[]>()
  for (const turnItem of items) {
    if (turnItem.kind !== 'turn' || turnItem.turn === undefined) continue
    selectableChildrenByTurn.set(turnItem.turn, items.filter(item => item.turn === turnItem.turn && item.kind !== 'turn' && item.selectable))
  }
  const selectionKeys = (item: TrajectoryChoice): readonly string[] => {
    if (item.kind !== 'turn' || item.turn === undefined) return [nodeKey(item)]
    const children = selectableChildrenByTurn.get(item.turn) ?? []
    return children.length === 0 ? [nodeKey(item)] : children.map(nodeKey)
  }
  const isItemSelected = (item: TrajectoryChoice): boolean => {
    const keys = selectionKeys(item)
    return keys.length > 0 && keys.every(key => selected.has(key))
  }
  const graphSelection = new Set(selected)
  for (const item of items) if (item.kind === 'turn' && isItemSelected(item)) graphSelection.add(nodeKey(item))
  for (const node of graph.nodes) if (node.target !== undefined && isItemSelected(node.target)) graphSelection.add(nodeKey(node.item))

  useLayoutEffect(() => {
    if (locateKey === null) return
    const node = graph.nodes.find(candidate => nodeKey(candidate.item) === locateKey || (candidate.target !== undefined && nodeKey(candidate.target) === locateKey))
    const canvas = canvasRef.current
    if (node === undefined || canvas === null) return
    const element = elements.current.get(nodeKey(node.item))
    const nodeWidth = element?.offsetWidth ?? 150
    const nodeHeight = element?.offsetHeight ?? 64
    setPan({ x: canvas.clientWidth / 2 - (node.x + nodeWidth / 2) * scale, y: canvas.clientHeight / 2 - (node.y + nodeHeight / 2) * scale })
    setFlashing(nodeKey(node.item))
    setLocateKey(null)
    window.setTimeout(() => setFlashing(current => current === nodeKey(node.item) ? null : current), 220)
  }, [graph, locateKey, scale])

  const toggleSelection = (item: TrajectoryChoice, flash = false) => {
    if (!item.selectable) return
    const key = nodeKey(item)
    const keys = selectionKeys(item)
    setSelected(current => {
      const next = new Set(current)
      const remove = keys.every(candidate => current.has(candidate))
      for (const candidate of keys) if (remove) next.delete(candidate); else next.add(candidate)
      return next
    })
    if (flash) { setFlashing(key); window.setTimeout(() => { setFlashing(current => current === key ? null : current) }, 180) }
  }
  const toggleTurn = (turn: number) => setExpandedTurns(current => { const next = new Set(current); if (next.has(turn)) next.delete(turn); else next.add(turn); return next })
  const fit = () => {
    if (graph.nodes.length === 0) return
    const canvas = canvasRef.current
    if (canvas === null) return
    const nextScale = clamp(Math.min((canvas.clientWidth - 48) / graph.width, (canvas.clientHeight - 48) / graph.height), MIN_ZOOM, 1)
    setScale(nextScale)
    setPan({ x: Math.max(20, (canvas.clientWidth - graph.width * nextScale) / 2), y: Math.max(12, (canvas.clientHeight - graph.height * nextScale) / 2) })
  }
  const zoomAt = (next: number, point?: Point) => {
    if (graph.nodes.length === 0) return
    const target = clamp(next, MIN_ZOOM, MAX_ZOOM)
    const anchor = point ?? { x: (canvasRef.current?.clientWidth ?? 0) / 2, y: (canvasRef.current?.clientHeight ?? 0) / 2 }
    setPan(current => ({ x: anchor.x - (anchor.x - current.x) * target / scale, y: anchor.y - (anchor.y - current.y) * target / scale }))
    setScale(target)
  }
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (graph.nodes.length === 0) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    zoomAt(scale * (event.deltaY > 0 ? .9 : 1.1), { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }
  const inspectItem = (item: TrajectoryChoice) => {
    setFocused(item)
    setFocusedNodeKey(nodeKey(item))
    setFocusedDetail(item.fullContentAvailable ? { key: nodeKey(item) } : null)
  }
  const locateItem = (item: TrajectoryChoice) => {
    if (item.turn !== undefined) setExpandedTurns(current => new Set(current).add(item.turn!))
    // Locating is also a view action: keep the detail pane and its request
    // pointer in sync with the node being highlighted.
    inspectItem(item)
    setLocateKey(nodeKey(item))
  }
  const removeItem = (item: TrajectoryChoice) => {
    const keys = selectionKeys(item)
    setSelected(current => {
      const next = new Set(current)
      for (const key of keys) next.delete(key)
      return next
    })
  }
  const onNodeClick = (event: ReactMouseEvent, item: TrajectoryChoice, target = item, role?: LayoutNode['role']) => {
    event.stopPropagation()
    if (event.ctrlKey) { toggleSelection(target, true); return }
    const detailItem = role === 'subagent-result-placeholder'
      ? { ...(target === item ? item : { ...target, label: item.label }), status: undefined }
      : target === item ? item : { ...target, label: item.label }
    inspectItem(detailItem)
    setFocusedNodeKey(nodeKey(item))
  }
  const resizeStart = (event: ReactMouseEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = panelHeight
    const move = (next: MouseEvent) => { const height = clamp(startHeight + next.clientY - startY, MIN_HEIGHT, MAX_HEIGHT); resizedHeight.current = height; setPanelHeight(height) }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); globalThis.localStorage?.setItem('dsh-sidechat-trajectory-height', String(resizedHeight.current)) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const ask = () => {
    if (selectedItems.length === 0) return
    showCommandWorkflow({
      kind: 'permission-choice', sessionId, seedMode: 'trajectory',
      trajectoryItems: selectedItems,
      trajectorySelection: { sourceSessionId: sessionId, capturedThroughSeq, refs: selectedItems.map(item => ({ seq: item.seq, eventId: item.eventId, kind: item.kind, digest: item.digest })) },
    })
  }
  const style = { transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`, width: graph.width, height: graph.height } satisfies CSSProperties
  const hasGraph = graph.nodes.length > 0
  const hasOverview = overview !== null && (overview.turns > 0 || overview.calls > 0 || overview.subagents > 0 || overview.failures > 0)
  const focusedContent = focused === null ? '' : focusedDetail?.key === nodeKey(focused) && focusedDetail.value !== undefined
    ? focusedDetail.value.text
    : focused.preview
  const triggerLabel = overview === null ? '轨迹速览 · 读取中…' : hasOverview ? `轨迹速览 · ${overview.turns} turns · ${overview.calls} calls · ${overview.subagents} subagent · ${overview.failures} 失败` : '轨迹速览 · 暂无数据'
  const toggleOpen = () => { if (!open) reload(); setOpen(value => !value) }

  const trigger = mounts === null ? null : createPortal(<div ref={tabActionsRef} className="dsh-trajectory-tab-actions">
    <button className="dsh-trajectory-mini-button" type="button" onClick={() => { reload(); setOpen(true); window.setTimeout(fit, 0) }}>完整分析 ↗</button>
    {open && <button className="dsh-trajectory-mini-button" type="button" onClick={() => { setOpen(false) }}>收起 ▴</button>}
    <button className={`dsh-trajectory-trigger${open ? ' is-on' : ''}${overview !== null && !hasOverview ? ' is-empty' : ''}`} type="button" aria-expanded={open} aria-label={triggerLabel} onClick={toggleOpen}>
      <span className="dsh-trajectory-chevron" aria-hidden="true">▶</span><strong>轨迹速览</strong><span aria-hidden="true">·</span>
      {overview === null ? <span>读取中…</span> : hasOverview ? <><span>{overview.turns} turns</span><span aria-hidden="true">·</span><span>{overview.calls} calls</span><span aria-hidden="true">·</span><span>{overview.subagents} subagent</span><span aria-hidden="true">·</span><span className={overview.failures > 0 ? 'dsh-trajectory-failure' : ''}>{overview.failures}</span><span>失败</span></> : <span>暂无数据</span>}
    </button>
  </div>, mounts.tabs)

  const overlay = mounts === null || !open ? null : createPortal(<div ref={panelRef} className="dsh-trajectory-panel" style={{ height: panelHeight, top: mounts.top }} aria-label="轨迹速览面板">
      <div className="dsh-trajectory-toolbar"><span>轨迹</span>
        <button type="button" disabled={!hasGraph} onClick={() => { zoomAt(scale - .1) }}>−</button><button type="button" disabled={!hasGraph} className="is-on">{Math.round(scale * 100)}%</button><button type="button" disabled={!hasGraph} onClick={() => { zoomAt(scale + .1) }}>＋</button>
        <button type="button" disabled={!hasGraph} onClick={fit}>⤢ 适应视图</button><button type="button" disabled={!hasGraph} onClick={() => { setExpandedTurns(new Set()); setExpandedAgents(new Set()) }}>全部收起</button>
        <div className="dsh-trajectory-legend"><span><i className="user" />User</span><span><i className="model" />Model</span><span><i className="call" />Call</span><span><i className="subagent" />Subagent</span><span><i className="final" />Final</span><span><i className="error" />Error</span></div>
      </div>
      {error !== null ? <div className="dsh-trajectory-load-error" role="alert">{error}<button type="button" onClick={reload}>重试</button></div> : <div className="dsh-trajectory-body">
        <div ref={canvasRef} className="dsh-trajectory-canvas" onWheel={onWheel} onMouseDown={event => { if (event.target !== event.currentTarget) return; drag.current = { origin: { x: event.clientX, y: event.clientY }, pan } }} onMouseMove={event => { if (drag.current === null) return; setPan({ x: drag.current.pan.x + event.clientX - drag.current.origin.x, y: drag.current.pan.y + event.clientY - drag.current.origin.y }) }} onMouseUp={() => { drag.current = null }} onMouseLeave={() => { drag.current = null }}>
          {hasGraph ? <><div className="dsh-trajectory-world" style={style}>
            {graph.groups.map(group => {
              const title = group.label === 'Unscoped events' ? '未分配步骤' : group.label === 'Session event' ? '会话事件' : group.label.replace(/ events$/u, ' 事件')
              const type = group.kind === 'turn' ? 'Turn' : group.kind === 'step' ? 'Step' : 'Session'
              const displayTitle = `${title} · ${type}`
              return <div key={group.id} className={`dsh-trajectory-step-heading kind-${group.kind}`} role="heading" aria-level={4} style={{ left: group.x, top: group.y, width: group.width, height: group.height }}><strong>{displayTitle}</strong><span>{type}</span></div>
            })}
            {graph.nodes.map(({ item, x, y, depth, target, role }) => {
              const selectionItem = target ?? item
              const turnSelected = item.turn === undefined ? 0 : selectionByTurn.get(item.turn) ?? 0
              const turnChildren = item.kind === 'turn' && item.turn !== undefined ? selectableChildrenByTurn.get(item.turn) ?? [] : []
              const turnRealNodes = item.kind === 'turn' && item.turn !== undefined ? items.filter(candidate => candidate.turn === item.turn && candidate.kind !== 'turn') : []
              const itemSelected = isItemSelected(selectionItem)
              const turnPartial = item.kind === 'turn' && turnSelected > 0 && !itemSelected
              const key = nodeKey(item)
              const expanded = item.kind === 'turn' ? expandedTurns.has(item.turn!) : item.kind === 'subagent' && expandedAgents.has(key)
              const turnSelectionMeta = item.kind === 'turn' && itemSelected ? (turnChildren.length > 0 ? `全部 ${turnChildren.length} 项已选` : 'Turn 已选') : turnPartial ? `已选 ${turnSelected} / ${turnChildren.length} 项` : ''
              const turnMeta = item.kind === 'turn' && !expanded && turnRealNodes.length > 0
                ? `折叠 · 隐藏 ${turnRealNodes.length} 个真实节点${turnSelectionMeta === '' ? '' : ` · ${turnSelectionMeta}`}`
                : turnSelectionMeta === '' ? `${role === 'subagent-result-placeholder' ? '·' : statusGlyph(item)} ${item.durationMs === undefined ? `seq ${item.seq}` : duration(item.durationMs)}${item.kind === 'subagent' ? ` · ${item.childTurns === undefined ? '未知' : `${item.childTurns} turns`}` : ''}` : turnSelectionMeta
              const displayLabel = role === 'subagent-result-alias' ? `返回 ${statusGlyph(target ?? item)}` : item.label
              const classes = ['dsh-trajectory-node', ...kindClass(item).split(' '), itemSelected ? 'is-selected' : '', focusedNodeKey === key ? 'is-viewing' : '', flashing === key ? 'is-flashing' : '', turnPartial ? 'has-selection' : '', expanded ? 'is-expanded' : '', depth === undefined ? '' : `depth-${depth}`].filter(Boolean).join(' ')
              const toggleAgent = () => setExpandedAgents(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
              return <article ref={element => { if (element === null) elements.current.delete(key); else elements.current.set(key, element) }} key={key} className={classes} style={{ left: x, top: y }} onClick={event => { onNodeClick(event, { ...item, label: displayLabel }, selectionItem, role) }} onDoubleClick={event => { event.stopPropagation(); if (item.kind === 'turn') toggleTurn(item.turn!); else if (item.kind === 'subagent' && target === undefined) toggleAgent() }}>
                <div className="dsh-trajectory-node-type">{typeLabel(item)}</div><div className="dsh-trajectory-node-name">{displayLabel}{item.status === 'error' && <span className="dsh-trajectory-badge-error">err</span>}{(item.kind === 'turn' || item.kind === 'subagent') && <button type="button" aria-label={expanded ? '收起节点' : '展开节点'} onClick={event => { event.stopPropagation(); if (item.kind === 'turn') toggleTurn(item.turn!); else toggleAgent() }}>{expanded ? '▾' : '▸'}</button>}</div>
                <div className={`dsh-trajectory-node-meta${item.kind === 'turn' && (turnSelected > 0 || itemSelected) ? ' selection-note' : ''}`}>{turnMeta}</div>
              </article>
            })}
            <EdgeLayer edges={graph.edges} selected={graphSelection} elements={elements} width={graph.width} height={graph.height} />
          </div><div className="dsh-trajectory-canvas-hint">拖动平移 · 滚轮缩放 · Ctrl+点击 = 直接选中</div></> : <div className="dsh-trajectory-empty">暂无轨迹事件 · 会话产生首个 turn 后此处自动生成轨迹图</div>}
        </div>
        {focused !== null && <aside className="dsh-trajectory-detail"><header><span className={`kind-${focused.kind}`}>{typeLabel(focused)}</span><strong>{focused.label}</strong><button type="button" aria-label="关闭详情" onClick={() => { setFocused(null); setFocusedNodeKey(null); setFocusedDetail(null) }}>×</button></header><dl>{details(focused, items).map(([key, value]) => <div key={key}><dt>{key}</dt><dd className={key === '状态' && value === 'error' ? 'is-error' : ''}>{value}</dd></div>)}</dl>{focused.fullContentAvailable && <div className="dsh-trajectory-sensitive-notice">工具原文可能包含 API key、Cookie、环境变量或本机路径，请在加入 SideChat 前确认内容。</div>}<div className="dsh-trajectory-detail-body">{focusedDetail?.key === nodeKey(focused) && focusedDetail.error !== undefined && <div className="dsh-trajectory-detail-error" role="alert">完整内容加载失败：{focusedDetail.error}</div>}{focusedDetail?.key === nodeKey(focused) && focusedDetail.value === undefined && focusedDetail.error === undefined && <div className="dsh-trajectory-detail-loading">正在读取完整工具内容…</div>}<pre>{focusedContent}</pre></div><footer><button className="dsh-trajectory-secondary-button" type="button" onClick={() => { void navigator.clipboard?.writeText(focusedContent) }}>复制</button>{focused.selectable && <button className={isItemSelected(focused) ? 'dsh-trajectory-selected-button' : 'dsh-trajectory-primary-button'} type="button" onClick={() => { toggleSelection(focused) }}>{isItemSelected(focused) ? '✓ 已选择 · 点击取消' : '选择此项'}</button>}</footer></aside>}
      </div>}
      {selectedListOpen && <section id="dsh-trajectory-selected-list" className="dsh-trajectory-selected-list" aria-label="已选轨迹项目">
        <header><strong>已选项目</strong><span>所有实际事件 · {selectedItems.length} 项</span></header>
        {selectedItems.length === 0 ? <p>暂无已选项目</p> : <ol>
          {selectedItems.map(item => <li key={nodeKey(item)}>
            <button type="button" className="dsh-trajectory-selected-item" aria-label={`查看 ${item.label}`} onClick={() => inspectItem(item)}><span>{item.label}</span><small>#{item.seq} · {typeLabel(item)}</small></button>
            <button type="button" className="dsh-trajectory-list-action" aria-label={`定位 ${item.label}`} onClick={() => locateItem(item)}>⌖</button>
            <button type="button" className="dsh-trajectory-list-action is-remove" aria-label={`移除 ${item.label}`} onClick={() => removeItem(item)}>×</button>
          </li>)}
        </ol>}
      </section>}
      <div className="dsh-trajectory-selection-bar"><span>已选择 <b>{selectedItems.length} 项</b></span><span className={selectedTokens > selectionBudgetPolicy.fallbackMaxTokens ? 'is-warning' : ''}>{selectedChars.toLocaleString()} chars · ≈{selectedTokens.toLocaleString()} token（创建时限额：目标模型上下文 {budgetRatio}%；不可读取时 {fallbackBudgetLabel}）{selectedTokens > selectionBudgetPolicy.fallbackMaxTokens ? ' ⚠' : ''}</span><span className="spacer" /><span className="hint"><kbd>Ctrl</kbd>+点击 快速增删选择</span><button className="dsh-trajectory-secondary-button dsh-trajectory-list-toggle" type="button" aria-expanded={selectedListOpen} aria-controls="dsh-trajectory-selected-list" onClick={() => { setSelectedListOpen(value => !value) }}>{selectedListOpen ? '隐藏已选项目' : `查看已选项目（${selectedItems.length}）`}</button><button className="dsh-trajectory-secondary-button" type="button" disabled={selectedItems.length === 0} onClick={() => { setSelected(new Set()) }}>清除</button><button className="dsh-trajectory-primary-button" type="button" disabled={selectedItems.length === 0} onClick={ask}>基于所选轨迹提问 →</button></div>
      <div className="dsh-trajectory-resizer" role="separator" aria-orientation="horizontal" onMouseDown={resizeStart} />
    </div>, mounts.column)

  return <><span ref={bridgeRef} className="dsh-trajectory-mount-bridge" aria-hidden="true" />{trigger}{overlay}</>
}
