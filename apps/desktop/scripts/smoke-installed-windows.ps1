<#
.SYNOPSIS
Install an unsigned NSIS release and smoke its real Electron main on a disposable Windows runner.
.DESCRIPTION
Requires PowerShell 7 and a fresh OutputDirectory below RUNNER_TEMP. The test owns a unique
install/profile/temp tree, refuses an existing ManTur installation, and never sets Node mode
or disables Chromium sandboxing. Reports CI window/Host evidence, not human GUI or old-version upgrade acceptance.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$ExpectedVersion,
    [ValidateRange(30, 600)][int]$StartupTimeoutSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'This smoke requires native Windows x64 and PowerShell 7.'
}
if (-not $env:RUNNER_TEMP) { throw 'RUNNER_TEMP is required.' }
if (-not [IO.Path]::IsPathFullyQualified($Installer) -or -not [IO.Path]::IsPathFullyQualified($OutputDirectory)) {
    throw 'Installer and OutputDirectory must be absolute paths.'
}
$runnerTemp = (Get-Item -LiteralPath $env:RUNNER_TEMP).FullName.TrimEnd('\')
$Installer = (Get-Item -LiteralPath $Installer).FullName
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $OutputDirectory.StartsWith($runnerTemp + '\', [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $OutputDirectory)) {
    throw 'OutputDirectory must be a new directory strictly below RUNNER_TEMP.'
}
if ([System.IO.Path]::GetExtension($Installer) -ne '.exe') { throw 'Installer must be an existing EXE.' }
$ancestor = [IO.Path]::GetDirectoryName($OutputDirectory)
while ($ancestor.StartsWith($runnerTemp, [StringComparison]::OrdinalIgnoreCase)) {
    if ((Test-Path -LiteralPath $ancestor) -and
        ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'OutputDirectory must not traverse a junction or symbolic link.'
    }
    if ($ancestor -eq $runnerTemp) { break }
    $ancestor = [IO.Path]::GetDirectoryName($ancestor)
}
$runRoot = Join-Path $runnerTemp ('mantur-installed-' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $runRoot '中文 安装目录'
$profileRoot = Join-Path $runRoot '隔离 profile'
$processTemp = Join-Path $runRoot 'temp'
$installedExe = Join-Path $installRoot 'ManTur Agent.exe'
$logPath = Join-Path $profileRoot 'logs\harness.log'
$runRootOwned = $false
$ownedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$report = [ordered]@{
    schemaVersion = 1; startedAt = [DateTime]::UtcNow.ToString('o'); status = 'FAIL'; expectedVersion = $ExpectedVersion
    scope = 'Fresh unsigned NSIS installation and one real isolated Electron main/Host startup on Windows CI'
    runRoot = $runRoot; installRoot = $installRoot; profileRoot = $profileRoot
    humanAboutTested = $false; oldVersionUpgradeTested = $false; forcedCleanupUsed = $false
    normalMainExit = $false; cleanupComplete = $false; failures = @()
}

function Protect-PrivateDirectory([string]$Path) {
    [void](New-Item -ItemType Directory -Path $Path)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path '/inheritance:r' '/grant:r' "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not restrict temporary directory ACL: $Path" }
}

function Get-ExecutableIdentity([string]$Path) {
    $file = Get-Item -LiteralPath $Path
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($Path))
    try {
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw "EXE lacks a DOS signature: $Path" }
        $reader.BaseStream.Position = 0x3c
        $peOffset = $reader.ReadInt32()
        $reader.BaseStream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550) { throw "EXE lacks a PE signature: $Path" }
        $machine = $reader.ReadUInt16()
    } finally { $reader.Dispose() }
    $identity = [ordered]@{
        path = $file.FullName; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        fileVersion = $file.VersionInfo.FileVersion; productVersion = $file.VersionInfo.ProductVersion
        authenticodeStatus = [string]$signature.Status; peMachine = ('0x{0:x4}' -f $machine)
    }
    return $identity
}

function Start-OwnedProcess([string]$Executable, [string]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.Arguments = $Arguments
    $start.UseShellExecute = $false
    $start.WorkingDirectory = $runRoot
    foreach ($name in @($start.Environment.Keys)) {
        if ($name -match 'KEY|SECRET|TOKEN|PASSWORD' -or $name -match '^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|DSH_HOME|DSH_MANTUR_.*)$') {
            [void]$start.Environment.Remove($name)
        }
    }
    $start.Environment['TEMP'] = $processTemp
    $start.Environment['TMP'] = $processTemp
    $start.Environment['DSH_TELEMETRY_DISABLED'] = '1'
    $process = [Diagnostics.Process]::Start($start)
    $ownedProcesses.Add($process)
    return $process
}

function Get-InstalledProcesses {
    return @(Get-CimInstance Win32_Process -Filter "Name='ManTur Agent.exe'" |
        Where-Object { $_.ExecutablePath -eq $installedExe } |
        Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine, CreationDate)
}

function Get-ExistingInstallations {
    $roots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
               'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
               'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
    foreach ($root in $roots) {
        if (Test-Path -LiteralPath $root) {
            Get-ChildItem -LiteralPath $root | ForEach-Object {
                $entry = Get-ItemProperty -LiteralPath $_.PSPath
                if ($entry.PSObject.Properties['DisplayName'] -and $entry.DisplayName -like 'ManTur Agent*') {
                    [pscustomobject]@{ key = $_.Name; displayName = $entry.DisplayName; installLocation = $entry.InstallLocation }
                }
            }
        }
    }
}

function Wait-OwnedExit([Diagnostics.Process]$Process, [int]$Seconds, [string]$Stage) {
    if (-not $Process.WaitForExit($Seconds * 1000)) { throw "$Stage timed out after $Seconds seconds." }
    if ($Process.ExitCode -ne 0) { throw "$Stage exited with code $($Process.ExitCode)." }
}

Protect-PrivateDirectory $OutputDirectory
try {
    $existing = @(Get-ExistingInstallations)
    $existingProcesses = @(Get-CimInstance Win32_Process -Filter "Name='ManTur Agent.exe'")
    if ($existing.Count -ne 0 -or $existingProcesses.Count -ne 0) {
        throw 'Refusing to install on a runner with an existing ManTur installation or process.'
    }
    foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('DesktopDirectory'))) {
        if (Test-Path -LiteralPath (Join-Path $folder 'ManTur Agent.lnk')) {
            throw 'Refusing to replace an existing ManTur shortcut.'
        }
    }
    Protect-PrivateDirectory $runRoot
    $runRootOwned = $true
    [void](New-Item -ItemType Directory -Path $processTemp)
    [void](New-Item -ItemType Directory -Path $profileRoot)
    $report['installer'] = Get-ExecutableIdentity $Installer
    if ($report.installer.authenticodeStatus -ne 'NotSigned') { throw 'Installer is not the expected unsigned artifact.' }
    # Assisted NSIS does not auto-run during /S unless --force-run is supplied.
    # NSIS requires unquoted /D= to be the final argument, including paths containing spaces.
    $installArguments = '/S /currentuser --no-desktop-shortcut /D=' + $installRoot
    $installerProcess = Start-OwnedProcess $Installer $installArguments
    $report['installation'] = [ordered]@{ pid = $installerProcess.Id; arguments = $installArguments; timedOut = $false; exitCode = $null }
    try { Wait-OwnedExit $installerProcess 300 'NSIS installation' }
    finally {
        $report.installation.timedOut = -not $installerProcess.HasExited
        if ($installerProcess.HasExited) { $report.installation.exitCode = $installerProcess.ExitCode }
    }
    if (@(Get-InstalledProcesses).Count -ne 0) { throw 'Silent installer unexpectedly launched the application.' }
    $report['installedApplication'] = Get-ExecutableIdentity $installedExe
    if ($report.installedApplication.authenticodeStatus -ne 'NotSigned') { throw 'Installed application is not the expected unsigned artifact.' }
    if ($report.installedApplication.peMachine -ne '0x8664') { throw 'Installed application is not a Windows x64 PE.' }
    $productVersion = [string]$report.installedApplication.productVersion
    if ($productVersion -notmatch ('^' + [regex]::Escape($ExpectedVersion) + '(?:\.0)?$')) {
        throw "Installed ProductVersion differs: $productVersion"
    }
    $package = Get-Content -LiteralPath (Join-Path $installRoot 'resources\app\package.json') -Raw | ConvertFrom-Json
    if ($package.version -ne $ExpectedVersion) { throw 'Installed package.json version differs.' }
    $report['installedPackageVersion'] = $package.version

    $launchArguments = '--user-data-dir="' + $profileRoot + '"'
    $main = Start-OwnedProcess $installedExe $launchArguments
    $report['launch'] = [ordered]@{ pid = $main.Id; arguments = $launchArguments; electronRunAsNode = $false; sandboxDisabled = $false }
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $readyUrl = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($main.HasExited) { throw "Electron main exited before readiness: $($main.ExitCode)" }
        if (Test-Path -LiteralPath $logPath) {
            [string]$log = Get-Content -LiteralPath $logPath -Raw
            $match = [regex]::Match($log, '(?m)^dsh web: (http://127\.0\.0\.1:\d+/\?token=[^\s]+)')
            if ($match.Success) { $readyUrl = [uri]$match.Groups[1].Value; break }
        }
        Start-Sleep -Milliseconds 250
    }
    if ($null -eq $readyUrl) { throw 'Installed Host did not report readiness before the deadline.' }
    $processes = @(Get-InstalledProcesses)
    $mainRows = @($processes | Where-Object { $_.ProcessId -eq $main.Id -and $_.CommandLine.Contains($profileRoot) })
    $hostRows = @($processes | Where-Object { $_.ParentProcessId -eq $main.Id -and $_.CommandLine -match '--profile\s+mantur(?:\s|$)' })
    if ($mainRows.Count -ne 1 -or $hostRows.Count -ne 1) { throw 'Installed main/profile/Host process relationship is not unique.' }
    $report['processesAtReadiness'] = $processes
    $hostId = [int]$hostRows[0].ProcessId
    $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $hostId | Where-Object {
        $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq $readyUrl.Port
    })
    if ($listeners.Count -ne 1) { throw 'Ready URL listener is not owned by the actual Host child.' }
    $report['hostListener'] = @{ processId = $hostId; origin = $readyUrl.GetLeftPart([UriPartial]::Authority); port = $readyUrl.Port }

    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseCookies = $true
    $handler.UseProxy = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    try {
        $exchange = $client.GetAsync($readyUrl).GetAwaiter().GetResult()
        try {
            if ([int]$exchange.StatusCode -ne 303 -or -not $exchange.Headers.Contains('Set-Cookie')) {
                throw 'Installed Host launch-token exchange did not return its expected redirect/cookie.'
            }
        } finally { $exchange.Dispose() }
        $page = $client.GetAsync($readyUrl.GetLeftPart([UriPartial]::Authority) + '/').GetAwaiter().GetResult()
        try {
            $html = $page.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if ([int]$page.StatusCode -ne 200 -or -not $html.Contains('__DSH_BOOT__') -or -not $html.Contains('<title>ManTur Agent</title>')) {
                throw 'Installed Host did not serve the actual ManTur application boot page.'
            }
            $report['http'] = @{ exchangeStatus = 303; pageStatus = 200; bootPayload = $true; title = 'ManTur Agent'; responseCharacters = $html.Length }
        } finally { $page.Dispose() }
    } finally { $client.Dispose(); $handler.Dispose() }

    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ManturSmokeWindow {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
}
'@
    $windowDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $main.Refresh()
        if ($main.HasExited) { throw 'Electron main exited before window observation.' }
        if ($main.MainWindowHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $windowDeadline)
    if ($main.MainWindowHandle -eq [IntPtr]::Zero) { throw 'No native main window appeared.' }
    $windowOwner = [uint32]0
    [void][ManturSmokeWindow]::GetWindowThreadProcessId($main.MainWindowHandle, [ref]$windowOwner)
    $rect = [ManturSmokeWindow+Rect]::new()
    if ($windowOwner -ne $main.Id -or -not [ManturSmokeWindow]::GetWindowRect($main.MainWindowHandle, [ref]$rect)) {
        throw 'Main window ownership could not be verified.'
    }
    $report['window'] = @{ handle = $main.MainWindowHandle.ToInt64(); ownerPid = $windowOwner; title = $main.MainWindowTitle
        width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top; screenshot = 'unavailable' }
    try {
        Add-Type -AssemblyName System.Drawing
        $bitmap = [Drawing.Bitmap]::new($report.window.width, $report.window.height)
        try {
            $graphics = [Drawing.Graphics]::FromImage($bitmap)
            try { $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size) }
            finally { $graphics.Dispose() }
            $bitmap.Save((Join-Path $OutputDirectory 'main-window.png'), [Drawing.Imaging.ImageFormat]::Png)
        } finally { $bitmap.Dispose() }
        $report.window.screenshot = 'main-window.png; CI capture only, no human visual verdict'
    } catch { $report.window.screenshot = 'Capture unavailable: ' + $_.Exception.GetType().Name }

    $report['closeMainWindowRequested'] = $main.CloseMainWindow()
    if (-not $report.closeMainWindowRequested) { throw 'Normal native window-close request was not accepted.' }
    Wait-OwnedExit $main 30 'Normal Electron main exit'
    $report['mainExitCode'] = $main.ExitCode
    $report.normalMainExit = $true
    $exitDeadline = [DateTime]::UtcNow.AddSeconds(15)
    while (@(Get-InstalledProcesses).Count -ne 0 -and [DateTime]::UtcNow -lt $exitDeadline) { Start-Sleep -Milliseconds 250 }
    $report['processesAfterNormalExit'] = @(Get-InstalledProcesses)
    if ($report.processesAfterNormalExit.Count -ne 0) { throw 'Installed child processes survived normal main exit.' }
    $report.status = 'PASS'
} catch {
    $report.failures += $_.Exception.Message -replace '(?i)(token=)[^\s]+', '$1[redacted]'
} finally {
    try {
        if ($runRootOwned -and (Test-Path -LiteralPath $logPath)) {
            $redacted = (Get-Content -LiteralPath $logPath -Raw) -replace '(?i)(token=)[^\s]+', '$1[redacted]'
            Set-Content -LiteralPath (Join-Path $OutputDirectory 'harness-redacted.log') -Value $redacted -Encoding utf8
        }
    } catch {
        $report.status = 'FAIL'
        $report.failures += 'Could not preserve redacted startup diagnostics: ' + $_.Exception.GetType().Name
    }
    try {
        foreach ($process in $ownedProcesses) {
            if (-not $process.HasExited) {
                $report.forcedCleanupUsed = $true
                $process.Kill($true)
                if (-not $process.WaitForExit(10000)) { throw 'Owned process did not exit after failure cleanup.' }
            }
        }
        $remaining = @()
        if ($runRootOwned) { $remaining = @(Get-InstalledProcesses) }
        foreach ($row in $remaining) {
            $orphan = Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue
            if ($null -ne $orphan -and $orphan.Path -eq $installedExe) {
                $report.forcedCleanupUsed = $true
                $orphan.Kill($true)
                if (-not $orphan.WaitForExit(10000)) { throw 'Owned installed child did not exit after failure cleanup.' }
            }
        }
        if ($report.forcedCleanupUsed) { $report.status = 'FAIL' }
        $uninstaller = Join-Path $installRoot 'Uninstall ManTur Agent.exe'
        if ($runRootOwned -and (Test-Path -LiteralPath $uninstaller)) {
            $uninstallProcess = Start-OwnedProcess $uninstaller ('/S /currentuser _?=' + $installRoot)
            Wait-OwnedExit $uninstallProcess 120 'Owned NSIS uninstall'
            $report['uninstallExitCode'] = $uninstallProcess.ExitCode
        }
        if ($runRootOwned -and @(Get-InstalledProcesses).Count -ne 0) { throw 'Owned processes remain after cleanup.' }
        if ($runRootOwned -and @(Get-ExistingInstallations | Where-Object { $_.installLocation -eq $installRoot }).Count -ne 0) {
            throw 'Owned installer registry entry remains after uninstall.'
        }
        if ($runRootOwned -and (Test-Path -LiteralPath $runRoot)) { Remove-Item -LiteralPath $runRoot -Recurse -Force }
        $report.cleanupComplete = $true
    } catch {
        $report.status = 'FAIL'
        $report.failures += 'Cleanup failed: ' + $_.Exception.Message
    }
    foreach ($process in $ownedProcesses) {
        try {
            if (-not $process.HasExited) {
                $report.status = 'FAIL'
                $report.forcedCleanupUsed = $true
                $process.Kill($true)
                if (-not $process.WaitForExit(10000)) { $report.failures += 'Owned process remains after final cleanup deadline.' }
            }
        } catch { $report.status = 'FAIL'; $report.failures += 'Final process cleanup failed: ' + $_.Exception.Message }
        finally { $process.Dispose() }
    }
    $report['finishedAt'] = [DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'RESULT.json') -Encoding utf8
}
if ($report.status -ne 'PASS') { throw 'Installed Windows smoke failed; see RESULT.json and redacted diagnostics.' }
Write-Output ('Installed Windows smoke PASS: ' + (Join-Path $OutputDirectory 'RESULT.json'))
