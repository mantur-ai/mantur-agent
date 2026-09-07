import { defineConfig } from 'tsdown'

/** Bundle the native desktop carrier without embedding Electron itself. */
export default defineConfig([{
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron', 'electron-updater'] },
}, {
  entry: { preload: 'lib/types/preload.js' },
  outDir: 'lib', format: ['cjs'], platform: 'node', target: 'es2024',
  outExtensions: () => ({ js: '.cjs' }), dts: false, clean: false,
  deps: { neverBundle: ['electron'] },
}])
