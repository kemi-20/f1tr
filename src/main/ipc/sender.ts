import { BrowserWindow } from 'electron'

/**
 * Sender — centralizes main->renderer delivery with a consistent interface.
 * Handles the case where no window is open yet (buffers/ignores gracefully).
 */
class IpcSenderImpl {
  private window: BrowserWindow | null = null
  // small ring buffer of recent payloads per channel for late-subscribing renderers
  private latest = new Map<string, unknown>()

  setWindow(win: BrowserWindow | null): void {
    this.window = win
  }

  send(channel: string, payload: unknown): void {
    if (channel !== 'telemetry:snapshot' && channel !== 'audio:chunk') {
      this.latest.set(channel, payload)
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }

  /** Flush the latest value of a channel to a freshly-loaded renderer. */
  flush(channel: string): void {
    const v = this.latest.get(channel)
    if (v !== undefined) this.send(channel, v)
  }
}

export const Sender = new IpcSenderImpl()
