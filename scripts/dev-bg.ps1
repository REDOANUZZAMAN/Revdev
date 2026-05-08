# Robust restart: kill anything holding our dev ports OR holding debug.log,
# then spawn npm run dev:all in the background, then wait + probe.
# Run with:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-bg.ps1

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> Killing stragglers on dev ports..."
$ports = @(3000, 3001, 8288, 50053)
$portPids = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
foreach ($targetPid in $portPids) {
    try {
        Stop-Process -Id $targetPid -Force -ErrorAction Stop
        Write-Host "    killed PID $targetPid (port owner)"
    } catch {
        Write-Host "    could not kill $targetPid"
    }
}

Write-Host ""
Write-Host "==> Killing zombie npm / concurrently / inngest dev processes..."
$names = @('node', 'npm', 'concurrently', 'inngest', 'inngest-cli', 'cmd')
$myPid = $PID
foreach ($name in $names) {
    $procs = Get-CimInstance Win32_Process -Filter "Name = '${name}.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
        $cmd = $p.CommandLine
        if (-not $cmd) { continue }
        if ($p.ProcessId -eq $myPid) { continue }
        if ($cmd -match 'next dev' -or
            $cmd -match 'dev:all' -or
            $cmd -match 'dev:next' -or
            $cmd -match 'dev:convex' -or
            $cmd -match 'dev:inngest' -or
            $cmd -match 'convex dev' -or
            $cmd -match 'inngest-cli' -or
            $cmd -match 'concurrently' -or
            $cmd -match 'debug\.log') {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                Write-Host "    killed $($p.Name) PID $($p.ProcessId)"
            } catch {
                Write-Host "    could not kill $($p.Name) PID $($p.ProcessId)"
            }
        }
    }
}

# Give the OS a moment to release file handles.
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "==> Truncating debug.log..."
$logPath = Join-Path $root 'debug.log'
try {
    Set-Content -Path $logPath -Value '' -Force -ErrorAction Stop
    Write-Host "    log reset"
} catch {
    $errMsg = $_.Exception.Message
    Write-Host "    couldn't reset log ($errMsg) -- using rotation instead"
    $rotated = Join-Path $root ("debug." + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")
    try { Move-Item $logPath $rotated -Force } catch {}
    Set-Content -Path $logPath -Value '' -Force
}

Write-Host ""
Write-Host "==> Spawning npm run dev:all in the background..."
Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' `
    -ArgumentList '/c', "npm run dev:all > `"$logPath`" 2>&1" `
    -WorkingDirectory $root | Out-Null

Write-Host "    waiting 35s for boot..."
Start-Sleep -Seconds 35

Write-Host ""
Write-Host "==> Last 50 log lines:"
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 50
} else {
    Write-Host "    (no log written yet)"
}

Write-Host ""
Write-Host "==> HTTP probes:"
foreach ($url in @('http://localhost:3000', 'http://localhost:3001', 'http://localhost:8288')) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 8
        Write-Host "    $url -> HTTP $($r.StatusCode)"
    } catch {
        Write-Host "    $url -> $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "==> Listening sockets right now:"
Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess |
    Format-Table -AutoSize
