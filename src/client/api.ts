import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  assistantChoiceSchema,
  createSideChatValueSchema,
  foldRecordSchema,
  seedMessageSchema,
  sideChatRecordSchema,
  sideChatSummarySchema,
  sideChatTreeItemSchema,
  usageReportSchema,
  type CreateSideChatRequest,
  type SideChatOutcome,
} from '../types.ts'

const createValue = createSideChatValueSchema
const listValue = z.object({ items: z.array(sideChatSummarySchema) })
const treeValue = z.object({ items: z.array(sideChatTreeItemSchema) })
const getValue = z.object({ record: sideChatRecordSchema.nullable() })
const seedsValue = z.object({ items: z.array(seedMessageSchema) })
const assistantsValue = z.object({ items: z.array(assistantChoiceSchema) })
const foldValue = z.object({ fold: foldRecordSchema })
const stateValue = z.object({ state: z.union([
  z.literal('generating'), z.literal('prepared'), z.literal('pending'), z.literal('committed'), z.literal('failed'),
]) })
const statusValue = z.object({ record: sideChatRecordSchema })
const usageValue = usageReportSchema

type Output<T extends z.ZodType> = z.output<T>

/** Strict external-plugin Remote facade over the Typert SRC gateway. */
export class SideChatApi {
  constructor(private readonly ctx: Context) {}

  create(request: CreateSideChatRequest, signal?: AbortSignal): Promise<Output<typeof createValue>> {
    return this.call('create', request, createValue, signal)
  }

  list(parentSessionId: string, signal?: AbortSignal): Promise<Output<typeof listValue>> {
    return this.call('list', { parentSessionId }, listValue, signal)
  }

  tree(rootSessionId: string, signal?: AbortSignal): Promise<Output<typeof treeValue>> {
    return this.call('tree', { rootSessionId }, treeValue, signal)
  }

  workspaceSideChats(targetSessionId: string, signal?: AbortSignal): Promise<Output<typeof listValue>> {
    return this.call('workspaceSideChats', { targetSessionId }, listValue, signal)
  }

  catalog(sessionId: string, signal?: AbortSignal): Promise<Output<typeof listValue>> {
    return this.call('catalog', { sessionId }, listValue, signal)
  }

  get(sessionId: string, signal?: AbortSignal): Promise<Output<typeof getValue>> {
    return this.call('get', { sessionId }, getValue, signal)
  }

  seedChoices(sessionId: string, signal?: AbortSignal): Promise<Output<typeof seedsValue>> {
    return this.call('seedChoices', { sessionId }, seedsValue, signal)
  }

  assistantMessages(sessionId: string, signal?: AbortSignal): Promise<Output<typeof assistantsValue>> {
    return this.call('assistantMessages', { sessionId }, assistantsValue, signal)
  }

  usage(sessionId: string, signal?: AbortSignal): Promise<Output<typeof usageValue>> {
    return this.call('usage', { sessionId }, usageValue, signal)
  }

  prepareFold(
    childSessionId: string,
    foldId: string,
    mode: 'full' | 'incremental' = 'full',
    baseRevision?: number,
    signal?: AbortSignal,
  ): Promise<Output<typeof foldValue>> {
    return this.call('prepareFold', {
      childSessionId,
      foldId,
      mode,
      ...(baseRevision === undefined ? {} : { baseRevision }),
    }, foldValue, signal)
  }

  commitFold(
    childSessionId: string,
    foldId: string,
    content: string,
    allowStale = false,
    signal?: AbortSignal,
  ): Promise<Output<typeof stateValue>> {
    return this.call('commitFold', { childSessionId, foldId, content, allowStale }, stateValue, signal)
  }

  cite(childSessionId: string, messageId: string, citeId: string, signal?: AbortSignal): Promise<Output<typeof stateValue>> {
    return this.call('cite', { childSessionId, messageId, citeId }, stateValue, signal)
  }

  crossCite(
    targetSessionId: string,
    childSessionId: string,
    messageId: string,
    citeId: string,
    signal?: AbortSignal,
  ): Promise<Output<typeof stateValue>> {
    return this.call('crossCite', { targetSessionId, childSessionId, messageId, citeId }, stateValue, signal)
  }

  withdrawFold(
    childSessionId: string,
    foldId: string,
    reason: string,
    signal?: AbortSignal,
  ): Promise<Output<typeof stateValue>> {
    return this.call('withdrawFold', { childSessionId, foldId, reason }, stateValue, signal)
  }

  setStatus(
    childSessionId: string,
    action: 'archive' | 'restore' | 'abandon',
    signal?: AbortSignal,
  ): Promise<Output<typeof statusValue>> {
    return this.call('setStatus', { childSessionId, action }, statusValue, signal)
  }

  private async call<T extends z.ZodType>(
    method: string,
    request: unknown,
    schema: T,
    signal = new AbortController().signal,
  ): Promise<Output<T>> {
    const connection = this.ctx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error('SideChat requires an active Client connection')
    const carrier = await connection.rpc.call(
      '/sidechat',
      method,
      { request },
      signal,
    )
    if (!carrier.ok) throw new Error(carrier.error.message)
    const outcome = carrier.value as SideChatOutcome<unknown>
    if (typeof outcome !== 'object' || outcome === null || outcome.ok !== true) {
      const candidate = outcome as { readonly error?: { readonly message?: unknown } }
      throw new Error(typeof candidate.error?.message === 'string' ? candidate.error.message : 'SideChat request failed')
    }
    return schema.parse(outcome.value)
  }
}
