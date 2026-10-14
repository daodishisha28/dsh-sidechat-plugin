import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing dsh.bundle.patch')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('missing web dsh.client declaration')
// alpha.2 navigation requires the ui-workspace package to be declared for the
// Client loader (its `ctx.uiWorkspace` service backs every openSession call).
const clientInjectPackages = manifest.dsh?.client?.inject ?? []
for (const required of ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-commands', '@deepseek-ai/dsh-client-ui-workspace']) {
  if (!clientInjectPackages.includes(required)) throw new Error(`dsh.client.inject is missing ${required}`)
}
for (const file of ['cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
  await access(resolve(root, file))
}
const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
// Dedicated Connection RPC effects read webServer in the provider's Cordis
// shadow context in alpha.2. Caller-only inject grants do not suffice.
const connectionPatch = /^- id: connection\r?\n([\s\S]*?)(?=^- |$(?![\s\S]))/m.exec(patch)?.[1]
if (connectionPatch === undefined || !/\binject:/.test(connectionPatch)
  || !/^-?\s+- webStartup\s*$/m.test(connectionPatch)
  || !/^-?\s+- webServer\s*$/m.test(connectionPatch)) {
  throw new Error('Connection provider must retain webStartup and receive webServer for dedicated SideChat RPC')
}
if (!patch.includes("name: '@deepseek-ai/dsh-agent-preset'")) throw new Error('declarative agent preset row is missing from the bundle patch')
if (!patch.includes('id: sidechat-clarifier')) throw new Error('sidechat-clarifier preset id was not preserved')
if (!patch.includes('id: sidechat')) throw new Error('sidechat service row is missing from the bundle patch')
for (const banned of ['sidechat-preset-root', 'sidechatPresetRoot', '@deepseek-ai/dsh-agent-presets', 'dsh-workflow-worker-thread', 'backgroundMode']) {
  if (patch.includes(banned)) throw new Error(`bundle patch still references removed ${banned}`)
}
if (manifest.exports?.['./preset-root'] !== undefined) throw new Error('legacy ./preset-root export must stay removed')
const clientBundle = await readFile(resolve(root, 'lib/client.js'), 'utf8')
let clientHandoff
vm.runInNewContext(clientBundle, {
  window: {
    __ModuleLoader__: {
      load(value) {
        clientHandoff = value
      },
    },
  },
})
if (clientHandoff?.id !== 'dsh-sidechat-plugin' || typeof clientHandoff.factory !== 'function') {
  throw new Error('client bundle did not register with the DSH module loader')
}
const require = createRequire(import.meta.url)
const clientExports = clientHandoff.factory(require)
if ('default' in clientExports) throw new Error('client bundle must keep namespace plugin shape; default export drops inject in DSH Loader')
if (typeof clientExports?.apply !== 'function' || !Array.isArray(clientExports?.inject)) {
  throw new Error('client bundle does not expose the Cordis namespace plugin shape')
}
for (const service of ['connection', 'locale', 'slots', 'sessions', 'commandUi', 'uiWorkspace']) {
  if (!clientExports.inject.includes(service)) throw new Error(`client inject is missing ${service}`)
}
const host = await readFile(resolve(root, 'src/service.ts'), 'utf8')
if (/append\(\s*['"]sidechat\//.test(host)) throw new Error('custom sidechat/* Session event detected')
if (/origin\s*:\s*['"]subagent['"]/.test(host)) throw new Error('subagent origin detected')
if (/\.fork\s*\(/.test(host)) throw new Error('Session fork detected')
console.log('bundle manifest, declarative preset, client handoff, and forbidden-path checks passed')
