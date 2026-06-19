import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { logger } from '../logging/Logger'

/**
 * Minimal .env loader (no dependency on dotenv's process polling).
 * Reads KEY=VALUE pairs, supports quotes and # comments. Values trimmed.
 * The user-created .env lives at the project root in dev, or beside the exe in production.
 */
export interface Secrets {
  aiBaseURL: string
  aiKey: string
  aiModel: string
  mimoBaseURL: string
  mimoKey: string
}

function candidatePaths(): string[] {
  const cwd = process.cwd()
  const paths: string[] = []
  // dev: project root (cwd may be project root or a subdir)
  paths.push(resolve(cwd, '.env'))
  // walk up a few parents in case cwd is nested (dev/ and build scenarios)
  let dir = cwd
  for (let i = 0; i < 6 && dir; i++) {
    paths.push(resolve(dir, '.env'))
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  // prod: beside the exe and in userData
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron')
    paths.push(app.getPath('exe').replace(/[^/\\]+$/, '.env'))
    paths.push(resolve(app.getPath('userData'), '.env'))
  } catch {
    // app not ready / not electron — ignore
  }
  // de-dup
  return Array.from(new Set(paths))
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

let cached: Secrets | null = null

export function loadSecrets(): Secrets {
  if (cached) return cached
  // prefer already-exported process.env (electron-vite / shell may inject)
  const fromProcess = {
    aiBaseURL: process.env.AI_API_BASE_URL ?? '',
    aiKey: process.env.AI_API_KEY ?? '',
    aiModel: process.env.AI_API_MODEL ?? process.env.AI_MODEL ?? '',
    mimoBaseURL: process.env.MIMO_API_BASE_URL ?? '',
    mimoKey: process.env.MIMO_API_KEY ?? ''
  }

  let fileEnv: Record<string, string> = {}
  const tried = candidatePaths()
  for (const p of tried) {
    if (existsSync(p)) {
      try {
        fileEnv = parseEnv(readFileSync(p, 'utf-8'))
        logger.info(`Loaded secrets from ${p} (${Object.keys(fileEnv).length} keys)`)
        break
      } catch (e) {
        logger.warn(`Failed to read ${p}:`, e)
      }
    }
  }
  if (Object.keys(fileEnv).length === 0) {
    logger.warn(`No .env found. Tried: ${tried.join(', ')}`)
  }

  // camelCase secret key -> the exact .env variable name
  const ENV_KEYS: Record<keyof typeof fromProcess, string> = {
    aiBaseURL: 'AI_API_BASE_URL',
    aiKey: 'AI_API_KEY',
    aiModel: 'AI_MODEL',
    mimoBaseURL: 'MIMO_API_BASE_URL',
    mimoKey: 'MIMO_API_KEY'
  }
  const get = (k: keyof typeof fromProcess, fallback: string): string =>
    fromProcess[k] || fileEnv[ENV_KEYS[k]] || fallback

  cached = {
    aiBaseURL: normalizeURL(get('aiBaseURL', '')),
    aiKey: get('aiKey', ''),
    aiModel: get('aiModel', ''),
    mimoBaseURL: normalizeURL(get('mimoBaseURL', '')),
    mimoKey: get('mimoKey', '')
  }
  return cached
}

/** Ensure baseURL has a scheme and ends with /v1 for the chat-completions path. */
function normalizeURL(u: string): string {
  if (!u) return u
  let url = u.trim()
  if (!/^https?:\/\//.test(url)) {
    // tp- keys use the CN host; otherwise assume https
    url = 'https://' + url
  }
  return url.replace(/\/+$/, '') + (/(\/v\d+)$/.test(url) ? '' : '/v1')
}

export function refreshSecrets(): Secrets {
  cached = null
  return loadSecrets()
}
