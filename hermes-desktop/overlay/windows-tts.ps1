param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled })
    if ($request.voice) {
        $chosen = $voices | Where-Object { $_.VoiceInfo.Name -eq $request.voice } | Select-Object -First 1
    } elseif ($request.text -match '[\u3400-\u9fff]') {
        $chosen = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
    } else {
        $chosen = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1
        if (-not $chosen) { $chosen = $voices | Select-Object -First 1 }
    }
    if (-not $chosen) { throw 'No matching installed speech voice' }
    $synth.SelectVoice($chosen.VoiceInfo.Name)
    $synth.Rate = [int]$request.rate
    $synth.SetOutputToWaveFile([string]$request.output)
    $synth.Speak([string]$request.text)
} finally {
    $synth.Dispose()
}
