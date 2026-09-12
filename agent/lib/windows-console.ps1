# This hidden helper creates a real console without inheriting ignored std handles.
# Credentials are inherited through the environment, never embedded in this script.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class BotGoConsole {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo {
    public int cb; public string reserved, desktop, title;
    public int x, y, xSize, ySize, xChars, yChars, fill, flags;
    public short show, reservedSize; public IntPtr reserved2, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr process, thread; public int pid, tid; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta,
    bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInfo info);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr handle, uint code);
  public static int Run(string exe, string encoded, string eventName) {
    using (var ready = new EventWaitHandle(false, EventResetMode.ManualReset, eventName)) {
      var startup = new StartupInfo(); startup.cb = Marshal.SizeOf(startup);
      ProcessInfo info;
      // CREATE_NEW_CONSOLE; no STARTF_USESTDHANDLES and no inherited handles.
      if (!CreateProcess(exe, new StringBuilder("\"" + exe + "\" -NoProfile -EncodedCommand " + encoded),
          IntPtr.Zero, IntPtr.Zero, false, 0x00000010, IntPtr.Zero, null, ref startup, out info))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
          Console.WriteLine("CREATED");
          bool announced = false;
          var deadline = DateTime.UtcNow.AddSeconds(15);
          uint wait;
          while ((wait = WaitForSingleObject(info.process, 100)) == 258) {
            if (!announced && ready.WaitOne(0)) { announced = true; Console.WriteLine("READY"); }
            if (!announced && DateTime.UtcNow > deadline) { TerminateProcess(info.process, 1); throw new TimeoutException("Console readiness timed out"); }
          }
          if (wait != 0) throw new Win32Exception(Marshal.GetLastWin32Error());
          uint code;
          if (!GetExitCodeProcess(info.process, out code)) throw new Win32Exception(Marshal.GetLastWin32Error());
          return unchecked((int)code);
      } finally { CloseHandle(info.thread); CloseHandle(info.process); }
    }
  }
}
'@
