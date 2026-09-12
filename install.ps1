# BotGo Agent installer. Windows x64; no administrator privileges required.
# Review this file at https://botgo.win/install.ps1 before running it.
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'BotGo\Agent'),
    [string]$ManifestUrl = 'https://botgo.win/api/agent/releases/current',
    [switch]$NoPath,
    [switch]$UseBundledNode
)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'BotGo currently supports Windows x64.' }
if ([Uri]$ManifestUrl -and ([Uri]$ManifestUrl).Scheme -ne 'https') { throw 'The release manifest requires HTTPS.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$root = [IO.Path]::GetFullPath($InstallRoot)
function Assert-ChildPath([string]$Target) {
    $resolved = [IO.Path]::GetFullPath($Target)
    if (-not $resolved.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Install path escapes BotGo directory.' }
    return $resolved
}
function Expand-VerifiedZip([string]$Archive, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destinationPath = Assert-ChildPath $Destination
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $destinationPath $entry.FullName))
            if (-not $target.StartsWith($destinationPath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive entry.' }
        }
    } finally { $zip.Dispose() }
    # Windows PowerShell 5.1 otherwise fails on deeply nested npm dependencies.
    $extendedPath = if ($destinationPath.StartsWith('\\')) { '\\?\UNC\' + $destinationPath.Substring(2) } else { '\\?\' + $destinationPath }
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $extendedPath)
}
function Download-Checked([string]$Url, [string]$Output, [string]$Sha256) {
    if (([Uri]$Url).Scheme -ne 'https' -or $Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid download metadata.' }
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Output -TimeoutSec 300
    if ((Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash -ne $Sha256) { throw 'Download checksum mismatch. Existing installation was preserved.' }
}
New-Item -ItemType Directory -Force -Path $root | Out-Null
$lockPath = Assert-ChildPath (Join-Path $root 'install.lock')
$lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
try {
    Write-Host 'Preparing BotGo Agent...'
    $release = Invoke-RestMethod -Uri $ManifestUrl -TimeoutSec 30
    if ($release.version -notmatch '^\d+\.\d+\.\d+$' -or $release.platform -ne 'win-x64') { throw 'Unsupported BotGo release.' }
    $stage = Assert-ChildPath (Join-Path $root ('staging-' + [Guid]::NewGuid().ToString('N')))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $nodePath = $null
    if (-not $UseBundledNode) {
        $candidate = Get-Command node.exe -ErrorAction SilentlyContinue
        $npmCandidate = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if ($candidate -and $npmCandidate) {
            $version = & $candidate.Source --version
            if ($LASTEXITCODE -eq 0 -and $version -match '^v(22|24)\.') { $nodePath = $candidate.Source }
        }
    }
    if (-not $nodePath) {
        Write-Host 'Installing a private Node.js runtime...'
        $nodeArchive = Join-Path $stage 'node.zip'
        Download-Checked 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip' $nodeArchive '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'
        Expand-VerifiedZip $nodeArchive (Join-Path $stage 'runtime')
        $nodePath = Join-Path $stage 'runtime\node-v22.23.2-win-x64\node.exe'
    }
    $archive = Join-Path $stage 'agent.zip'
    Download-Checked $release.downloadUrl $archive $release.sha256
    Expand-VerifiedZip $archive (Join-Path $stage 'package')
    & $nodePath (Join-Path $stage 'package\bin\botgo.cjs') --version
    if ($LASTEXITCODE -ne 0) { throw 'BotGo startup verification failed.' }
    & $nodePath -e "require(process.argv[1]);" (Join-Path $stage 'package\node_modules\keytar')
    if ($LASTEXITCODE -ne 0) { throw 'Windows credential module could not load.' }
    & (Join-Path $stage 'package\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Codex runtime verification failed.' }
    $destination = Assert-ChildPath (Join-Path $root ('versions\' + $release.version + '-' + [Guid]::NewGuid().ToString('N')))
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    # Both recursive move endpoints have been resolved and checked under root.
    $null = Assert-ChildPath $stage
    Move-Item -LiteralPath $stage -Destination $destination
    if ($nodePath.StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase)) { $nodePath = $destination + $nodePath.Substring($stage.Length) }
    $bin = Join-Path $root 'bin'
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $utf8 = New-Object Text.UTF8Encoding($false)
    $launcher = "@echo off`r`n`"$($nodePath.Replace('%','%%'))`" `"%~dp0..\launcher.cjs`" %*`r`n"
    [IO.File]::WriteAllText((Join-Path $root 'launcher.cjs'), 'const fs=require("fs"),path=require("path");const p=JSON.parse(fs.readFileSync(path.join(__dirname,"current.json"),"utf8"));require(path.join(p.packageRoot,"bin","botgo.cjs"));', $utf8)
    $pointer = Join-Path $root 'current.json'
    $nextPointer = Join-Path $root 'current.next.json'
    [IO.File]::WriteAllText($nextPointer, (@{ version=$release.version; packageRoot=(Join-Path $destination 'package'); nodePath=$nodePath } | ConvertTo-Json), $utf8)
    if (Test-Path -LiteralPath $pointer) { [IO.File]::Replace($nextPointer, $pointer, (Join-Path $root 'previous.json')) } else { [IO.File]::Move($nextPointer, $pointer) }
    [IO.File]::WriteAllText((Join-Path $bin 'botgo.cmd'), $launcher, $utf8)
    if (-not $NoPath) {
        $userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
        if (@($userPath -split ';') -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $bin).TrimStart(';'), 'User') }
        $env:Path = $bin + ';' + $env:Path
    }
    Write-Host 'BotGo installed. Next: botgo auth login'
} finally { $lock.Dispose() }
