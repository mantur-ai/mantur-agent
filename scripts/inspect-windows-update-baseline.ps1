<# Read the exact published Windows installer without installing or launching it. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Baseline evidence directory must be new.' }
New-Item -ItemType Directory -Path $output | Out-Null
$scratch = Join-Path $env:RUNNER_TEMP ('mantur-windows-baseline-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$url = 'https://mantur-pro.tos-accelerate.volces.com/mantur-agent/releases/0.1.20/Mantur-Agent-Windows-x64.exe'
$expected = '624cb868efb53d960abd13e25971185a36574c096ee1a6f3d05b564122cae917'
try {
  $installer = Join-Path $scratch 'baseline.exe'
  Invoke-WebRequest -Uri $url -OutFile $installer
  $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $expected -or (Get-Item -LiteralPath $installer).Length -ne 686358165) {
    throw 'Published Windows 0.1.20 installer differs from the observed baseline.'
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  $sevenZip = (Get-Command 7z.exe -ErrorAction Stop).Source
  $listing = & $sevenZip l -slt $installer 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect baseline NSIS archive.' }
  $listing | Set-Content -LiteralPath (Join-Path $output 'nsis-listing.txt') -Encoding utf8
  $payloads = @($listing | Where-Object { $_ -match '^Path = (.+app-64\.7z)$' } | ForEach-Object { $_.Substring(7) })
  if ($payloads.Count -ne 1) { throw 'Expected exactly one x64 application payload in baseline NSIS.' }
  & $sevenZip x $installer ('-o' + $scratch) $payloads[0] -y | Out-File (Join-Path $output 'extract-payload.log')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot extract baseline application payload.' }
  $payload = Join-Path $scratch $payloads[0]
  & $sevenZip x $payload ('-o' + $scratch) 'resources/app-update.yml' 'resources/app/package.json' -y | Out-File (Join-Path $output 'extract-update-config.log')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot extract baseline update configuration.' }
  $update = Join-Path $scratch 'resources/app-update.yml'
  $package = Join-Path $scratch 'resources/app/package.json'
  if (!(Test-Path -LiteralPath $update) -or !(Test-Path -LiteralPath $package)) { throw 'Baseline update configuration or package identity is absent.' }
  $packageInfo = Get-Content -LiteralPath $package -Raw | ConvertFrom-Json
  if ($packageInfo.version -ne '0.1.20') { throw 'Baseline payload version is not 0.1.20.' }
  Copy-Item -LiteralPath $update -Destination (Join-Path $output 'app-update.yml')
  $updateText = Get-Content -LiteralPath $update -Raw
  $publisherConfigured = [bool]($updateText -match '(?m)^publisherName\s*:')
  [ordered]@{
    observedAt = (Get-Date).ToUniversalTime().ToString('o')
    installerUrl = $url
    version = $packageInfo.version
    bytes = 686358165
    sha256 = $hash
    authenticodeStatus = [string]$signature.Status
    signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    timestampSubject = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
    publisherNamePresent = $publisherConfigured
    updateConfigSha256 = (Get-FileHash -LiteralPath $update -Algorithm SHA256).Hash.ToLowerInvariant()
    interpretation = 'Captured installed-input policy only; no installation, automatic-upgrade success, or signature bypass is asserted.'
    installed = $false
    launched = $false
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'RESULT.json') -Encoding utf8
}
finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force
}
