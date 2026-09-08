import { copyFile } from 'node:fs/promises'
import { clientBundle } from '../tsdown.client.ts'

const stylesheetSource = new URL('./src/client/Workbench.module.css', import.meta.url)
const stylesheetOutput = new URL('./lib/types/client/Workbench.module.css', import.meta.url)

export default clientBundle('@deepseek-ai/dsh-client-ui-mantur-editing', ['lib/types/index.js'], {
  hostPhase: true,
  lib: {
    plugins: [{
      name: 'mantur-editing-emitted-stylesheet',
      async buildStart() { await copyFile(stylesheetSource, stylesheetOutput) },
    }],
  },
})
