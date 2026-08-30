import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SideChatReadEntry } from './types.ts'
import { renderUntrustedRecall } from './read.ts'
import {
  SIDECHAT_READ_TOOL_DESCRIPTION,
  SIDECHAT_READ_TOOL_NAME,
  SIDECHAT_READ_TOOL_PARAMETERS,
} from './tool-contract.ts'

export interface SideChatReadToolOwner {
  readMessagesForParent(
    parentSessionId: string,
    childSessionId: string,
    messageIds: readonly string[],
    signal: AbortSignal,
  ): Promise<SideChatReadEntry[]>
}

const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['user', 'assistant'] },
    text: { type: 'string', required: true },
    seq: { type: 'integer', required: true },
  },
} as const

/** Agent-scoped precise recall capability; the closure fixes the direct parent identity. */
export function createSideChatReadTool(owner: SideChatReadToolOwner, parentSessionId: string): ToolDefinition {
  return defineTool({
    name: SIDECHAT_READ_TOOL_NAME,
    description: SIDECHAT_READ_TOOL_DESCRIPTION,
    parameters: SIDECHAT_READ_TOOL_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          childSessionId: { type: 'string', required: true },
          messages: { type: 'array', required: true, items: ENTRY_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderUntrustedRecall(value.childSessionId, value.messages) }],
    },
    async execute(args, exec) {
      if (exec.agent?.id !== parentSessionId) throw new Error('sidechat_read caller identity changed')
      const messages = await owner.readMessagesForParent(
        parentSessionId,
        args.child_session_id,
        args.message_ids,
        exec.signal,
      )
      return { childSessionId: args.child_session_id, messages }
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: `Read ${args.message_ids.length} SideChat message(s)`, kind: 'read', rawInput: args.child_session_id }),
  })
}
