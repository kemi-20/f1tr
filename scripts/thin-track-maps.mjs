#!/usr/bin/env node
/**
 * Dev-only reducer for the bundled renderer track maps (src/track_maps/*.json).
 *
 * The vendored maps carry 1,400-6,600 points per circuit, far more than a map
 * rendered at a few hundred CSS pixels can show. This script applies a
 * Douglas-Peucker simplification with a sub-pixel tolerance and rounds the
 * surviving world coordinates, then rewrites each file in place.
 *
 * Run: node scripts/thin-track-maps.mjs
 *
 * The script is idempotent: already-simplified files keep their point count.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const mapDir = resolve(repoRoot, 'src/track_maps')
const FILE_PATTERN = /^\d{2}-[a-z0-9-]+\.json$/

/** Max geometric deviation as a fraction of the circuit bounding-box diagonal. */
const TOLERANCE_RATIO = 0.0002
/** Defensive cap: no shipped line should ever exceed this point count. */
const MAX_POINTS = 800
/** Two decimals are well below one rendered pixel for every bundled circuit. */
const COORDINATE_DECIMALS = 2

const LINE_KEYS = ['fusedLine', 'pitLine', 'sector1Line', 'sector2Line', 'sector3Line']

function main() {
  const files = readdirSync(mapDir).filter((name) => FILE_PATTERN.test(name)).sort()
  if (files.length === 0) throw new Error(`No track map JSON files found in ${mapDir}`)

  let beforeBytes = 0
  let afterBytes = 0
  let beforePoints = 0
  let afterPoints = 0
  for (const name of files) {
    const path = join(mapDir, name)
    const before = readFileSync(path, 'utf8')
    const map = parseTrackMap(before, name)
    const tolerance = TOLERANCE_RATIO * diagonal(map.bounds)
    const counts = []
    for (const key of LINE_KEYS) {
      const line = map[key]
      if (!Array.isArray(line)) continue
      const points = line.filter(isPoint)
      if (points.length < 2) continue
      const simplified = simplify(points, tolerance)
      if (simplified.length > MAX_POINTS) throw new Error(`${name}:${key} retained ${simplified.length} points`)
      counts.push(`${key}=${points.length}->${simplified.length}`)
      beforePoints += points.length
      afterPoints += simplified.length
      map[key] = simplified.map(roundPoint)
    }
    const after = JSON.stringify(map)
    beforeBytes += statSync(path).size
    afterBytes += Buffer.byteLength(after, 'utf8')
    writeFileSync(path, after, 'utf8')
    process.stdout.write(`${name}: ${counts.join(' ')}; ${statSync(path).size} bytes\n`)
  }
  process.stdout.write(
    `Total: ${beforePoints} -> ${afterPoints} points; ` +
    `${(beforeBytes / 1024).toFixed(0)} KiB -> ${(afterBytes / 1024).toFixed(0)} KiB\n`
  )
}

function parseTrackMap(raw, name) {
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`${name}: invalid JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}: expected an object`)
  if (!Array.isArray(value.bounds) || value.bounds.length !== 4 || !value.bounds.every(isFiniteNumber)) {
    throw new Error(`${name}: missing numeric bounds`)
  }
  if (!Array.isArray(value.fusedLine) || value.fusedLine.filter(isPoint).length < 2) {
    throw new Error(`${name}: missing fusedLine`)
  }
  return value
}

/** Douglas-Peucker simplification; the first and last point are always kept. */
function simplify(points, tolerance) {
  if (points.length < 3 || !(tolerance > 0)) return points.map((point) => [point[0], point[1]])
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()
    if (end - start < 2) continue
    let furthest = -1
    let furthestDistance = -1
    for (let i = start + 1; i < end; i++) {
      const distance = segmentDistance(points[i], points[start], points[end])
      if (distance > furthestDistance) {
        furthestDistance = distance
        furthest = i
      }
    }
    if (furthestDistance > tolerance) {
      keep[furthest] = 1
      stack.push([start, furthest], [furthest, end])
    }
  }
  const out = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push([points[i][0], points[i][1]])
  return out
}

function segmentDistance(point, start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq > 0
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSq))
    : 0
  const px = start[0] + t * dx
  const py = start[1] + t * dy
  return Math.hypot(point[0] - px, point[1] - py)
}

function diagonal(bounds) {
  return Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1])
}

function roundPoint(point) {
  const factor = 10 ** COORDINATE_DECIMALS
  return [Math.round(point[0] * factor) / factor, Math.round(point[1] * factor) / factor]
}

function isPoint(value) {
  return Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1])
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

main()
