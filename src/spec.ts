import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { sideChatRecordSchema } from './types.ts'
import type { SideChatRecord } from './types.ts'

export const sideChatDomainSpec = defineDomain({
  name: 'sidechat',
  version: 1,
  tables: {
    chats: domainTable<string, SideChatRecord>(sideChatRecordSchema),
  },
})
