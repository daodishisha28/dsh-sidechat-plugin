import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing dsh.bundle.patch')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('missing web dsh.client declaration')
for (const file of ['cordis.patch.yml', 'presets/sidechat-clarifier/agent.cordis.yml', 'lib/index.js', 'lib/client.js', 'lib/preset-root.js']) {
  await access(resolve(root, file))
}
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
for (const service of ['connection', 'locale', 'slots', 'sessions', 'commandUi']) {
  if (!clientExports.inject.includes(service)) throw new Error(`client inject is missing ${service}`)
}
const host = await readFile(resolve(root, 'src/service.ts'), 'utf8')
if (/append\(\s*['"]sidechat\//.test(host)) throw new Error('custom sidechat/* Session event detected')
if (/origin\s*:\s*['"]subagent['"]/.test(host)) throw new Error('subagent origin detected')
if (/\.fork\s*\(/.test(host)) throw new Error('Session fork detected')
console.log('bundle manifest, client handoff, preset, and forbidden-path checks passed')
