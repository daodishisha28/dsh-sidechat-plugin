export const FOLD_HEADINGS = [
  '# SideChat 澄清结论：',
  '- 背景：',
  '- 结论：',
  '- 依据：',
  '- 对父会话的影响：',
  '- 未决：',
] as const

import type { AssistantChoice, DetailPointer, FoldMode } from './types.ts'

/** Conservative phase-1 estimate, matching DSH's documented 4 chars/token heuristic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function hasFoldStructure(text: string): boolean {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  let cursor = -1
  for (const heading of FOLD_HEADINGS) {
    const matches = lines.flatMap((line, index) => line.startsWith(heading) ? [index] : [])
    if (matches.length !== 1) return false
    const next = matches[0]!
    if (next <= cursor) return false
    cursor = next
  }
  return true
}

export function messagePointer(childSessionId: string, messageId: string): string {
  return `sidechat://${encodeURIComponent(childSessionId)}/message/${encodeURIComponent(messageId)}`
}

export function extractDetailPointers(
  content: string,
  childSessionId: string,
  messages: readonly AssistantChoice[],
): DetailPointer[] {
  const valid = new Map(messages.map(message => [message.messageId, message]))
  const found: DetailPointer[] = []
  const seen = new Set<string>()
  const pattern = /sidechat:\/\/([^\s/]+)\/message\/([^\s)\]>,;]+)/gu
  const matches = [...content.matchAll(pattern)]
  const pointerPrefixes = content.match(/sidechat:\/\//gu)?.length ?? 0
  if (matches.length !== pointerPrefixes) throw new Error('Fold contains a malformed sidechat detail pointer')
  for (const match of matches) {
    let child: string
    let messageId: string
    try {
      child = decodeURIComponent(match[1] ?? '')
      messageId = decodeURIComponent(match[2] ?? '')
    } catch { throw new Error('Fold contains a malformed sidechat detail pointer') }
    if (child !== childSessionId) throw new Error('Fold detail pointer targets another SideChat')
    if (!valid.has(messageId)) throw new Error(`Fold detail pointer names unknown message: ${messageId}`)
    if (seen.has(messageId)) continue
    seen.add(messageId)
    const line = content.slice(0, match.index).split(/\r?\n/u).at(-1)?.trim() ?? ''
    const markdownLabel = /\[([^\r\n]+)\]\($/u.exec(line)?.[1]
    const label = markdownLabel ?? line.replace(/^[-*]\s*/u, '')
    found.push({ label: label.slice(0, 160) || `message ${messageId}`, uri: match[0], messageId })
    if (found.length > 5) throw new Error('Fold contains more than five detail pointers')
  }
  return found
}

export function buildFoldPrompt(
  maxTokens: number,
  options: {
    readonly mode?: FoldMode
    readonly baseRevision?: number
    readonly childSessionId?: string
    readonly messages?: readonly AssistantChoice[]
  } = {},
): string {
  const mode = options.mode ?? 'full'
  const catalog = options.childSessionId === undefined || options.messages === undefined
    ? []
    : options.messages.slice(-12).map(message =>
        `- ${messagePointer(options.childSessionId!, message.messageId)} — ${message.text.replace(/\s+/gu, ' ').slice(0, 120)}`)
  return [
    mode === 'incremental'
      ? `请基于当前 SideChat 的讨论生成相对 Fold rev-${options.baseRevision ?? '?'} 的增量 Fold，只写新增或变化的结论。`
      : '请基于当前 SideChat 的讨论生成可完整替代先前版本的 Fold。',
    `总长度不得超过 ${maxTokens} token；只输出下列固定 Markdown 结构，不要增加前言或代码围栏：`,
    '',
    '# SideChat 澄清结论：<标题>',
    '',
    '- 背景：...',
    '- 结论：...',
    '- 依据：...',
    '- 对父会话的影响：...',
    '- 未决：...',
    '',
    '如短结论不足以保留关键证据，可在对应条目内加入至多 3 个下列精确 detail pointer；不得编造或修改 URI：',
    ...catalog,
  ].join('\n')
}

export function buildFoldRewritePrompt(maxTokens: number): string {
  return `上一版 Fold 的结构或长度不合格。请重写一次，严格使用固定六项结构且不超过 ${maxTokens} token；只输出 Fold，并只使用先前给出的 detail pointer。`
}

export function foldMarker(foldId: string, revision: number, childSessionId: string): string {
  return `[SideChat fold id=${foldId} rev=${revision} source=${childSessionId}]`
}

export function citeMarker(citeId: string, childSessionId: string, messageId: string): string {
  return `[SideChat cite id=${citeId} source=${childSessionId} message=${messageId}]`
}

export function withdrawalMarker(foldId: string, revision: number, childSessionId: string): string {
  return `[SideChat fold-withdrawal id=${foldId} rev=${revision} source=${childSessionId}]`
}

export function buildFoldParentMessage(
  marker: string,
  title: string,
  content: string,
  metadata?: { readonly mode?: FoldMode; readonly baseRevision?: number; readonly supersedesRevision?: number },
): string {
  const relation = [
    `mode=${metadata?.mode ?? 'full'}`,
    ...(metadata?.baseRevision === undefined ? [] : [`base=rev-${metadata.baseRevision}`]),
    ...(metadata?.supersedesRevision === undefined ? [] : [`supersedes=rev-${metadata.supersedesRevision}`]),
  ].join(' · ')
  return `${marker}\n\n> 来自 SideChat：${title}\n> ${relation}\n\n${content}`
}

export function buildCiteParentMessage(
  marker: string,
  title: string,
  content: string,
): string {
  return `${marker}\n\n> 引用 SideChat「${title}」中的 assistant 回复\n\n${content}`
}

export function buildWithdrawalParentMessage(marker: string, title: string, revision: number, reason: string): string {
  return `${marker}\n\n> SideChat「${title}」的 Fold rev-${revision} 已软撤回；原消息因审计原因保留。\n\n撤回原因：${reason}`
}
