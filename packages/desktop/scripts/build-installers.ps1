# build-installers.ps1 — produce the Windows installers (NSIS .exe + WiX .msi) for
# "CIC - Text and TUDF converter".
#
# This is the PowerShell twin of build-installers.sh, for a Windows box with no Git Bash.
# Same three jobs: write the .env the login gate needs, install deps, build — then REFUSE
# to hand you an installer whose login gate isn't actually baked in.
#
# USAGE (from packages/desktop):
#   powershell -ExecutionPolicy Bypass -File scripts\build-installers.ps1
#
#   # point at a different backend (default is production):
#   $env:VITE_LICENSE_SERVER_URL = "http://127.0.0.1:3000"
#   powershell -ExecutionPolicy Bypass -File scripts\build-installers.ps1
#
# PREREQUISITES: Node 20+, Rust (rustup, MSVC toolchain), Visual Studio 2022 C++ Build
# Tools, WebView2 runtime (ships with Windows 10/11).

$ErrorActionPreference = 'Stop'

# The licence/session backend baked into the build. `.env` is gitignored, so a fresh clone
# has none — and without it the app ships with NO login gate (auth.ts: serverConfigured()).
$DefaultLicenseServer = 'https://api.vidyasetu.net'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Split-Path -Parent $ScriptDir
$RootDir    = Split-Path -Parent (Split-Path -Parent $DesktopDir)
Set-Location $DesktopDir

$BundleDir = 'src-tauri\target\release\bundle'

# --- .env (the login gate) --------------------------------------------------
# Precedence: exported $env:VITE_LICENSE_SERVER_URL > existing .env entry > production.
# An existing .env is never silently discarded — only this one key is rewritten.
$current = ''
if (Test-Path .env) {
  $line = Select-String -Path .env -Pattern '^\s*VITE_LICENSE_SERVER_URL\s*=\s*(.*)$' | Select-Object -Last 1
  if ($line) { $current = $line.Matches[0].Groups[1].Value.Trim() }
}

$url = if ($env:VITE_LICENSE_SERVER_URL) { $env:VITE_LICENSE_SERVER_URL }
       elseif ($current)                 { $current }
       else                              { $DefaultLicenseServer }

if (-not $url) {
  Write-Error 'No licence server URL — the build would have NO login gate.'
  exit 1
}

if ($url -ne $current) {
  $keep = @()
  if (Test-Path .env) {
    $keep = Get-Content .env | Where-Object { $_ -notmatch '^\s*VITE_LICENSE_SERVER_URL\s*=' }
  } else {
    $keep = @('# Written by scripts\build-installers.ps1 — the backend the login gate talks to.')
  }
  ($keep + "VITE_LICENSE_SERVER_URL=$url") | Set-Content -Encoding ascii .env
}

# Host only — that is what actually appears in the minified bundle.
$licenseHost = ([uri]$url).Host
Write-Host "> login gate -> $url"

# --- dependencies -----------------------------------------------------------
# The desktop imports the shared engine from packages/core/src, which imports `exceljs`;
# Rollup resolves that from an ancestor node_modules, so the REPO ROOT must be installed
# too — otherwise the build dies with "Rollup failed to resolve import 'exceljs'".
if (-not (Test-Path (Join-Path $RootDir 'node_modules'))) {
  Write-Host '> installing root deps (shared core engine)...'
  Push-Location $RootDir; npm install; Pop-Location
}
if (-not (Test-Path 'node_modules')) {
  Write-Host '> installing desktop deps...'
  npm install
}

# --- build ------------------------------------------------------------------
Write-Host '> building Windows installers (.exe NSIS + .msi WiX)...'
npm run tauri:build -- --bundles nsis,msi
if ($LASTEXITCODE -ne 0) { Write-Error 'tauri build failed'; exit $LASTEXITCODE }

# --- verify the gate --------------------------------------------------------
# The build SUCCEEDS whether or not the gate URL made it in, so check the bundle itself.
# An installer that opens with no login is the failure we most need to catch here.
if (Select-String -Path 'dist\**\*' -Pattern ([regex]::Escape($licenseHost)) -List -ErrorAction SilentlyContinue) {
  Write-Host "> login gate baked into dist ($licenseHost) OK"
} else {
  Write-Error "Login gate NOT in the built frontend — the app would run UNGATED. Aborting."
  exit 1
}

# --- report artifacts -------------------------------------------------------
Write-Host ''
Write-Host '> artifacts:'
$found = $false
foreach ($sub in @('nsis', 'msi')) {
  $d = Join-Path $BundleDir $sub
  if (-not (Test-Path $d)) { continue }
  Get-ChildItem -Path $d -File -Include *.exe, *.msi -Recurse | ForEach-Object {
    '{0,8:N1} MB  {1}' -f ($_.Length / 1MB), $_.FullName | Write-Host
    $script:found = $true
  }
}
if (-not $found) { Write-Host '   (no installers found — check the build output above)' }
Write-Host ''
Write-Host 'done.'
