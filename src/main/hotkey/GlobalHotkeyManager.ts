import { globalShortcut } from 'electron'
import { Sender } from '../ipc/sender'
import { logger } from '../logging/Logger'

/**
 * GlobalHotkeyManager — registers a system-wide hotkey via Electron's
 * globalShortcut API so the push-to-talk key works even when F1 25
 * has focus in fullscreen.
 *
 * When the hotkey fires, sends 'hotkey:trigger' to the renderer which
 * toggles voice recording.
 */
let currentAccelerator: string | null = null

/** Convert KeyboardEvent.code to Electron accelerator format. */
function codeToAccelerator(code: string): string {
  // 'Space' → 'Space', 'KeyA' → 'A', 'KeyF1' → 'F1', 'Digit1' → '1'
  if (code === 'Space') return 'Space'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code // F1-F12, ArrowUp, etc. pass through
}

/** Register a global shortcut. Unregisters any previous one first. */
export function registerHotkey(code: string): void {
  unregisterHotkey()
  const accelerator = codeToAccelerator(code)
  try {
    const success = globalShortcut.register(accelerator, () => {
      logger.debug('Global hotkey fired')
      Sender.send('hotkey:trigger', {})
    })
    if (success) {
      currentAccelerator = accelerator
      logger.info(`Global hotkey registered: ${accelerator}`)
    } else {
      logger.warn(`Failed to register global hotkey: ${accelerator} (may be taken by another app)`)
    }
  } catch (err) {
    logger.error(`Error registering global hotkey ${accelerator}:`, (err as Error)?.message ?? err)
  }
}

export function unregisterHotkey(): void {
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    logger.info(`Global hotkey unregistered: ${currentAccelerator}`)
    currentAccelerator = null
  }
}

export function isHotkeyRegistered(): boolean {
  return currentAccelerator != null
}
