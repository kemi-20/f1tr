import log from 'electron-log'

log.transports.file.level = 'info'
log.transports.console.level = 'info'
log.transports.file.maxSize = 1024 * 1024 * 5 // 5MB

/** Redact anything that looks like an API key before it hits any transport. */
const KEY_PATTERN = /(sk-[A-Za-z0-9_\-]{6,}|tp-[A-Za-z0-9_\-]{6,}|Bearer [A-Za-z0-9_\-]{6,})/g

function redact(input: unknown): unknown {
  if (typeof input === 'string') return input.replace(KEY_PATTERN, '[REDACTED]')
  if (Array.isArray(input)) return input.map(redact)
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const lower = k.toLowerCase()
      if (
        (lower.includes('key') || lower.includes('token') || lower.includes('secret') || lower.includes('authorization')) &&
        typeof v === 'string' &&
        v.length > 0
      ) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = redact(v)
      }
    }
    return out
  }
  return input
}

function format(args: unknown[]): unknown[] {
  return args.map((a) => redact(a))
}

export const logger = {
  info: (...args: unknown[]) => log.info(...format(args)),
  warn: (...args: unknown[]) => log.warn(...format(args)),
  error: (...args: unknown[]) => log.error(...format(args)),
  debug: (...args: unknown[]) => log.debug(...format(args)),
  /** Raw log without redaction — use ONLY for non-secret static data. */
  raw: log
}

export type Logger = typeof logger
