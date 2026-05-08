# scripts/restart-dev.ps1
# Kill any process listening on port 3000 or 3001, remove the stale Next.js
# dev lock, then exit. Run npm run dev separately afterwards.
#
# Why this is a script and not an inline -Command: the shell that runs our
# CLI commands (cmd via VS Code) strips embedded double-quotes when the
# command is wrapped in its own outer double-quotes, which breaks any
# single-line `powershell -Command "...$_..."` that needs the dollar sign
# AND nested strings. Putting it in a .ps1 file sidesteps that entirely.

$ErrorActionPreference = 'SilentlyContinue'

$ports = 3000, 3001
$pidsToKill = Get-NetTCPConnection -LocalPort $ports |
              Select-Object -ExpandProperty OwningProcess -Unique

foreach ($targetPid in $pidsToKill) {
  try {
    $proc = Get-Process -Id $targetPid -ErrorAction Stop
    Write-Host "Killing PID $targetPid ($($proc.ProcessName))"
    Stop-Process -Id $targetPid -Force
  } catch {
    Write-Host "PID $targetPid already gone"
  }
}

$lock = Join-Path (Get-Location) '.next\dev\lock'
if (Test-Path $lock) {
  Remove-Item -Force $lock
  Write-Host "Removed stale lock at $lock"
}

Write-Host "Done. Ports 3000 and 3001 are free."
