/** Native regression launcher reproducing a GUI host without an attached console. */
import koffi from 'koffi'
const kernel = koffi.load('kernel32.dll')
const freeConsole = kernel.func('__stdcall', 'FreeConsole', 'int', [])
const getConsoleCP = kernel.func('__stdcall', 'GetConsoleCP', 'uint32', [])
if (getConsoleCP() !== 0 && freeConsole() === 0) throw new Error('FreeConsole failed in native fixture')
await import('../../src/runner.ts')
