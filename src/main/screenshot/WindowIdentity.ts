import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const run = promisify(execFile)

/** Resolve an Electron window HWND to the owning executable; fail closed on errors. */
export async function isF1GameWindow(sourceId: string): Promise<boolean> {
  const match = /^window:(\d+):\d+$/.exec(sourceId)
  if (process.platform !== 'win32' || !match) return false
  const hwnd = BigInt(match[1])
  if (hwnd <= 0n || hwnd > 0x7fffffffffffffffn) return false
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class F1Window { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }'; [uint32]$owner = 0; [void][F1Window]::GetWindowThreadProcessId([IntPtr]${hwnd}, [ref]$owner); if ($owner -gt 0) { [System.IO.Path]::GetFileName((Get-Process -Id $owner -ErrorAction Stop).Path) }`
  try {
    const { stdout } = await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, maxBuffer: 4096, windowsHide: true })
    return /^f1_(?:25|26)\.exe$/i.test(stdout.trim())
  } catch {
    return false
  }
}
