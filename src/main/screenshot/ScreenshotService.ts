import { desktopCapturer } from 'electron'
import { logger } from '../logging/Logger'

/**
 * ScreenshotService — captures the F1 25 game window (or falls back to the
 * primary display) and returns a base64-encoded PNG.
 *
 * Uses Electron's desktopCapturer API (main-process only).
 */
export async function captureF1Screenshot(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 1280, height: 720 },
      fetchWindowIcons: false
    })

    // Try to find the F1 25 game window by name
    const f1Source = sources.find((s) =>
      /f1\s*2*5|formula\s*1|f1\s*25|f1\s*26/i.test(s.name)
    )
    const screen = sources.find((s) => /screen|display|entire/i.test(s.name))
    const source = f1Source ?? screen ?? sources[0]

    if (!source) {
      logger.warn('ScreenshotService: no capture source found')
      return null
    }

    const pngBuffer = source.thumbnail.toPNG()
    const base64 = pngBuffer.toString('base64')
    logger.info(`ScreenshotService: captured from "${source.name}" (${Math.round((base64.length * 0.75) / 1024)}KB)`)
    return base64
  } catch (err) {
    logger.error('ScreenshotService: capture failed:', (err as Error)?.message ?? err)
    return null
  }
}
