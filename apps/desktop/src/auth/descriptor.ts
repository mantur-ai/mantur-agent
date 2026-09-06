/** Private, command-scoped broker descriptor publication; no device bearer is written or passed to a subprocess. */
import { execFile } from 'node:child_process'
import { lstat, mkdtemp, open, rmdir, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { NativeBrokerDescriptor } from './broker.ts'

const protectWindowsDirectory = `
$ErrorActionPreference = 'Stop'
$path = $env:MANTUR_NATIVE_DESCRIPTOR_DIR
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl($path, $acl)
$actual = Get-Acl -LiteralPath $path
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or $rules[0].InheritanceFlags -ne $inherit) { throw 'Private directory ACL verification failed' }
`

async function restrictWindowsDirectory(path: string, signal: AbortSignal): Promise<void> {
  const windowsRoot = process.env.SystemRoot
  if (windowsRoot === undefined || !isAbsolute(windowsRoot)) throw new Error('Native descriptor requires the Windows system directory')
  const executable = join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  signal.throwIfAborted()
  const result = Promise.withResolvers<undefined>()
  const child = execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(protectWindowsDirectory, 'utf16le').toString('base64')], {
    env: { SystemRoot: windowsRoot, MANTUR_NATIVE_DESCRIPTOR_DIR: path }, windowsHide: true, maxBuffer: 8_192,
  }, (error) => {
    if (error === null) result.resolve(undefined)
    else result.reject(new Error('Native descriptor Windows ACL setup failed'))
  })
  const closed = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
  const stop = (): void => { child.kill() }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  try { await result.promise; signal.throwIfAborted() }
  finally { signal.removeEventListener('abort', stop); await closed }
}

/**
 * Publish one private descriptor and retain it until the complete command scope ends.
 * @param root - existing application-owned user-data directory, never a Workspace or renderer-supplied path.
 * @param descriptor - Main-created broker-v2 local capability; it contains no account bearer.
 * @param signal - cancellation covering directory security, publication and command execution.
 * @param execute - rechecks cancellation before spawning, then awaits whole-tree termination before returning.
 * @returns completion after the descriptor and its exclusively-created directory are removed.
 */
export async function withNativeBrokerDescriptor(root: string, descriptor: NativeBrokerDescriptor, signal: AbortSignal,
  execute: (environment: Readonly<Record<string, string>>) => Promise<void>): Promise<void> {
  if (!isAbsolute(root)) throw new Error('Native descriptor root must be absolute')
  const parent = await lstat(root)
  if (!parent.isDirectory() || parent.isSymbolicLink()
    || (process.platform !== 'win32' && parent.uid !== process.getuid?.())) throw new Error('Native descriptor root must be an owned directory')
  signal.throwIfAborted()
  const directory = await mkdtemp(join(root, 'native-command-'))
  const path = join(directory, 'authorization.json')
  let published = false
  try {
    if (process.platform === 'win32') await restrictWindowsDirectory(directory, signal)
    const bytes = Buffer.from(JSON.stringify(descriptor), 'utf8')
    if (bytes.length > 16_384) throw new Error('Native descriptor exceeds the broker-v2 limit')
    signal.throwIfAborted()
    const file = await open(path, 'wx', 0o600)
    published = true
    try {
      await file.writeFile(bytes)
      await file.sync()
      const record = await file.stat()
      if (!record.isFile() || record.nlink !== 1 || (process.platform !== 'win32'
        && (record.uid !== process.getuid?.() || (record.mode & 0o077) !== 0))) throw new Error('Native descriptor file is not private')
    } finally { await file.close() }
    signal.throwIfAborted()
    await execute({ MANTURHUB_IDENTITY_MODE: 'desktop-managed', MANTURHUB_AGENT_AUTH: path })
    signal.throwIfAborted()
  } finally {
    if (published) await unlink(path)
    await rmdir(directory)
  }
}
