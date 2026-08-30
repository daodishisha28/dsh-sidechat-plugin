import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'sidechat-preset-root'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sidechatPresetRoot: { readonly path: string }
  }
}

export function apply(ctx: Context): void {
  ctx.provide('sidechatPresetRoot', Object.freeze({
    path: fileURLToPath(new URL('../presets', import.meta.url)),
  }))
}

export default apply
