$ErrorActionPreference = 'Stop'
$clientRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$thumbprint = $env:CODE_SIGN_THUMBPRINT
if (-not $thumbprint) {
    $identityPath = Join-Path $clientRoot '.secrets/desktop-preview-signing.json'
    if (-not (Test-Path -LiteralPath $identityPath)) { throw 'Set CODE_SIGN_THUMBPRINT or provide the gitignored .secrets/desktop-preview-signing.json. Do not commit a thumbprint.' }
    $thumbprint = (Get-Content -Raw -LiteralPath $identityPath | ConvertFrom-Json).thumbprint
}
if ($thumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'CODE_SIGN_THUMBPRINT must be the 40-character thumbprint of your local signing certificate. Do not commit it.' }
$certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $thumbprint)
if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) { throw 'Pinned signing identity unavailable' }
$env:BOTGO_PREVIEW_CERT_SHA1 = $certificate.Thumbprint
$thumbprintDir = Join-Path $clientRoot 'artifacts/signing'
New-Item -ItemType Directory -Force -Path $thumbprintDir | Out-Null
$thumbprintFile = Join-Path $thumbprintDir 'code-sign-thumbprint.txt'
Set-Content -LiteralPath $thumbprintFile -Value $certificate.Thumbprint -NoNewline
$env:BOTGO_CODE_SIGN_THUMBPRINT_FILE = $thumbprintFile
$env:ELECTRON_BUILDER_CACHE = Join-Path $clientRoot 'artifacts/cache/electron-builder'
try {
    & node (Join-Path $clientRoot 'artifacts/opencode/node_modules/electron-builder/cli.js') --projectDir (Join-Path $clientRoot 'artifacts/opencode/packages/desktop') --config (Join-Path $PSScriptRoot 'installer.cjs') --win --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Client packaging failed' }
} finally {
    Remove-Item Env:BOTGO_PREVIEW_CERT_SHA1 -ErrorAction SilentlyContinue
    Remove-Item Env:BOTGO_CODE_SIGN_THUMBPRINT_FILE -ErrorAction SilentlyContinue
}
