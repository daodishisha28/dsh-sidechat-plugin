import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export default defineConfig({
  plugins: [{
    name: 'dsh-sidechat-standard-decorators',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]src[\\/]service\.ts$/u.test(id)) return undefined
      return ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext },
        fileName: id,
      }).outputText
    },
  }],
  resolve: {
    alias: {
      '@deepseek-ai/cordis': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/schemastery': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/dsh-llm': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/dsh-session': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/dsh-typert-protocol': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/dsh-tools': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/dsh-sandbox-policy': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/dsh-user-approval': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/dsh-storage-domain': fileURLToPath(new URL('./tests/shims/dsh-runtime.ts', import.meta.url)),
      '@deepseek-ai/dsh-token-meter/client': fileURLToPath(new URL('./tests/shims/token-meter.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.{ts,tsx}'],
    pool: 'threads',
    maxWorkers: 1,
    coverage: { reporter: ['text', 'json-summary'] },
  },
})
