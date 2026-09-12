$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -Raw -LiteralPath (Join-Path $packageRoot 'package.json') | ConvertFrom-Json
$output = Join-Path $packageRoot 'dist'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$stage = Join-Path $output ('package-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($entry in @('bin','lib','node_modules','package.json','package-lock.json','README.md')) {
    Copy-Item -LiteralPath (Join-Path $packageRoot $entry) -Destination $stage -Recurse
}
$archive = Join-Path $output ('botgo-agent-' + $manifest.version + '-win-x64.zip')
if (Test-Path -LiteralPath $archive) { throw 'Release archive exists; increment version or remove the reviewed build artifact first.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive, 'Optimal', $false)
$release = @{version=$manifest.version; platform='win-x64'; sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower(); sizeBytes=(Get-Item -LiteralPath $archive).Length; downloadUrl=('https://botgo.win/api/agent/releases/' + $manifest.version + '/download')}
[IO.File]::WriteAllText((Join-Path $output 'current.json'), ($release | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
$release | ConvertTo-Json
