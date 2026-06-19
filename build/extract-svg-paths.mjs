/**
 * Extract the main track path from each high-res SVG, normalize to viewBox 0 0 100 100,
 * and output a tracks.json that tracks.ts can load.
 *
 * The "main path" = the longest <path d="..."> by character count (the track outline
 * is always the most detailed/longest path in these SVGs).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const svgDir = resolve('src', 'track_svg')
const files = readdirSync(svgDir).filter((f) => f.endsWith('.svg') && f.match(/^\d/))

const TRACK_NAMES: Record<number, string> = {
  0: 'Melbourne', 2: 'Shanghai', 3: 'Sakhir', 4: 'Catalunya', 5: 'Monaco',
  6: 'Montreal', 7: 'Silverstone', 9: 'Hungaroring', 10: 'Spa', 11: 'Monza',
  12: 'Singapore', 13: 'Suzuka', 14: 'Yas Marina', 15: 'Austin', 16: 'Interlagos',
  17: 'Red Bull Ring', 19: 'Mexico City', 20: 'Baku', 26: 'Zandvoort', 27: 'Imola',
  29: 'Jeddah', 30: 'Miami', 31: 'Las Vegas', 32: 'Losail', 42: 'Madrid'
}
const TRACK_COUNTRIES: Record<number, string> = {
  0: 'Australia', 2: 'China', 3: 'Bahrain', 4: 'Spain', 5: 'Monaco',
  6: 'Canada', 7: 'UK', 9: 'Hungary', 10: 'Belgium', 11: 'Italy',
  12: 'Singapore', 13: 'Japan', 14: 'Abu Dhabi', 15: 'USA', 16: 'Brazil',
  17: 'Austria', 19: 'Mexico', 20: 'Azerbaijan', 26: 'Netherlands', 27: 'Italy',
  29: 'Saudi Arabia', 30: 'USA', 31: 'USA', 32: 'Qatar', 42: 'Spain'
}
const TRACK_LAPS: Record<number, number> = {
  0: 58, 2: 56, 3: 57, 4: 66, 5: 78, 6: 70, 7: 52, 9: 70, 10: 44, 11: 53,
  12: 62, 13: 53, 14: 58, 15: 56, 16: 71, 17: 71, 19: 71, 20: 51, 26: 72,
  27: 63, 29: 50, 30: 57, 31: 50, 32: 57, 42: 66
}

function extractMainPath(svgContent) {
  const allPaths = [...svgContent.matchAll(/d="([^"]{30,})"/g)]
  if (allPaths.length === 0) return null
  // pick the longest path by char count (the track outline)
  let best = allPaths[0]
  for (const m of allPaths) {
    if (m[1].length > best[1].length) best = m
  }
  return best[1]
}

function parseBounds(pathData) {
  // extract all coordinate pairs from the path data
  const nums = pathData.match(/-?[\d.]+/g)?.map(Number) ?? []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  // path commands: M/L/C use absolute coords in pairs
  let i = 0
  let lastCmd = ''
  let cx = 0, cy = 0
  while (i < nums.length) {
    const x = nums[i], y = nums[i + 1]
    if (isFinite(x) && isFinite(y)) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    i += 2
  }
  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

function normalizePath(pathData, bounds) {
  // scale the path to fit in a 5-95 range (leave some padding)
  const padX = bounds.width * 0.05
  const padY = bounds.height * 0.05
  const sx = 90 / (bounds.width + padX * 2)
  const sy = 90 / (bounds.height + padY * 2)
  const scale = Math.min(sx, sy) // uniform scale to preserve aspect
  const offsetX = 5 + (90 - bounds.width * scale) / 2 - bounds.minX * scale
  const offsetY = 5 + (90 - bounds.height * scale) / 2 - bounds.minY * scale

  // replace each number pair
  return pathData.replace(/(-?[\d.]+)/g, (match, _offset, _full) => {
    const n = Number(match)
    if (!isFinite(n)) return match
    // We can't tell if it's X or Y without tracking command position,
    // so scale ALL numbers uniformly (works since we use a single scale factor)
    return (n * scale + (n === 0 ? 0 : (offsetX))).toFixed(2)
  })
}

const result = {}
let processed = 0, failed = 0

for (const f of files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
  const trackId = parseInt(f.match(/^(\d+)/)?.[1] ?? '-1')
  if (trackId < 0 || !TRACK_NAMES[trackId]) continue

  const content = readFileSync(resolve(svgDir, f), 'utf-8')
  const mainPath = extractMainPath(content)
  if (!mainPath) { console.log(`SKIP ${f}: no path`); failed++; continue }

  const bounds = parseBounds(mainPath)
  if (!bounds) { console.log(`SKIP ${f}: no bounds`); failed++; continue }

  // Normalize: scale uniformly, translate to fit 0-100
  // Use a simpler approach: regex-replace all numbers with scaled versions
  const scale = Math.min(90 / bounds.width, 90 / bounds.height)
  const offX = 5 + (90 - bounds.width * scale) / 2 - bounds.minX * scale
  const offY = 5 + (90 - bounds.height * scale) / 2 - bounds.minY * scale

  const normalized = mainPath.replace(/-?[\d.]+/g, (m) => {
    const n = Number(m)
    if (!isFinite(n)) return m
    return (n * scale + offX).toFixed(1)
  })

  result[trackId] = {
    id: trackId,
    name: TRACK_NAMES[trackId],
    country: TRACK_COUNTRIES[trackId] || '',
    laps: TRACK_LAPS[trackId] || 50,
    lengthKm: 0, // not critical for display
    path: normalized,
    drsZones: [[0.05, 0.1], [0.6, 0.65]], // placeholder
    sectors: [0.33, 0.66] // placeholder
  }
  processed++
}

writeFileSync(resolve('src', 'shared', 'constants', 'tracks-paths.json'), JSON.stringify(result, null, 2))
console.log(`Extracted ${processed} track paths (${failed} failed)`)
