import type { TrajectoryChoice } from '../types.ts'

/**
 * The layout deliberately keeps the projected choice as the source of truth.
 * Only the optional alias/placeholder nodes are layout-only nodes; `target` on
 * an alias points back to the canonical projected choice that is selectable.
 */
export interface TrajectoryLayoutNode {
  readonly item: TrajectoryChoice
  readonly x: number
  readonly y: number
  readonly depth?: number
  readonly target?: TrajectoryChoice
  readonly role?: 'canonical' | 'subagent-result-alias' | 'subagent-result-placeholder'
}

export interface TrajectoryLayoutEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly dashed?: boolean
  readonly label?: string
  readonly curved?: boolean
}

export type TrajectoryLayoutGroupKind = 'turn' | 'step' | 'session'

/** A visual heading/band. It is metadata only and is never a selectable event. */
export interface TrajectoryLayoutGroup {
  readonly id: string
  readonly kind: TrajectoryLayoutGroupKind
  readonly label: string
  readonly turn?: number
  readonly step?: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TrajectoryLayout {
  readonly nodes: TrajectoryLayoutNode[]
  readonly edges: TrajectoryLayoutEdge[]
  readonly groups: TrajectoryLayoutGroup[]
  readonly width: number
  readonly height: number
}

// Short aliases keep the contract convenient for the panel while the longer
// names make declaration output self-documenting for other consumers.
export type LayoutNode = TrajectoryLayoutNode
export type LayoutEdge = TrajectoryLayoutEdge
export type LayoutGroup = TrajectoryLayoutGroup

/** Stable visual identity for canonical choices and layout-only aliases. */
export function nodeKey(item: TrajectoryChoice): string {
  return `${item.seq}:${item.eventId}:${item.kind}`
}

const NODE_WIDTH = 190
const NODE_HEIGHT = 88
const COLUMN_GAP = 54
const COLUMN_PITCH = NODE_WIDTH + COLUMN_GAP
const ROW_PITCH = 98
const TOP = 24
const TURN_WIDTH = 190
const MIN_WIDTH = 720
const MIN_HEIGHT = 320

type IndexedChoice = { readonly item: TrajectoryChoice; readonly index: number }
type Placement = {
  readonly item: TrajectoryChoice
  readonly node: TrajectoryLayoutNode
  readonly index: number
  readonly unitId: string
  readonly groupId?: string
}
type StepPlan = {
  readonly id: string
  readonly unitId: string
  readonly kind: 'step'
  readonly label: string
  readonly turn?: number
  readonly step?: number
  readonly items: readonly IndexedChoice[]
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}
type UnitPlan = {
  readonly id: string
  readonly kind: 'turn' | 'session'
  readonly turn?: number
  readonly item?: IndexedChoice
  readonly items: readonly IndexedChoice[]
  readonly expanded: boolean
  readonly x: number
  readonly width: number
  readonly firstSeq: number
  readonly stepPlans: readonly StepPlan[]
  readonly firstKey?: string
  readonly lastKey?: string
  readonly anchorKey: string
}

function compareIndexed(left: IndexedChoice, right: IndexedChoice): number {
  return left.item.seq - right.item.seq || left.index - right.index
}

function compareUnit(left: UnitPlan, right: UnitPlan): number {
  return left.firstSeq - right.firstSeq || left.id.localeCompare(right.id)
}

function isCall(item: TrajectoryChoice): boolean {
  return item.kind === 'tool-call' || item.kind === 'subagent'
}

function isResult(item: TrajectoryChoice): boolean {
  return item.kind === 'tool-result' || item.kind === 'error'
}

function sameScope(left: TrajectoryChoice, right: TrajectoryChoice): boolean {
  return left.turn === right.turn
}

function safeDigest(seed: string): string {
  // Layout-only placeholders never enter a detail/selection request. A stable
  // non-empty digest is nevertheless useful to callers that inspect a node.
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `layout-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function unavailableSubagentResult(call: TrajectoryChoice, usedKeys: ReadonlySet<string>): TrajectoryChoice {
  const preview = '内部轨迹未加载（internal trace not loaded）：no tool result matched this subagent call.'
  let eventId = `${call.eventId}:result-unavailable`
  let suffix = 2
  while (usedKeys.has(nodeKey({ ...call, eventId, kind: 'fold-note' }))) {
    eventId = `${call.eventId}:result-unavailable:${suffix}`
    suffix += 1
  }
  const placeholder: TrajectoryChoice = {
    ...call,
    eventId,
    kind: 'fold-note',
    label: '内部轨迹未加载 / internal trace not loaded',
    preview,
    chars: preview.length,
    estimatedTokens: Math.ceil(preview.length / 4),
    redacted: false,
    truncated: false,
    fullContentAvailable: false,
    selectable: false,
    digest: safeDigest(`${nodeKey(call)}:result-unavailable`),
  }
  // A missing result is not a successful child. Leave status absent so a
  // consumer can render this as unknown/not-loaded rather than success.
  delete placeholder.status
  return placeholder
}

function aliasForSubagentResult(call: TrajectoryChoice, target: TrajectoryChoice, usedKeys: ReadonlySet<string>): TrajectoryChoice {
  let eventId = `${target.eventId}:alias:${call.eventId}`
  let suffix = 2
  while (usedKeys.has(nodeKey({ ...target, eventId }))) {
    eventId = `${target.eventId}:alias:${call.eventId}:${suffix}`
    suffix += 1
  }
  return {
    ...target,
    eventId,
    label: target.status === 'success'
      ? '返回 ✓'
      : target.status === 'error'
        ? '返回 ✗'
        : target.status === 'cancelled'
          ? '返回（已取消）'
          : target.status === 'running'
            ? '返回（运行中）'
            : '返回（状态未知）',
  }
}

function matchedSubagentResult(
  call: TrajectoryChoice,
  indexedItems: readonly IndexedChoice[],
): IndexedChoice | undefined {
  if (call.callId === undefined) return undefined
  const callIndex = indexedItems.find(candidate => candidate.item === call)?.index ?? -1
  return indexedItems
    .filter(candidate => isResult(candidate.item)
      && candidate.item.callId === call.callId
      && sameScope(candidate.item, call)
      && (candidate.item.seq > call.seq || (candidate.item.seq === call.seq && candidate.index > callIndex)))
    .sort(compareIndexed)[0]
}

function groupItemsByStep(items: readonly IndexedChoice[], turn: number | undefined, unitId: string): StepPlan[] {
  const groups: Array<{ step?: number; items: IndexedChoice[]; firstSeq: number }> = []
  let previousKey: string | undefined
  for (const indexed of [...items].sort(compareIndexed)) {
    const step = indexed.item.step
    // Keep each contiguous no-step run separate. This preserves chronology
    // around authoritative steps without assigning an orphan to a guessed one.
    const key = step === undefined ? 'unscoped' : `step:${step}`
    if (groups.length === 0 || key !== previousKey) {
      groups.push({ ...(step === undefined ? {} : { step }), items: [], firstSeq: indexed.item.seq })
      previousKey = key
    }
    groups.at(-1)!.items.push(indexed)
  }
  return groups.map((group, index) => {
    const scoped = group.step !== undefined
    const suffix = `${scoped ? `step:${group.step}` : 'unscoped'}:${index + 1}`
    const id = `${unitId}:${suffix}`
    const width = NODE_WIDTH
    const rows = Math.max(1, group.items.length)
    return {
      id,
      unitId,
      kind: 'step' as const,
      label: scoped ? `Step ${group.step}` : 'Unscoped events',
      ...(turn === undefined ? {} : { turn }),
      ...(scoped ? { step: group.step } : {}),
      items: group.items,
      x: 0,
      y: TOP,
      width,
      height: rows * ROW_PITCH + 42,
    }
  })
}

function makeIndexed(items: readonly TrajectoryChoice[]): IndexedChoice[] {
  return items.map((item, index) => ({ item, index }))
}

function findFirstKey(items: readonly IndexedChoice[], placements: ReadonlyMap<string, Placement>): string | undefined {
  return [...items].sort(compareIndexed).map(candidate => nodeKey(candidate.item)).find(key => placements.has(key))
}

function findLastKey(items: readonly IndexedChoice[], placements: ReadonlyMap<string, Placement>): string | undefined {
  return [...items].sort(compareIndexed).reverse().map(candidate => nodeKey(candidate.item)).find(key => placements.has(key))
}

/**
 * Build a bounded, deterministic trajectory graph. Coordinates are top-left
 * positions for the existing CSS node cards; columns are at least 190px wide
 * and rows have enough room for the current max-width card plus metadata.
 */
export function layoutTrajectory(
  items: readonly TrajectoryChoice[],
  expandedTurns: ReadonlySet<number>,
  expandedAgents: ReadonlySet<string>,
): TrajectoryLayout {
  const indexedItems = makeIndexed(items)
  const sortedItems = [...indexedItems].sort(compareIndexed)
  const usedKeys = new Set(sortedItems.map(candidate => nodeKey(candidate.item)))
  const originalByItem = new Map<TrajectoryChoice, number>(indexedItems.map(candidate => [candidate.item, candidate.index]))

  const turns = sortedItems.filter(candidate => candidate.item.kind === 'turn' && candidate.item.turn !== undefined)
  const childrenByTurn = new Map<number, IndexedChoice[]>()
  for (const candidate of sortedItems) {
    const turn = candidate.item.turn
    if (turn === undefined || candidate.item.kind === 'turn') continue
    const children = childrenByTurn.get(turn) ?? []
    children.push(candidate)
    childrenByTurn.set(turn, children)
  }

  const nodes: TrajectoryLayoutNode[] = []
  const edges: TrajectoryLayoutEdge[] = []
  const groups: TrajectoryLayoutGroup[] = []
  const placements = new Map<string, Placement>()
  const unitPlans: UnitPlan[] = []
  const stepPlans: StepPlan[] = []
  const ownerLinks: Array<{ readonly owner: TrajectoryChoice; readonly node: TrajectoryChoice; readonly alias: boolean }> = []
  let cursorX = 40
  let maxY = TOP

  const addPlacement = (
    item: TrajectoryChoice,
    x: number,
    y: number,
    unitId: string,
    index: number,
    options: { depth?: number; target?: TrajectoryChoice; role?: TrajectoryLayoutNode['role']; groupId?: string } = {},
  ): TrajectoryLayoutNode => {
    const node: TrajectoryLayoutNode = {
      item,
      x,
      y,
      ...(options.depth === undefined ? {} : { depth: options.depth }),
      ...(options.target === undefined ? {} : { target: options.target }),
      ...(options.role === undefined ? {} : { role: options.role }),
    }
    nodes.push(node)
    const key = nodeKey(item)
    // Canonical nodes are unique by contract. Aliases use a unique eventId;
    // retaining the first placement makes malformed duplicate input stable.
    if (!placements.has(key)) placements.set(key, { item, node, index, unitId, ...(options.groupId === undefined ? {} : { groupId: options.groupId }) })
    maxY = Math.max(maxY, y + NODE_HEIGHT)
    return node
  }

  const primaryTurnByNumber = new Map<number, IndexedChoice>()
  for (const turn of turns) if (turn.item.turn !== undefined && !primaryTurnByNumber.has(turn.item.turn)) primaryTurnByNumber.set(turn.item.turn, turn)
  const turnUnits: UnitPlan[] = []
  for (const turn of turns) {
    const turnNumber = turn.item.turn!
    if (primaryTurnByNumber.get(turnNumber)?.item !== turn.item) continue
    const children = [...(childrenByTurn.get(turnNumber) ?? [])].sort(compareIndexed)
    const expanded = expandedTurns.has(turnNumber)
    const id = `turn:${nodeKey(turn.item)}`
    const firstSeq = Math.min(turn.item.seq, children[0]?.item.seq ?? turn.item.seq)
    const plans = expanded ? groupItemsByStep(children, turnNumber, id) : []
    const width = expanded ? Math.max(TURN_WIDTH, TURN_WIDTH + COLUMN_GAP + Math.max(1, plans.length) * COLUMN_PITCH) : TURN_WIDTH
    turnUnits.push({ id, kind: 'turn', turn: turnNumber, item: turn, items: children, expanded, x: 0, width, firstSeq, stepPlans: plans, anchorKey: nodeKey(turn.item) })
  }

  const sessionItems = sortedItems.filter(candidate => candidate.item.turn === undefined && candidate.item.kind !== 'turn')
  const sessionUnits: UnitPlan[] = sessionItems.map(candidate => {
    const id = `session:${nodeKey(candidate.item)}`
    const expanded = candidate.item.kind === 'subagent' && (expandedAgents.has(nodeKey(candidate.item)) || expandedAgents.has(candidate.item.eventId))
    return {
      id,
      kind: 'session' as const,
      item: candidate,
      items: [],
      expanded,
      x: 0,
      width: expanded ? COLUMN_PITCH + NODE_WIDTH : NODE_WIDTH,
      firstSeq: candidate.item.seq,
      stepPlans: [],
      anchorKey: nodeKey(candidate.item),
    }
  })

  const orphanTurnItems = sortedItems.filter(candidate => candidate.item.turn !== undefined
    && candidate.item.kind !== 'turn'
    && primaryTurnByNumber.get(candidate.item.turn) === undefined)
  if (orphanTurnItems.length > 0) {
    // The projection normally emits a turn marker. If a caller supplies a
    // bounded partial projection without one, keep those real events visible
    // in a deterministic session-style lane instead of inventing a turn.
    const byTurn = new Map<number, IndexedChoice[]>()
    for (const candidate of orphanTurnItems) {
      const turn = candidate.item.turn!
      const group = byTurn.get(turn) ?? []
      group.push(candidate)
      byTurn.set(turn, group)
    }
    for (const [turn, children] of byTurn) {
      const id = `turn-orphan:${turn}`
      const plans = groupItemsByStep(children, turn, id)
      turnUnits.push({
        id,
        kind: 'session',
        turn,
        items: children,
        expanded: true,
        x: 0,
        width: Math.max(NODE_WIDTH, COLUMN_PITCH + Math.max(1, plans.length) * COLUMN_PITCH),
        firstSeq: Math.min(...children.map(child => child.item.seq)),
        stepPlans: plans,
        firstKey: nodeKey(children[0]!.item),
        lastKey: nodeKey([...children].sort(compareIndexed).at(-1)!.item),
        anchorKey: nodeKey(children[0]!.item),
      })
    }
  }

  unitPlans.push(...turnUnits, ...sessionUnits)
  unitPlans.sort(compareUnit)

  for (const unit of unitPlans) {
    const x = cursorX
    const turnItem = unit.kind === 'turn' ? unit.item : undefined
    if (unit.kind === 'turn' && turnItem !== undefined) {
      const rows = Math.max(1, ...unit.stepPlans.map(plan => plan.items.length))
      const turnY = unit.expanded ? TOP + 28 + Math.max(0, rows - 1) * ROW_PITCH / 2 : TOP + 34
      addPlacement(turnItem.item, x, turnY, unit.id, turnItem.index, { role: 'canonical' })
      const groupHeight = unit.expanded ? Math.max(128, rows * ROW_PITCH + 76) : 112
      groups.push({ id: `${unit.id}:band`, kind: 'turn', label: `Turn ${unit.turn}`, ...(unit.turn === undefined ? {} : { turn: unit.turn }), x, y: TOP, width: unit.width, height: groupHeight })
    }

    if (unit.expanded && unit.kind === 'turn') {
      unit.stepPlans.forEach((plan, planIndex) => {
        const groupX = x + TURN_WIDTH + COLUMN_GAP + planIndex * COLUMN_PITCH
        const rows = plan.items.length
        const height = Math.max(128, rows * ROW_PITCH + 76)
        const positionedPlan: StepPlan = { ...plan, x: groupX, y: TOP, height }
        stepPlans.push(positionedPlan)
        groups.push({
          id: positionedPlan.id,
          kind: 'step',
          label: positionedPlan.label,
          ...(positionedPlan.turn === undefined ? {} : { turn: positionedPlan.turn }),
          ...(positionedPlan.step === undefined ? {} : { step: positionedPlan.step }),
          x: groupX,
          y: TOP,
          width: NODE_WIDTH,
          height,
        })
        positionedPlan.items.forEach((candidate, row) => {
          addPlacement(candidate.item, groupX, TOP + 34 + row * ROW_PITCH, unit.id, candidate.index, { role: 'canonical', groupId: positionedPlan.id })
        })
      })
      // Expand a subagent with one actual-result alias, or one explicit
      // read-only placeholder. No synthetic child-turn/detail nodes are made.
      for (const plan of unit.stepPlans) {
        const subagents = plan.items.filter(candidate => candidate.item.kind === 'subagent'
          && (expandedAgents.has(nodeKey(candidate.item)) || expandedAgents.has(candidate.item.eventId)))
        if (subagents.length === 0) continue
        const groupIndex = stepPlans.findIndex(candidate => candidate.id === plan.id)
        const group = stepPlans[groupIndex]!
        subagents.forEach((candidate, aliasIndex) => {
          const target = matchedSubagentResult(candidate.item, indexedItems)?.item
          const alias = target === undefined ? unavailableSubagentResult(candidate.item, usedKeys) : aliasForSubagentResult(candidate.item, target, usedKeys)
          usedKeys.add(nodeKey(alias))
          ownerLinks.push({ owner: candidate.item, node: alias, alias: target !== undefined })
          const role: TrajectoryLayoutNode['role'] = target === undefined ? 'subagent-result-placeholder' : 'subagent-result-alias'
          const aliasX = group.x
          const aliasY = TOP + 34 + (group.items.length + aliasIndex) * ROW_PITCH
          addPlacement(alias, aliasX, aliasY, unit.id, originalByItem.get(candidate.item) ?? candidate.index, {
            depth: 1,
            ...(target === undefined ? {} : { target }),
            role,
            groupId: group.id,
          })
          const current = groups.findIndex(entry => entry.id === group.id)
          if (current >= 0) groups[current] = { ...groups[current]!, height: Math.max(groups[current]!.height, aliasY - TOP + NODE_HEIGHT + 30) }
          maxY = Math.max(maxY, aliasY + NODE_HEIGHT)
        })
      }
      if (unit.stepPlans.length > 0) {
        const groupHeight = Math.max(...unit.stepPlans.map(plan => groups.find(entry => entry.id === plan.id)?.height ?? plan.height))
        const outer = groups.findIndex(entry => entry.id === `${unit.id}:band`)
        if (outer >= 0) groups[outer] = { ...groups[outer]!, height: Math.max(groups[outer]!.height, groupHeight + 20) }
      }
    } else if (unit.item !== undefined && unit.kind !== 'turn') {
      const item = unit.item
      const y = TOP + 34
      addPlacement(item.item, x, y, unit.id, item.index, { role: 'canonical' })
      groups.push({ id: `${unit.id}:band`, kind: 'session', label: item.item.turn === undefined ? 'Session event' : `Turn ${item.item.turn} events`, ...(unit.turn === undefined ? {} : { turn: unit.turn }), x, y: TOP, width: unit.width, height: unit.expanded ? 220 : 112 })
      if (unit.expanded && item.item.kind === 'subagent') {
        const target = matchedSubagentResult(item.item, indexedItems)?.item
        const alias = target === undefined ? unavailableSubagentResult(item.item, usedKeys) : aliasForSubagentResult(item.item, target, usedKeys)
        usedKeys.add(nodeKey(alias))
        ownerLinks.push({ owner: item.item, node: alias, alias: target !== undefined })
        const aliasX = x
        const aliasY = TOP + 34 + ROW_PITCH
        addPlacement(alias, aliasX, aliasY, unit.id, item.index, { depth: 1, ...(target === undefined ? {} : { target }), role: target === undefined ? 'subagent-result-placeholder' : 'subagent-result-alias', groupId: `${unit.id}:band` })
        const current = groups.length - 1
        groups[current] = { ...groups[current]!, height: aliasY - TOP + NODE_HEIGHT + 30 }
      }
    } else if (unit.items.length > 0 && unit.kind !== 'turn') {
      const plans = unit.stepPlans
      groups.push({ id: `${unit.id}:band`, kind: 'session', label: `Turn ${unit.turn} events`, ...(unit.turn === undefined ? {} : { turn: unit.turn }), x, y: TOP, width: unit.width, height: Math.max(128, ...plans.map(plan => plan.height)) })
      plans.forEach((plan, planIndex) => {
        const groupX = x + planIndex * COLUMN_PITCH
        const positionedPlan: StepPlan = { ...plan, x: groupX, y: TOP }
        stepPlans.push(positionedPlan)
        groups.push({ id: positionedPlan.id, kind: 'step', label: positionedPlan.label, ...(positionedPlan.turn === undefined ? {} : { turn: positionedPlan.turn }), ...(positionedPlan.step === undefined ? {} : { step: positionedPlan.step }), x: groupX, y: TOP, width: NODE_WIDTH, height: positionedPlan.height })
        positionedPlan.items.forEach((candidate, row) => addPlacement(candidate.item, groupX, TOP + 34 + row * ROW_PITCH, unit.id, candidate.index, { groupId: positionedPlan.id, role: 'canonical' }))
      })
    }
    cursorX = x + unit.width + COLUMN_GAP
    maxY = Math.max(maxY, TOP + (unit.expanded ? 42 + Math.max(1, ...unit.stepPlans.map(plan => plan.items.length)) * ROW_PITCH : 112))
  }

  const visibleKey = (item: TrajectoryChoice): string => nodeKey(item)
  const edgePairs = new Set<string>()
  const addEdge = (from: TrajectoryChoice | string, to: TrajectoryChoice | string, options: Omit<TrajectoryLayoutEdge, 'id' | 'from' | 'to'> = {}): void => {
    const fromKey = typeof from === 'string' ? from : visibleKey(from)
    const toKey = typeof to === 'string' ? to : visibleKey(to)
    if (fromKey === toKey || !placements.has(fromKey) || !placements.has(toKey)) return
    const pair = `${fromKey}\u0000${toKey}`
    if (edgePairs.has(pair)) return
    edgePairs.add(pair)
    edges.push({ id: `${fromKey}->${toKey}`, from: fromKey, to: toKey, ...options })
  }

  // This is a visual provenance link, not another invocation. Both kinds of
  // child trace are dashed and explicitly labelled so an alias/placeholder
  // cannot look like an uncorrelated canonical event.
  for (const link of ownerLinks) {
    addEdge(link.owner, link.node, {
      dashed: true,
      curved: true,
      label: link.alias ? 'view alias · canonical result' : 'internal trace not loaded',
    })
  }

  const resultToCall = new Map<string, string>()
  const callToResult = new Map<string, string>()
  for (const call of sortedItems.filter(candidate => isCall(candidate.item))) {
    const target = matchedSubagentResult(call.item, indexedItems)
    // Tool calls and subagents share the same call/result identity contract.
    if (target === undefined) continue
    const callKey = nodeKey(call.item)
    const resultKey = nodeKey(target.item)
    if (placements.has(callKey) && placements.has(resultKey)) {
      callToResult.set(callKey, resultKey)
      resultToCall.set(resultKey, callKey)
      addEdge(callKey, resultKey, { curved: true })
    }
  }

  const plansWithPlacement = stepPlans.map(plan => ({ plan, visibleItems: plan.items.filter(candidate => placements.has(nodeKey(candidate.item))) }))
  for (const { plan, visibleItems } of plansWithPlacement) {
    const groupIsUnscoped = plan.step === undefined
    const callBatchCounts = new Map<string, number>()
    for (const candidate of visibleItems) {
      const group = candidate.item.parallelGroup
      if (isCall(candidate.item) && group !== undefined) callBatchCounts.set(group, (callBatchCounts.get(group) ?? 0) + 1)
    }
    for (let index = 1; index < visibleItems.length; index += 1) {
      const previous = visibleItems[index - 1]!.item
      const current = visibleItems[index]!.item
      const previousKey = nodeKey(previous)
      const currentKey = nodeKey(current)
      const previousBatch = previous.parallelGroup
      const currentBatch = current.parallelGroup
      if (isCall(previous) && isCall(current) && previousBatch !== undefined && previousBatch === currentBatch && (callBatchCounts.get(previousBatch) ?? 0) > 1) continue
      if (isCall(previous) && callToResult.has(previousKey) && callToResult.get(previousKey) !== currentKey) continue
      if (isResult(current) && resultToCall.has(currentKey) && resultToCall.get(currentKey) !== previousKey) continue
      if (isCall(previous) && isResult(current) && callToResult.get(previousKey) === currentKey) continue
      const uncertainRelation = (isResult(current) && !resultToCall.has(currentKey)) || (isCall(previous) && !callToResult.has(previousKey))
      addEdge(previousKey, currentKey, {
        ...(groupIsUnscoped || uncertainRelation ? { dashed: true } : {}),
        ...(isCall(previous) ? { label: `call: ${previous.toolName ?? previous.label}` } : {}),
      })
    }
    // A same-batch group is a fan-out from the nearest preceding event. There
    // is intentionally no call-to-call edge and no claim that the calls ran
    // concurrently; `parallelGroup` denotes only the provider batch.
    for (const [batch, count] of callBatchCounts) {
      if (count < 2) continue
      const calls = visibleItems.filter(candidate => isCall(candidate.item) && candidate.item.parallelGroup === batch)
      const firstCallIndex = visibleItems.findIndex(candidate => candidate.item === calls[0]?.item)
      const entry = firstCallIndex <= 0 ? undefined : [...visibleItems].slice(0, firstCallIndex).reverse().find(candidate => !isCall(candidate.item))
      if (entry === undefined) continue
      for (const call of calls) addEdge(entry.item, call.item, { curved: true, label: `call: ${call.item.toolName ?? call.item.label}` })
    }
    // Results join the next assistant/model event only when the result itself
    // is known. This prevents the old misleading call->final all-siblings fan.
    for (const result of visibleItems.filter(candidate => isResult(candidate.item) && resultToCall.has(nodeKey(candidate.item)))) {
      const resultIndex = visibleItems.findIndex(candidate => candidate.item === result.item)
      const nextFlow = visibleItems.slice(resultIndex + 1).find(candidate => !isCall(candidate.item) && !isResult(candidate.item))
      if (nextFlow !== undefined) addEdge(result.item, nextFlow.item, { curved: true, ...(groupIsUnscoped ? { dashed: true } : {}) })
    }
  }

  // Joins between authoritative step groups use the true terminal frontier of
  // the preceding group. A result that already flows into a later assistant
  // must not bypass that assistant; when a batch ends in several results with
  // no assistant, each terminal result remains a legitimate branch join.
  for (let index = 1; index < plansWithPlacement.length; index += 1) {
    if (plansWithPlacement[index - 1]!.plan.unitId !== plansWithPlacement[index]!.plan.unitId) continue
    const previous = plansWithPlacement[index - 1]!.visibleItems
    const current = plansWithPlacement[index]!.visibleItems
    const to = current[0]?.item
    if (to === undefined) continue
    const previousKeys = new Set(previous.map(candidate => nodeKey(candidate.item)))
    const outgoingWithinPrevious = new Set<string>()
    for (const edge of edges) {
      if (previousKeys.has(edge.from) && previousKeys.has(edge.to)) outgoingWithinPrevious.add(edge.from)
    }
    const frontier = previous.filter(candidate => !outgoingWithinPrevious.has(nodeKey(candidate.item)))
    const terminalNodes = frontier.length > 0 ? frontier : (previous.length > 0 ? [previous.at(-1)!] : [])
    for (const terminal of terminalNodes) {
      const from = terminal.item
      addEdge(from, to, {
        curved: terminalNodes.length > 1,
        dashed: previous[0]?.item.step === undefined
          || current[0]?.item.step === undefined
          || (isCall(from) && !callToResult.has(nodeKey(from)))
          || (isResult(from) && !resultToCall.has(nodeKey(from)))
          || (isResult(to) && !resultToCall.has(nodeKey(to))),
      })
    }
  }

  // Turn start/end and session-level chronology form the outer spine. Expanded
  // turns anchor to their turn card, so children never create backward edges.
  const outerUnits = unitPlans.map(unit => {
    const first = unit.kind === 'turn' && unit.item !== undefined ? nodeKey(unit.item.item) : unit.item === undefined ? unit.firstKey : nodeKey(unit.item.item)
    const last = unit.kind === 'turn' && unit.item !== undefined
      ? (unit.expanded ? findLastKey(unit.items, placements) ?? nodeKey(unit.item.item) : nodeKey(unit.item.item))
      : unit.item === undefined ? findLastKey(unit.items, placements) : nodeKey(unit.item.item)
    return { unit, first, last }
  }).filter(value => value.first !== undefined && value.last !== undefined) as Array<{ unit: UnitPlan; first: string; last: string }>
  for (let index = 1; index < outerUnits.length; index += 1) {
    const previous = outerUnits[index - 1]!
    const current = outerUnits[index]!
    addEdge(previous.last, current.first, { dashed: previous.unit.kind === 'session' || current.unit.kind === 'session' })
  }

  // Every expanded turn gets an explicit turn->first-step edge. Session-style
  // orphan units have no synthetic turn and intentionally skip this edge.
  for (const unit of unitPlans.filter(candidate => candidate.kind === 'turn' && candidate.expanded)) {
    const first = findFirstKey(unit.items, placements)
    if (first !== undefined && unit.item !== undefined) addEdge(unit.item.item, first)
  }

  const width = Math.max(MIN_WIDTH, cursorX + 40)
  const height = Math.max(MIN_HEIGHT, maxY + 40, ...groups.map(group => group.y + group.height + 28))
  return { nodes, edges, groups, width, height }
}
