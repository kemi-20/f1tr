import { desktopCapturer } from 'electron'
import { logger } from '../logging/Logger'
import { isF1GameWindow } from './WindowIdentity'

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

    const candidates = sources.filter((s) => /^F1\s*[®™]?\s*(?:25|26)\s*$/i.test(s.name.trim()))
    const verified = []
    for (const candidate of candidates) {
      if (await isF1GameWindow(candidate.id)) verified.push(candidate)
    }
    // Ambiguous or unverifiable windows must never be sent to a vision endpoint.
    const source = verified.length === 1 ? verified[0] : null

    if (!source) {
      logger.warn('ScreenshotService: no unique verified F1 game window found')
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
