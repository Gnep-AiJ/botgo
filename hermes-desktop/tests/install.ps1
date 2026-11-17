$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$directory = Join-Path $root 'artifacts/verification/botgo-installed-v5'
$evidence = Join-Path $root 'artifacts/verification/hermes-capabilities-20261023'
$installer = Join-Path $root 'artifacts/releases/hermes-preview-polish/BotGo-2.0.0-preview.5-win-x64.exe'
if (-not $directory.StartsWith((Join-Path $root 'artifacts/verification/'))) { throw 'Invalid isolated install target' }
if (Test-Path -LiteralPath $directory) { throw 'Fresh installation target already exists' }
$started = Get-Date
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$process = Start-Process -FilePath $installer -ArgumentList '/S', ('/D=' + $directory) -PassThru -WindowStyle Hidden
$completed = $process.WaitForExit(600000)
if (-not $completed) { $process.Kill(); $process.WaitForExit() }
$code = $process.ExitCode
$passed = $completed -and $code -eq 0 -and (Test-Path -LiteralPath (Join-Path $directory 'resources/hermes-payload/pm-runtime/pm-runtime.json'))
$matched = @()
if ($passed) {
    foreach ($relative in @('BotGo.exe','resources/app.asar','resources/hermes-payload/manifest.json','resources/hermes-payload/pm-runtime/pm-runtime.json','resources/hermes-payload/hermes-agent/plugins/tts/botgo-windows/__init__.py')) {
        $source = Join-Path $root ('artifacts/releases/hermes-preview-polish/win-unpacked/' + $relative)
        $target = Join-Path $directory $relative
        if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $target).Hash) { $passed=$false; break }
        $matched += $relative
    }
}
[PSCustomObject]@{passed=$passed;sha256=$installerHash;matched=$matched;exitCode=$code;timedOut=(-not $completed);directory=$directory;seconds=((Get-Date)-$started).TotalSeconds;time=(Get-Date).ToString('o')} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'install-final-result.json') -Encoding utf8
if (-not $passed) { throw 'Corrected installer did not pass actual installation' }
