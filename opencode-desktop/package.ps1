$ErrorActionPreference = 'Stop'
$clientRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$identity = Get-Content -Raw -LiteralPath (Join-Path $clientRoot '.secrets/desktop-preview-signing.json') | ConvertFrom-Json
$certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $identity.thumbprint)
if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) { throw 'Pinned signing identity unavailable' }
$env:BOTGO_PREVIEW_CERT_SHA1 = $certificate.Thumbprint
$env:ELECTRON_BUILDER_CACHE = Join-Path $clientRoot '.tmp-electron-builder-cache'
try {
    & node (Join-Path $clientRoot 'artifacts/opencode/node_modules/electron-builder/cli.js') --projectDir (Join-Path $clientRoot 'artifacts/opencode/packages/desktop') --config (Join-Path $PSScriptRoot 'installer.cjs') --win --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Client packaging failed' }
} finally {
    Remove-Item Env:BOTGO_PREVIEW_CERT_SHA1 -ErrorAction SilentlyContinue
}
