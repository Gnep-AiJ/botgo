$ErrorActionPreference='Stop'
$global:BotGoTestBadHash=$false
$global:BotGoTestVersion=(Get-Content -Raw -Encoding UTF8 'agent/dist/current.json' | ConvertFrom-Json).version
function Invoke-RestMethod {
    param($Uri,$TimeoutSec)
    $data=Get-Content -Raw -Encoding UTF8 'agent/dist/current.json' | ConvertFrom-Json
    if($global:BotGoTestBadHash){$data.sha256='0'*64}
    return $data
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing,$Uri,$OutFile,$TimeoutSec)
    if([string]$Uri -like 'https://botgo.win/api/agent/releases/*/download'){
        Copy-Item -LiteralPath ('agent/dist/botgo-agent-' + $global:BotGoTestVersion + '-win-x64.zip') -Destination $OutFile
    }else{
        Microsoft.PowerShell.Utility\Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -TimeoutSec $TimeoutSec
    }
}
$root=Join-Path (Get-Location) ('artifacts/verification/installer-test-' + [Guid]::NewGuid().ToString('N'))
if(-not (Test-Path (Join-Path $root 'current.json'))){ & './install.ps1' -InstallRoot $root -NoPath -UseBundledNode }
$pointer=Get-Content -Raw -LiteralPath (Join-Path $root 'current.json')
& (Join-Path $root 'bin/botgo.cmd') --version
if($LASTEXITCODE -ne 0){throw 'Installed CLI did not start'}
$config=$pointer | ConvertFrom-Json
$env:Path=(Split-Path $config.nodePath)+';'+$env:Path
& './install.ps1' -InstallRoot $root -NoPath
$pointer=Get-Content -Raw -LiteralPath (Join-Path $root 'current.json')
if(-not (Test-Path -LiteralPath (Join-Path $root 'previous.json'))){throw 'Upgrade did not retain previous version'}
$global:BotGoTestBadHash=$true
try { & './install.ps1' -InstallRoot $root -NoPath; throw 'Checksum failure was not detected' }
catch { if($_.Exception.Message -notmatch 'checksum mismatch'){throw} }
if((Get-Content -Raw -LiteralPath (Join-Path $root 'current.json')) -ne $pointer){throw 'Failed update modified current version'}
Write-Output 'PASS: private Node install, installed CLI, Node reuse, upgrade, checksum rejection, old version preserved.'
