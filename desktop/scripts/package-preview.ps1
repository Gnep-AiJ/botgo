$ErrorActionPreference = 'Stop'
$previewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$identityPath = Join-Path $previewRoot '.secrets/desktop-preview-signing.json'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $previewRoot 'desktop/package.json') | ConvertFrom-Json
$artifact = Join-Path $previewRoot ('desktop/dist/' + $manifest.version + '/BotGo Desktop Setup ' + $manifest.version + '.exe')
if (Test-Path -LiteralPath $artifact) { throw 'Preview artifact exists. Increment the version before packaging again.' }
if (Test-Path -LiteralPath $identityPath) {
    $identity = Get-Content -Raw -LiteralPath $identityPath | ConvertFrom-Json
    $cert = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $identity.thumbprint)
    if (-not $cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date)) { throw 'The pinned preview signing identity is unavailable or expired.' }
} else {
    # Only the personal store, never a trusted-root store. The key is non-exportable.
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=BotGo Desktop Preview' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyExportPolicy NonExportable -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(3)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $identityPath) | Out-Null
    [IO.File]::WriteAllText($identityPath, (@{ thumbprint=$cert.Thumbprint; subject=$cert.Subject } | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}
$previousOrigin = $env:BOTGO_API_ORIGIN
$previousCache = $env:ELECTRON_BUILDER_CACHE
$previousIdentity = $env:BOTGO_PREVIEW_CERT_SHA1
try {
    $env:BOTGO_API_ORIGIN = 'https://botgo.win'
    $env:ELECTRON_BUILDER_CACHE = Join-Path $previewRoot '.tmp-electron-builder-cache'
    $env:BOTGO_PREVIEW_CERT_SHA1 = $cert.Thumbprint
    & npm.cmd --prefix (Join-Path $previewRoot 'desktop') run package:win -- '--config' 'preview-builder.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Preview packaging failed. No release may be activated.' }
    Write-Output ('Self-signed preview identity: ' + $cert.Thumbprint)
    Write-Output 'Windows default trust and SmartScreen reputation are NOT established. Installation acceptance is still required.'
} finally {
    $env:BOTGO_API_ORIGIN = $previousOrigin
    $env:ELECTRON_BUILDER_CACHE = $previousCache
    $env:BOTGO_PREVIEW_CERT_SHA1 = $previousIdentity
}
