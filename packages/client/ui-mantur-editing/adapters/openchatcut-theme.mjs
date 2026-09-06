/** OpenChatCut 0.2.14 presentation adapter; no project or media state is accessed. */
const palettes = {
  light: {
    bg: '#f5f5f5', inset: '#eeeeee', panel: '#ffffff', 'panel-alt': '#f7f7f7', hover: '#e8edf5',
    border: '#d5d8de', 'border-light': '#a5acb8', text: '#202124', 'text-muted': '#505662',
    'text-dim': '#626976', 'text-strong': '#16181d', accent: '#0062ed', 'accent-deep': '#0052c9',
    'accent-rgb': '0,98,237', 'on-accent': '#ffffff', 'ink-rgb': '24,28,35',
    'tl-track': '#f0f2f5', 'tl-side-panel': '#f7f7f7', success: '#16733c', danger: '#b42318', gold: '#815700',
  },
  dark: {
    bg: '#151619', inset: '#1b1c20', panel: '#202125', 'panel-alt': '#282a2f', hover: '#33363d',
    border: '#3c4048', 'border-light': '#636a77', text: '#eceef2', 'text-muted': '#c0c5ce',
    'text-dim': '#a3abb8', 'text-strong': '#ffffff', accent: '#0062ed', 'accent-deep': '#0052c9',
    'accent-rgb': '0,98,237', 'on-accent': '#ffffff', 'ink-rgb': '255,255,255',
    'tl-track': '#25272d', 'tl-side-panel': '#202125', success: '#70d79d', danger: '#ff9991', gold: '#efc568',
  },
}

/**
 * Install before OpenChatCut renders. Only the configured parent can change the embedded UI.
 * @param {Window} target - Editor window.
 * @param {string} parentOrigin - Exact trusted Mantur origin supplied by the editor deployment.
 * @returns {() => void} Removes the listener and restores previous inline presentation values.
 */
export function installManturTheme(target, parentOrigin) {
  const origin = new URL(parentOrigin)
  if (origin.origin !== parentOrigin || origin.protocol !== 'http:'
    || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    throw new Error('Mantur theme parent must be an exact loopback HTTP origin')
  }
  if (target.parent === target) return () => {}
  const initial = new URL(target.location.href).searchParams.get('manturTheme')
  if (initial !== 'light' && initial !== 'dark') throw new Error('Missing or invalid manturTheme')
  const root = target.document.documentElement
  const previous = new Map()
  const apply = scheme => {
    const tokens = { ...palettes[scheme], 'color-scheme': scheme, select: '#0062ed', 'shadow-rgb': '0,0,0' }
    for (const [name, value] of Object.entries(tokens)) {
      const property = `--cc-${name}`
      if (!previous.has(property)) previous.set(property, [root.style.getPropertyValue(property), root.style.getPropertyPriority(property)])
      root.style.setProperty(property, value)
    }
  }
  apply(initial)
  const receive = event => {
    if (event.source !== target.parent || event.origin !== parentOrigin) return
    const data = event.data
    if (data?.type !== 'mantur:theme' || data.version !== 1 || !['light', 'dark'].includes(data.scheme)) return
    apply(data.scheme)
  }
  target.addEventListener('message', receive)
  target.parent.postMessage({ type: 'mantur:theme-ready', version: 1 }, parentOrigin)
  return () => {
    target.removeEventListener('message', receive)
    for (const [name, [value, priority]] of previous) {
      if (value) root.style.setProperty(name, value, priority)
      else root.style.removeProperty(name)
    }
  }
}
