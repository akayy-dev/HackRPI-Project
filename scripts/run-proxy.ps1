# Runs the Go reverse proxy against the same MongoDB as the dashboard.
# Reads MONGODB_URI / MONGODB_DB / MONGODB_COLLECTION from web/.env.local so the
# secret never has to be pasted or echoed. Already-set env vars win.
#
#   powershell -ExecutionPolicy Bypass -File scripts/run-proxy.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/run-proxy.ps1 -Backend http://127.0.0.1:9000
param(
  [string]$Backend = "http://127.0.0.1:9000",
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\web\.env.local")
)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$vars = @{}
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
      $vars[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
    }
  }
}

function Set-Default([string]$name, [string]$value) {
  if (-not [Environment]::GetEnvironmentVariable($name) -and $value) {
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

Set-Default "MONGODB_URI"        $vars["MONGODB_URI"]
Set-Default "MONGODB_DATABASE"   ($vars["MONGODB_DB"], "telemetry" | Where-Object { $_ } | Select-Object -First 1)
Set-Default "MONGODB_COLLECTION" ($vars["MONGODB_COLLECTION"], "requests" | Where-Object { $_ } | Select-Object -First 1)
Set-Default "OLLAMA_HOST"        "http://127.0.0.1:11434"
Set-Default "OLLAMA_MODEL"       "embeddinggemma:300m"
Set-Default "REVERSE_PROXY_URL"  $Backend

if (-not $env:MONGODB_URI) { throw "MONGODB_URI not set and not found in $EnvFile" }
$masked = $env:MONGODB_URI -replace ':[^:@/]*@', ':***@'
Write-Host "proxy -> $env:REVERSE_PROXY_URL | mongo $masked / $env:MONGODB_DATABASE.$env:MONGODB_COLLECTION | ollama $env:OLLAMA_HOST ($env:OLLAMA_MODEL)"
Write-Host "listening: :8080 (proxied traffic), :8081 (Traffic Lab)"

go run .
