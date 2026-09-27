import { desktopCapturer } from 'electron'
import { logger } from '../logging/Logger'

/**
 * ScreenshotService — captures only a recognized F1 game window.
 *
 * Uses Electron's desktopCapturer API (main-process only).
 */
export async function captureF1Screenshot(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1280, height: 720 },
      fetchWindowIcons: false
    })

    // The game's title includes a registered-trademark symbol on Windows.
    const f1Source = sources.find((s) =>
      /\bF1\s*[®™]?\s*(?:25|26)\b|\bFormula\s*1\b/i.test(s.name)
    )
    const source = f1Source

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
