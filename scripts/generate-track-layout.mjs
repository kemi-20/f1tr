#!/usr/bin/env node
/**
 * Dev-only generator for the compact shared track layout constant.
 *
 * The reference maps live outside the repository (.origin is git-ignored), so the
 * generated file is committed and CI never has to rebuild it:
 *
 *   node scripts/generate-track-layout.mjs
 *
 * Output: src/shared/constants/trackLayout.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const sourceDir = resolve(repoRoot, '.origin/extracted/lib/app/TrackMaps')
const targetFile = resolve(repoRoot, 'src/shared/constants/trackLayout.ts')
const LINE_SAMPLES = 160

/** Reference file name -> F1 25/26 m_trackId value. Reverse layouts are not shipped. */
const TRACK_IDS = {
  Melbourne: 0,
  Shanghai: 2,
  Sakhir: 3,
  Catalunya: 4,
  Monaco: 5,
  Montreal: 6,
  Silverstone: 7,
  Hungaroring: 9,
  Spa: 10,
  Monza: 11,
  Singapore: 12,
  Suzuka: 13,
  'Abu Dhabi': 14,
  COTA: 15,
  Brazil: 16,
  Austria: 17,
  Mexico: 19,
  Baku: 20,
  Zandvoort: 26,
  Imola: 27,
  Jeddah: 29,
  Miami: 30,
  'Las Vegas': 31,
  Losail: 32,
  Madrid: 42
}

const round1 = (value) => Math.round(value * 10) / 10

function main() {
  const available = new Set(readdirSync(sourceDir).map((file) => file.replace(/\.json$/, '')))
  const missing = Object.keys(TRACK_IDS).filter((name) => !available.has(name))
  if (missing.length > 0) throw new Error(`Missing reference track maps: ${missing.join(', ')}`)

  const layouts = Object.entries(TRACK_IDS)
    .map(([name, id]) => ({ id, layout: buildLayout(readFileSync(join(sourceDir, `${name}.json`), 'utf8'), name) }))
    .sort((a, b) => a.id - b.id)

  writeFileSync(targetFile, render(layouts), 'utf8')
  process.stdout.write(`Wrote ${layouts.length} track layouts to ${targetFile}\n`)
}

function buildLayout(raw, name) {
  const source = JSON.parse(raw)
  const lengthM = number(source.trackLength)
  const sourceLine = (source.fusedLine ?? []).filter(isPoint)
  const sourceArc = cumulative(sourceLine, 1)
  const worldArc = sourceArc[sourceArc.length - 1] ?? 0
  const metresPerUnit = worldArc > 0 ? lengthM / worldArc : 1
  const line = resample(sourceLine, sourceArc, LINE_SAMPLES)
  const lineArc = cumulative(line, metresPerUnit)

  return {
    name,
    lengthM: round1(lengthM),
    metresPerUnit: Math.round(metresPerUnit * 1e6) / 1e6,
    sectorStartsM: [0, round1(number(source.sector2Start)), round1(number(source.sector3Start))],
    pitEntryM: round1(nearestDistance((source.pitLine ?? [])[0], line, lineArc)),
    pitExitM: round1(nearestDistance((source.pitLine ?? []).at(-1), line, lineArc)),
    pitLaneLengthM: round1(arcLength((source.pitLine ?? []).filter(isPoint)) * metresPerUnit),
    drsZones: zones(source.drsZones, lengthM),
    activeAeroFullZones: zones(source.activeAeroFullZones, lengthM),
    activeAeroPartialZones: zones(source.activeAeroPartialZones, lengthM),
    overtakePointsM: (source.overtakeDetectionPoints ?? [])
      .map((point) => round1(number(point.distance)))
      .filter((value) => value >= 0 && value < lengthM),
    marshalZones: (source.marshalZoneDefinitions ?? [])
      .map((zone) => ({ startM: round1(number(zone.startDistance)), endM: round1(number(zone.endDistance)) }))
      .filter((zone) => zone.startM >= 0 && zone.startM < lengthM),
    line: line.map((point) => point.map(round1))
  }
}

function zones(list, lengthM) {
  return (list ?? [])
    .map((zone) => ({ startM: round1(number(zone.startDistance)), endM: round1(number(zone.endDistance)) }))
    .filter((zone) => zone.startM >= 0 && zone.startM < lengthM && zone.endM >= 0)
}

/** Nearest along-track distance, in metres, of a world-space point projected onto the line. */
function nearestDistance(point, line, lineArc) {
  if (!isPoint(point) || line.length < 2) return null
  let best = Infinity
  let bestDistance = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq > 0
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq))
      : 0
    const px = a[0] + t * dx
    const py = a[1] + t * dy
    const distanceSq = (point[0] - px) ** 2 + (point[1] - py) ** 2
    if (distanceSq < best) {
      best = distanceSq
      bestDistance = (lineArc[i - 1] ?? 0) + Math.hypot(px - a[0], py - a[1])
    }
  }
  return bestDistance
}

/** Uniform arc-length resample; the returned points stay in the source world coordinates. */
function resample(points, sourceArc, count) {
  if (points.length < 2) return points.map((point) => [...point])
  const total = sourceArc[sourceArc.length - 1]
  if (!(total > 0)) return points.map((point) => [...point])
  const out = []
  let cursor = 0
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1)
    while (cursor < sourceArc.length - 2 && sourceArc[cursor + 1] < target) cursor += 1
    const a = points[cursor]
    const b = points[cursor + 1] ?? a
    const segmentStart = sourceArc[cursor]
    const segmentLength = (sourceArc[cursor + 1] ?? segmentStart) - segmentStart
    const t = segmentLength > 0 ? Math.max(0, Math.min(1, (target - segmentStart) / segmentLength)) : 0
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}

function cumulative(points, metresPerUnit) {
  const out = [0]
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]) * metresPerUnit
    out.push(total)
  }
  return out
}

function arcLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return total
}

function isPoint(value) {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function render(layouts) {
  const body = layouts.map(({ id, layout }) => `  ${id}: ${JSON.stringify(layout)}`).join(',\n')
  return `/**
 * Generated track layout data — do not edit by hand.
 * Regenerate with: node scripts/generate-track-layout.mjs
 *
 * All distances are official lap metres. A zone whose endM is below its startM wraps the
 * start/finish line. line holds ${LINE_SAMPLES} world-coordinate (x, z) points sampled at
 * uniform arc length; multiply world-space length by metresPerUnit to obtain lap metres.
 */
export interface TrackLayoutZone {
  startM: number
  endM: number
}

export interface TrackLayout {
  name: string
  lengthM: number
  metresPerUnit: number
  sectorStartsM: [number, number, number]
  pitEntryM: number | null
  pitExitM: number | null
  pitLaneLengthM: number | null
  drsZones: TrackLayoutZone[]
  activeAeroFullZones: TrackLayoutZone[]
  activeAeroPartialZones: TrackLayoutZone[]
  overtakePointsM: number[]
  marshalZones: TrackLayoutZone[]
  line: [number, number][]
}

export const TRACK_LAYOUTS: Record<number, TrackLayout> = {
${body}
}
`
}

main()
