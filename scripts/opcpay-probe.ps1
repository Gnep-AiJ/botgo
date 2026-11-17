$ErrorActionPreference = 'Stop'
$node = Get-Command node -CommandType Application | Select-Object -First 1
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $node.Source
$startInfo.Arguments = 'opcpay-probe.mjs'
$startInfo.WorkingDirectory = $PSScriptRoot
$startInfo.UseShellExecute = $false

$secret = Read-Host 'OPCPay API Key (hidden)' -AsSecureString
$buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $startInfo.EnvironmentVariables['opcpay_api_key'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer)
    $probe = [System.Diagnostics.Process]::Start($startInfo)
} finally {
    $startInfo.EnvironmentVariables.Remove('opcpay_api_key')
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)
    $secret.Dispose()
}

try {
    $probe.WaitForExit()
    exit $probe.ExitCode
} finally {
    $probe.Dispose()
}
