import { defineConfig } from 'tsdown'

/** Product identity and private desktop update library entries. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/update-protocol.js', 'lib/types/update-shutdown.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})
