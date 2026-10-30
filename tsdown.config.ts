import { defineConfig } from 'tsdown'

const external = [/^@deepseek-ai\//, 'react', 'react/jsx-runtime']

export default defineConfig([
  {
    name: 'dsh-plugin-shengsuanyun',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    clean: true,
    external,
  },
  {
    name: 'dsh-plugin-shengsuanyun/client',
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    clean: false,
    dts: false,
    sourcemap: true,
    external,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-plugin-shengsuanyun", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
