import { describe, expect, it } from 'vitest'
import {
  SIDECHAT_READ_TOOL_NAME,
  SIDECHAT_READ_TOOL_PARAMETERS,
  sideChatReadSchemaTokenEstimate,
} from '../src/tool-contract.ts'

describe('sidechat_read prompt schema budget', () => {
  it('stays precise and below the M2 prompt-cache budget', () => {
    expect(SIDECHAT_READ_TOOL_NAME).toBe('sidechat_read')
    expect(SIDECHAT_READ_TOOL_PARAMETERS.message_ids.description).toContain('no transcript ranges')
    expect(sideChatReadSchemaTokenEstimate()).toBeLessThanOrEqual(180)
  })
})
