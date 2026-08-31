import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SeedMode } from '../types.ts'
import { diffFoldText } from '../revision.ts'
import { SideChatApi } from './api.ts'
import { SideChatHeaderActions, SideChatsView } from './components.tsx'
import { SideChatWorkflowHost } from './workflow-dialogs.tsx'
import { TrajectoryPanel } from './trajectory-panel.tsx'
import { en, NS, zh } from './locales.ts'
import { installStyles } from './styles.ts'
import {
  refreshSideChatIdentity,
  showCommandWorkflow,
  showFoldPreview,
  showRevisionComparison,
  showUsageReport,
  showTrajectoryPanel,
  type CommandWorkflowRequest,
} from './workflow-events.ts'

export const inject = ['connection', 'locale', 'slots', 'sessions', 'commandUi']

const destructiveConfirmation = (title: string, description: string, confirmLabel: string) => ({
  title,
  description,
  acknowledgeLabel: '我已了解',
  cancelLabel: '取消',
  confirmLabel,
})

/** Browser plugin: full Session UI identity, child catalog and command-driven workflows. */
export function apply(ctx: Context): void {
  const api = new SideChatApi(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidechat: dictionaries')
  ctx.effect(installStyles, 'sidechat: styles')
  const t = ctx.locale.bind(NS)

  const openSession = (value: string): void => {
    ctx.sessions.open(value as SessionId)
  }

  const requestWorkflow = (request: CommandWorkflowRequest): void => {
    if (!showCommandWorkflow(request)) {
      throw new Error('SideChat 操作界面尚未就绪，请保持当前 Session 页面打开后重试')
    }
  }

  const notice = (sessionId: string, title: string, message: string): void => {
    requestWorkflow({ kind: 'notice', sessionId, title, message, tone: 'success' })
  }

  const injected = {
    api,
    openSession,
    refreshSessions: () => ctx.sessions.refresh(),
    identityChanged: (sessionId: string, record: Awaited<ReturnType<SideChatApi['get']>>['record']) => {
      identityCache.set(sessionId, record)
    },
  }
  const foldPrepareIds = new Map<string, string>()
  const identityCache = new Map<string, Awaited<ReturnType<SideChatApi['get']>>['record']>()
  const cachedRecord = (sessionId: string) => identityCache.get(sessionId)
  const isSideChat = (sessionId: string) => cachedRecord(sessionId) !== undefined && cachedRecord(sessionId) !== null
  const usableSideChat = (sessionId: string) => {
    const record = cachedRecord(sessionId)
    return record !== undefined && record !== null && record.status !== 'orphaned' && record.status !== 'abandoned'
  }

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'sidechat-identity-actions',
    order: 30,
    locale: NS,
    inject: () => injected,
  }, SideChatHeaderActions))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'sidechat-command-workflow-host',
    order: 31,
    locale: NS,
    inject: () => injected,
  }, SideChatWorkflowHost))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'sidechat-trajectory-panel',
    order: 32,
    locale: NS,
    inject: () => injected,
  }, TrajectoryPanel))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'sidechats',
    order: 20,
    locale: NS,
    label: () => t('view.children'),
    inject: () => injected,
  }, SideChatsView))

  ctx.effect(() => ctx.commandUi.register({
    name: 'traceask',
    description: '打开当前 Session 的轨迹可视化并选择事件发起 SideChat 提问',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async () => [{ id: 'open', label: '打开轨迹分析', detail: '选择 Host 脱敏后的轨迹事件并发起 SideChat' }],
      onSelect: (_option, session) => {
        if (!showTrajectoryPanel(session.sessionId)) throw new Error('轨迹界面尚未就绪，请保持当前 Session 页面打开后重试')
      },
    },
  }), 'sidechat: /traceask')

  ctx.effect(() => ctx.commandUi.register({
    name: 'side',
    description: '创建普通、持久化的 SideChat Session',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async () => [
        { id: 'tail:1', label: '最近 1 条（推荐）', detail: '默认：最后一条直接 user/assistant 文本', active: true },
        { id: 'task', label: 'Task 式生成', detail: '父会话当前模型生成 bounded 上下文；额外调用一次模型' },
        { id: 'none', label: '无 Seed', detail: '只发送澄清问题' },
        { id: 'tail:2', label: '最近 2 条', detail: '仅直接 user/assistant 文本' },
        { id: 'tail:4', label: '最近 4 条', detail: '仅直接 user/assistant 文本' },
        { id: 'pick:1', label: '选择 1 条', detail: '随后选择一条直接文本消息' },
        { id: 'pick:many', label: '选择多条', detail: '任意选择最多 8 条直接文本' },
        { id: 'turn', label: '选择 Turn', detail: '冻结指定 turn 的直接文本' },
        { id: 'selection', label: '文本片段', detail: '冻结一条消息的字符区间' },
        { id: 'summary', label: 'Seed 摘要', detail: '额外模型调用生成 bounded summary' },
      ],
      onSelect: (option, session) => {
        requestWorkflow({ kind: 'permission-choice', sessionId: session.sessionId, seedMode: option.id as SeedMode })
      },
    },
  }), 'sidechat: /side')

  ctx.effect(() => ctx.commandUi.register({
    name: 'btw',
    description: '/side 的别名：创建普通、持久化的 SideChat Session',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async () => [
        { id: 'tail:1', label: '最近 1 条（推荐）', detail: '默认：最后一条直接 user/assistant 文本', active: true },
        { id: 'task', label: 'Task 式生成', detail: '父会话当前模型生成 bounded 上下文；额外调用一次模型' },
        { id: 'none', label: '无 Seed', detail: '只发送澄清问题' },
        { id: 'tail:2', label: '最近 2 条', detail: '仅直接 user/assistant 文本' },
        { id: 'tail:4', label: '最近 4 条', detail: '仅直接 user/assistant 文本' },
        { id: 'pick:1', label: '选择 1 条', detail: '随后选择一条直接文本消息' },
        { id: 'pick:many', label: '选择多条', detail: '任意选择最多 8 条直接文本' },
        { id: 'turn', label: '选择 Turn', detail: '冻结指定 turn 的直接文本' },
        { id: 'selection', label: '文本片段', detail: '冻结一条消息的字符区间' },
        { id: 'summary', label: 'Seed 摘要', detail: '额外模型调用生成 bounded summary' },
      ],
      onSelect: (option, session) => {
        requestWorkflow({ kind: 'permission-choice', sessionId: session.sessionId, seedMode: option.id as SeedMode })
      },
    },
  }), 'sidechat: /btw')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sideback',
    description: '从当前 SideChat 返回其直接父会话',
    available: session => {
      const record = cachedRecord(session.sessionId)
      return record !== undefined && record !== null && record.status !== 'orphaned'
    },
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const record = (await api.get(session.sessionId, signal)).record
        return record === null || record.status === 'orphaned' ? [] : [{
          id: record.parentSessionId,
          label: '返回父会话',
          detail: record.parentSessionId,
        }]
      },
      onSelect: option => { openSession(option.id) },
    },
  }), 'sidechat: /sideback')

  const catalogOptions = async (sessionId: string, signal: AbortSignal) =>
    (await api.catalog(sessionId, signal)).items.map(item => ({
      id: item.childSessionId,
      label: item.title,
      detail: `${item.parentSessionId === sessionId ? '直接子会话' : '工作区'} · ${item.status} · rev ${item.revision} · ${item.model}`,
    }))

  ctx.effect(() => ctx.commandUi.register({
    name: 'sidechats',
    description: '列出当前工作区 SideChat；当前 Session 的直接子会话优先',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => catalogOptions(session.sessionId, signal),
      onSelect: option => { openSession(option.id) },
    },
  }), 'sidechat: /sidechats')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sideresume',
    description: '选择已有 SideChat，打开完整 Session 后继续对话',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => catalogOptions(session.sessionId, signal),
      onSelect: option => { openSession(option.id) },
    },
  }), 'sidechat: /sideresume')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sidefold',
    description: '让当前 SideChat 生成、预览并提交 Fold 到直接父会话',
    available: session => usableSideChat(session.sessionId),
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const record = (await api.get(session.sessionId, signal)).record
        if (record === null || record.status === 'orphaned' || record.status === 'abandoned') return []
        const bases = record.folds.filter(fold => fold.state === 'committed' && fold.revisionState !== 'withdrawn')
        return [
          { id: 'full', label: '完整替代 Fold', detail: '生成可完整替代先前版本的结构化结论' },
          ...bases.map(fold => ({
            id: `incremental:${fold.revision}`,
            label: `增量 Fold · 基于 rev-${fold.revision}`,
            detail: fold.revisionState === 'current' ? '基于当前 revision，只写新增或变化' : `基于 ${fold.revisionState ?? 'legacy'} revision`,
            active: fold.revisionState === 'current',
          })),
        ]
      },
      onSelect: async (option, session) => {
        const [mode, revisionText] = option.id.split(':')
        if (mode !== 'full' && mode !== 'incremental') throw new Error('未知 Fold 模式')
        const baseRevision = mode === 'incremental' ? Number(revisionText) : undefined
        if (mode === 'incremental' && !Number.isSafeInteger(baseRevision)) throw new Error('无效的 Fold 基线')
        const key = `${session.sessionId}:${option.id}`
        const foldId = foldPrepareIds.get(key) ?? crypto.randomUUID()
        foldPrepareIds.set(key, foldId)
        const fold = (await api.prepareFold(session.sessionId, foldId, mode, baseRevision)).fold
        if (!showFoldPreview({ sessionId: session.sessionId, fold })) {
          throw new Error('Fold 预览界面尚未就绪，请保持当前 SideChat 页面打开后重试')
        }
        foldPrepareIds.delete(key)
      },
    },
  }), 'sidechat: /sidefold')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sidecompare',
    description: '比较当前 SideChat 的两个 committed Fold revision',
    available: session => isSideChat(session.sessionId),
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const record = (await api.get(session.sessionId, signal)).record
        const folds = record?.folds.filter(fold => fold.state === 'committed' && fold.committedContent !== undefined) ?? []
        return folds.flatMap((left, index) => folds.slice(index + 1).map(right => ({
          id: `${left.revision}:${right.revision}`,
          label: `rev-${left.revision} → rev-${right.revision}`,
          detail: `${left.revisionState ?? 'legacy'} → ${right.revisionState ?? 'legacy'}`,
        })))
      },
      onSelect: async (option, session) => {
        const [leftRevision, rightRevision] = option.id.split(':').map(Number)
        const record = (await api.get(session.sessionId)).record
        const left = record?.folds.find(fold => fold.revision === leftRevision)
        const right = record?.folds.find(fold => fold.revision === rightRevision)
        if (left?.committedContent === undefined || right?.committedContent === undefined) throw new Error('所选 revision 已不可比较')
        if (!showRevisionComparison({
          sessionId: session.sessionId,
          left: leftRevision!,
          right: rightRevision!,
          lines: diffFoldText(left.committedContent, right.committedContent),
        })) throw new Error('Revision 对比界面尚未就绪')
      },
    },
  }), 'sidechat: /sidecompare')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sidewithdraw',
    description: '软撤回当前 SideChat 的指定 Fold revision，保留审计历史',
    available: session => usableSideChat(session.sessionId),
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const record = (await api.get(session.sessionId, signal)).record
        return record?.folds
          .filter(fold => fold.state === 'committed' && fold.revisionState !== 'withdrawn')
          .map(fold => ({
            id: fold.foldId,
            label: `软撤回 rev-${fold.revision}`,
            detail: `${fold.mode ?? 'full'} · ${fold.revisionState ?? 'legacy'}`,
            confirmation: destructiveConfirmation(
              `软撤回 Fold rev-${fold.revision}`,
              '原 Fold 消息不会物理删除；父会话将收到一条撤回通知。',
              '继续填写原因',
            ),
          })) ?? []
      },
      onSelect: async (option, session) => {
        const record = (await api.get(session.sessionId)).record
        const fold = record?.folds.find(candidate => candidate.foldId === option.id)
        if (fold === undefined) throw new Error('所选 Fold revision 已不可用')
        requestWorkflow({
          kind: 'withdraw',
          sessionId: session.sessionId,
          foldId: fold.foldId,
          revision: fold.revision,
        })
      },
    },
  }), 'sidechat: /sidewithdraw')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sidearchive',
    description: '将当前 SideChat 标记为 archived',
    available: session => cachedRecord(session.sessionId)?.status === 'open',
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const record = (await api.get(session.sessionId, signal)).record
        return record === null || record.status !== 'open' ? [] : [{
          id: record.childSessionId,
          label: '归档当前 SideChat',
          detail: '保留普通 Session 和完整 transcript，可稍后恢复',
          confirmation: destructiveConfirmation('归档 SideChat', '只改变插件组织状态，不删除 transcript。', '归档'),
        }]
      },
      onSelect: async (_option, session) => {
        const result = await api.setStatus(session.sessionId, 'archive')
        identityCache.set(session.sessionId, result.record)
        refreshSideChatIdentity(session.sessionId)
        notice(session.sessionId, 'SideChat 已归档', '普通 Session 和完整 transcript 均已保留；可使用 /siderestore 恢复。')
      },
    },
  }), 'sidechat: /sidearchive')

  ctx.effect(() => ctx.commandUi.register({
    name: 'siderestore',
    description: '恢复当前 archived SideChat',
    available: session => cachedRecord(session.sessionId)?.status === 'archived',
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const record = (await api.get(session.sessionId, signal)).record
        return record?.status === 'archived' ? [{ id: record.childSessionId, label: '恢复当前 SideChat', detail: '状态恢复为 open' }] : []
      },
      onSelect: async (_option, session) => {
        const result = await api.setStatus(session.sessionId, 'restore')
        identityCache.set(session.sessionId, result.record)
        refreshSideChatIdentity(session.sessionId)
        notice(session.sessionId, 'SideChat 已恢复', '状态已恢复为 open，可以继续多轮对话和 Fold。')
      },
    },
  }), 'sidechat: /siderestore')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sideabandon',
    description: '将当前 SideChat 标记为 abandoned，保留原始 transcript',
    available: session => usableSideChat(session.sessionId),
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const record = (await api.get(session.sessionId, signal)).record
        return record === null || record.status === 'orphaned' || record.status === 'abandoned' ? [] : [{
          id: record.childSessionId,
          label: '放弃当前 SideChat',
          detail: '禁止后续 Fold，但不删除 Session 或 transcript',
          confirmation: destructiveConfirmation('放弃 SideChat', '该操作保留数据，但会关闭此 SideChat 的 Fold 工作流。', '放弃'),
        }]
      },
      onSelect: async (_option, session) => {
        const result = await api.setStatus(session.sessionId, 'abandon')
        identityCache.set(session.sessionId, result.record)
        refreshSideChatIdentity(session.sessionId)
        notice(session.sessionId, 'SideChat 已放弃', '已标记为 abandoned；原始 Session 和 transcript 没有删除。')
      },
    },
  }), 'sidechat: /sideabandon')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sidecites',
    description: '查看当前 SideChat 已创建的 Cite，并打开引用目标 Session',
    available: session => isSideChat(session.sessionId),
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const record = (await api.get(session.sessionId, signal)).record
        return record?.cites.map(cite => ({
          id: cite.targetSessionId ?? record.parentSessionId,
          label: `${cite.crossParent === true ? '跨父 Cite' : '父会话 Cite'} · ${cite.state}`,
          detail: `message ${cite.messageId} · target ${(cite.targetSessionId ?? record.parentSessionId).slice(0, 12)}`,
        })) ?? []
      },
      onSelect: option => { openSession(option.id) },
    },
  }), 'sidechat: /sidecites')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sidecite',
    description: '从 SideChat 选择 assistant 回复并无回复引用到父会话',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const current = (await api.get(session.sessionId, signal)).record
        if (current !== null) {
          if (current.status === 'orphaned') return []
          return (await api.assistantMessages(current.childSessionId, signal)).items.map(item => ({
            id: item.messageId,
            label: item.text.replace(/\s+/gu, ' ').slice(0, 100),
            detail: `当前 SideChat · message ${item.messageId.slice(0, 12)}`,
          }))
        }
        return (await api.list(session.sessionId, signal)).items.map(item => ({
          id: item.childSessionId,
          label: item.title,
          detail: `${item.status} · rev ${item.revision} · ${item.model}`,
        }))
      },
      onSelect: async (option, session) => {
        const current = (await api.get(session.sessionId)).record
        if (current !== null) {
          const result = await api.cite(current.childSessionId, option.id, crypto.randomUUID())
          notice(
            session.sessionId,
            '引用已提交',
            result.state === 'pending' ? t('fold.pending') : '不可变回复快照已写入父会话；没有触发模型调用。',
          )
          return
        }
        requestWorkflow({
          kind: 'cite-message',
          sessionId: session.sessionId,
          childSessionId: option.id,
          crossParent: false,
        })
      },
    },
  }), 'sidechat: /sidecite')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sideusage',
    description: '查看当前 SideChat、父会话增量和额外 Seed 调用的 token 用量',
    available: session => isSideChat(session.sessionId),
    ui: {
      kind: 'popupSelect',
      options: async () => [{ id: 'show', label: '查看 SideChat 用量', detail: '精确 provider usage；缺失证据时明确标为不可得' }],
      onSelect: async (_option, session) => {
        const report = await api.usage(session.sessionId)
        if (!showUsageReport(session.sessionId, report)) throw new Error('用量界面尚未就绪，请保持当前 SideChat 页面打开后重试')
      },
    },
  }), 'sidechat: /sideusage')

  ctx.effect(() => ctx.commandUi.register({
    name: 'sidecite-cross',
    description: '显式选择同工作区 SideChat 回复并引用到当前 Session（Host 默认关闭）',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => (await api.workspaceSideChats(session.sessionId, signal)).items.map(item => ({
        id: item.childSessionId,
        label: item.title,
        detail: `原父会话 ${item.parentSessionId.slice(0, 12)} · 工作区 ${item.workspace ?? '(unknown)'} · ${item.status} · rev ${item.revision}`,
      })),
      onSelect: (option, session) => {
        requestWorkflow({
          kind: 'cite-message',
          sessionId: session.sessionId,
          childSessionId: option.id,
          crossParent: true,
        })
      },
    },
  }), 'sidechat: /sidecite-cross')
}

export { SideChatApi } from './api.ts'
export { SideChatHeaderActions, SideChatsView } from './components.tsx'
export { SideChatWorkflowHost } from './workflow-dialogs.tsx'
export { TrajectoryPanel } from './trajectory-panel.tsx'
