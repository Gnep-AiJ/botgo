param([switch]$Execute, [switch]$Resume)
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'organize-workspace.mjs'))
if ($Execute) { $arguments += '--execute' }
if ($Resume) { $arguments += '--resume' }
& node @arguments
exit $LASTEXITCODE
