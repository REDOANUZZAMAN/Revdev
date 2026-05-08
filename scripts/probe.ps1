# Quick probe of the dev server + show last log lines.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> HTTP probe of localhost:3000 (30s timeout)..."
try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 30
    Write-Host "    HTTP $($r.StatusCode) ($($r.RawContentLength) bytes)"
} catch {
    Write-Host "    Error: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "==> Last 40 log lines:"
$logPath = Join-Path $root 'debug.log'
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 40
} else {
    Write-Host "    (no log)"
}
