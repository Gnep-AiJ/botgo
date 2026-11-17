$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$identity=Get-Content -Raw -LiteralPath (Join-Path $repo '.secrets/desktop-preview-signing.json') | ConvertFrom-Json
$cert=Get-Item -LiteralPath ('Cert:\CurrentUser\My\'+$identity.thumbprint)
if(-not $cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date)){throw 'Pinned signing identity unavailable'}
$env:BOTGO_PREVIEW_CERT_SHA1=$cert.Thumbprint
$env:ELECTRON_BUILDER_CACHE=Join-Path $repo 'artifacts/cache/electron-builder'
try {
  & 'C:/Users/49978/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' (Join-Path $PSScriptRoot 'package.mjs') @args
  if($LASTEXITCODE -ne 0){throw 'Hermes packaging failed'}
} finally { Remove-Item Env:BOTGO_PREVIEW_CERT_SHA1 -ErrorAction SilentlyContinue }
