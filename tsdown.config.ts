import { defineConfig, type UserConfig } from 'tsdown'

const hostExternal = (specifier: string): boolean =>
  specifier.startsWith('@deepseek-ai/') || specifier === 'zod' || specifier.startsWith('zod/')

const host: UserConfig = {
  name: 'dsh-sidechat-plugin/host',
  entry: {
    index: 'lib/types/index.js',
    'preset-root': 'lib/types/preset-root.js',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  clean: false,
  sourcemap: true,
  dts: false,
  deps: {
    neverBundle: hostExternal,
    alwaysBundle: specifier => !hostExternal(specifier),
  },
}

const client: UserConfig = {
  name: 'dsh-sidechat-plugin/client',
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  clean: false,
  sourcemap: true,
  dts: false,
  deps: {
    neverBundle: specifier => specifier === 'react' || specifier === 'react/jsx-runtime',
    alwaysBundle: specifier => specifier !== 'react' && specifier !== 'react/jsx-runtime',
  },
  outputOptions: {
    exports: 'named',
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-sidechat-plugin", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    sourcemapExcludeSources: false,
  },
}

export default defineConfig([host, client])
