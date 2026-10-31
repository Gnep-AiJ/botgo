param([Parameter(Mandatory=$true)][string]$FilePath)
$ErrorActionPreference='Stop'
# A desktop launched by PowerShell 7 can inherit its module search path.
# Load the signing module belonging to the Windows PowerShell running this file.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BotGoAuthenticode {
  [StructLayout(LayoutKind.Sequential)] struct FileInfo { public uint size; public IntPtr path, file, subject; }
  [StructLayout(LayoutKind.Sequential)] struct TrustData { public uint size; public IntPtr policy, sip; public uint ui, revocation, choice; public IntPtr file; public uint state; public IntPtr stateData, url; public uint flags, context; }
  [DllImport("wintrust.dll", ExactSpelling=true, SetLastError=false)] static extern uint WinVerifyTrust(IntPtr window, [In] ref Guid action, [In] ref TrustData data);
  public static uint Verify(string path) { var name=Marshal.StringToCoTaskMemUni(path); var file=new FileInfo { size=(uint)Marshal.SizeOf(typeof(FileInfo)), path=name }; var pointer=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FileInfo))); try { Marshal.StructureToPtr(file,pointer,false); var data=new TrustData { size=(uint)Marshal.SizeOf(typeof(TrustData)), ui=2, choice=1, file=pointer, flags=0x10 }; var action=new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE"); return WinVerifyTrust(IntPtr.Zero,ref action,ref data); } finally { Marshal.FreeHGlobal(pointer); Marshal.FreeCoTaskMem(name); } }
}
'@
$signature=Get-AuthenticodeSignature -LiteralPath $FilePath
$result=[BotGoAuthenticode]::Verify([IO.Path]::GetFullPath($FilePath))
$expected = if ($env:CODE_SIGN_THUMBPRINT) { $env:CODE_SIGN_THUMBPRINT.Trim() } elseif ($env:BOTGO_PREVIEW_CERT_SHA1) { $env:BOTGO_PREVIEW_CERT_SHA1.Trim() } else { '' }
if (-not $expected) {
  $sidecar = Join-Path $PSScriptRoot 'code-sign-thumbprint.txt'
  if (Test-Path -LiteralPath $sidecar) { $expected = (Get-Content -Raw -LiteralPath $sidecar).Trim() }
}
if ($expected -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Set CODE_SIGN_THUMBPRINT to your local signing certificate thumbprint. Do not commit it.' }
if ($signature.SignerCertificate.Thumbprint -ne $expected -or ($result -ne 0 -and $result -ne [uint32]0x800B0109L)) { throw "Installer signature rejected: $result" }
Write-Output 'Verified pinned Authenticode signature'
