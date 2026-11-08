# One-click demo: starts Ollama (if needed), the demo backend, the proxy + Traffic Lab,
# the dashboard and a headless traffic generator, each in its own terminal tab,
# then opens the dashboard and the Lab in the browser.
#
#   demo.cmd                          (double-click, from the repo root)
#   demo.cmd -Rate 5 -Malicious 40    (busier attack mix)
#   demo.cmd -NoTraffic               (start everything, drive the Lab by hand)
#   demo.cmd -Stop                    (stop all demo services)
param(
  [double]$Rate = 3,
  [int]$Malicious = 30,
  [switch]$NoTraffic,
  [switch]$Stop
)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

# Fresh PATH from the registry: a long-lived shell may predate the Go/Ollama installs
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$Ports = [ordered]@{ "Demo backend" = 9000; "Proxy" = 8080; "Traffic Lab" = 8081; "Dashboard" = 3000 }

function Test-Port([int]$Port) {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if ($Stop) {
  foreach ($name in $Ports.Keys) {
    $conns = Get-NetTCPConnection -LocalPort $Ports[$name] -State Listen -ErrorAction SilentlyContinue
    foreach ($procId in ($conns.OwningProcess | Sort-Object -Unique)) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "stopped $name (pid $procId)"
    }
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*demo-traffic.mjs*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "stopped traffic generator (pid $($_.ProcessId))" }
  Write-Host "demo stopped (Ollama left running)"
  return
}

# --- Pre-flight ---------------------------------------------------------------
foreach ($tool in "node", "npm", "go") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed or not on PATH" }
}
$envFile = Join-Path $Root "web\.env.local"
if (-not (Test-Path $envFile) -or -not (Select-String -Path $envFile -Pattern '^\s*MONGODB_URI\s*=\s*\S' -Quiet)) {
  throw "web\.env.local needs MONGODB_URI (copy web\.env.example). Proxy and dashboard must share one MongoDB."
}
if (-not (Test-Path (Join-Path $Root "web\node_modules"))) {
  Write-Host "installing dashboard dependencies..."
  npm --prefix web install
}

# --- Ollama (embeddings for the classifier) ------------------------------------
function Test-Ollama {
  try { Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 } catch { $null }
}
$tags = Test-Ollama
if (-not $tags) {
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { throw "Ollama is not running and not installed" }
  Write-Host "starting Ollama..."
  Start-Process ollama -ArgumentList "serve" -WindowStyle Minimized
  for ($i = 0; $i -lt 30 -and -not $tags; $i++) { Start-Sleep 1; $tags = Test-Ollama }
  if (-not $tags) { throw "Ollama did not start on :11434" }
}
if (-not ($tags.models.name -contains "embeddinggemma:300m")) {
  Write-Host "pulling embeddinggemma:300m (one-time, ~600 MB)..."
  ollama pull embeddinggemma:300m
}
Write-Host "Ollama ready"

# --- Terminals ---------------------------------------------------------------
$tabs = @()
if (Test-Port 9000) { Write-Host "Demo backend already on :9000, skipping" }
else { $tabs += @{ Title = "Backend :9000"; Cmd = "node scripts/demo-backend.mjs 9000" } }

# :8081 is only ever our Traffic Lab, so it identifies a running proxy
if (Test-Port 8081) { Write-Host "Proxy/Traffic Lab already on :8080/:8081, skipping" }
else {
  if (Test-Port 8080) { Write-Warning "something else is listening on :8080; the proxy will fail to bind. Stop it first." }
  $tabs += @{ Title = "Proxy :8080 + Lab :8081"; Cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-proxy.ps1" }
}

if (Test-Port 3000) { Write-Host "Dashboard already on :3000, skipping" }
else { $tabs += @{ Title = "Dashboard :3000"; Cmd = "npm --prefix web run dev" } }

if (-not $NoTraffic) {
  $tabs += @{ Title = "Traffic"; Cmd = "node scripts/demo-traffic.mjs --rate $Rate --malicious $Malicious" }
}

$wt = Get-Command wt -ErrorAction SilentlyContinue
foreach ($t in $tabs) {
  if ($wt) {
    # Every tab lands in one Windows Terminal window named hackrpi-demo.
    # No ';' in the command: wt treats it as a tab separator. --title names the tab.
    Start-Process wt -ArgumentList @("-w", "hackrpi-demo", "new-tab", "--title", "`"$($t.Title)`"", "-d", "`"$Root`"",
      "powershell", "-NoExit", "-NoProfile", "-Command", "`"$($t.Cmd)`"")
    Start-Sleep -Milliseconds 700
  } else {
    $inner = "`$host.UI.RawUI.WindowTitle='$($t.Title)'; $($t.Cmd)"
    Start-Process powershell -WorkingDirectory $Root -ArgumentList @("-NoExit", "-NoProfile", "-Command", $inner)
  }
  Write-Host "started $($t.Title)"
}

# --- Wait, then open the browser -----------------------------------------------
Write-Host "waiting for the Traffic Lab and dashboard (first run compiles Go and Next.js)..."
$deadline = (Get-Date).AddMinutes(4)
while ((Get-Date) -lt $deadline -and -not ((Test-Port 8081) -and (Test-Port 3000))) { Start-Sleep 2 }
foreach ($name in $Ports.Keys) {
  $state = if (Test-Port $Ports[$name]) { "up" } else { "NOT UP - check its tab" }
  Write-Host ("  {0,-13} :{1}  {2}" -f $name, $Ports[$name], $state)
}
if (Test-Port 3000) { Start-Process "http://localhost:3000" }
if (Test-Port 8081) { Start-Process "http://localhost:8081" }
Write-Host "demo running. Stop everything with: demo.cmd -Stop"
