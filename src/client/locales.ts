export const NS = 'sidechat'

export const zh = {
  'view.children': '子会话',
  'badge': 'SideChat',
  'label.parent': '父会话',
  'hint.create': '使用 /side 创建新的 SideChat；使用 /sidechats 选择并打开已有子会话。',
  'empty': '还没有 SideChat 子会话。',
  'loading': '正在加载…',
  'orphaned': '父会话已不存在；Fold 和引用已禁用。',
  'fold.preview': 'Fold 预览',
  'fold.commit': '提交到父会话',
  'fold.pending': '父会话正在运行，Fold 已排队等待安全边界。',
  'fold.committed': 'Fold 已提交到父会话。',
  'fold.cancel': '取消',
  'revision.history': 'Fold revision 历史',
  'revision.compare': 'Revision 对比',
  'status.open': '进行中',
  'status.archived': '已归档',
  'status.abandoned': '已放弃',
  'status.orphaned': '孤立',
} as const

export const en: Record<keyof typeof zh, string> = {
  'view.children': 'SideChats',
  'badge': 'SideChat',
  'label.parent': 'Parent Session',
  'hint.create': 'Use /side to create a SideChat, or /sidechats to select an existing child.',
  'empty': 'No SideChat sessions yet.',
  'loading': 'Loading…',
  'orphaned': 'The parent Session is gone; Fold and cite are disabled.',
  'fold.preview': 'Fold preview',
  'fold.commit': 'Commit to parent',
  'fold.pending': 'The parent is running. Fold is queued for a safe boundary.',
  'fold.committed': 'Fold committed to the parent.',
  'fold.cancel': 'Cancel',
  'revision.history': 'Fold revision history',
  'revision.compare': 'Revision comparison',
  'status.open': 'Open',
  'status.archived': 'Archived',
  'status.abandoned': 'Abandoned',
  'status.orphaned': 'Orphaned',
}

export type SideChatLocaleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sidechat: SideChatLocaleKey
  }
}
