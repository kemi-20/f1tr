import type { TelemetryHistory } from './TelemetryHistory'
import { readTrackLayout, TRACK_LAYOUT_SECTIONS } from './TrackLayoutReport'

import { toolResultFits } from './toolLimits'
import { compareStrategies } from './StrategyTools'

const sections = ['all', 'player', 'rivals', 'weather', 'session', 'trackPositions', 'events']

/**
 * Host-side trust boundary. The model-facing schema and descriptions live in
 * resources/dsh-f1-plugin/index.mjs; the host only keeps the name allowlist and
 * validates each argument again before touching retained telemetry.
 */
export const TELEMETRY_TOOL_NAMES = [
  'get_race_state',
  'get_track_layout',
  'get_telemetry_history',
  'get_lap_history',
  'read_telemetry_packet',
  'get_race_events',
  'get_stint_history',
  'compare_strategies',
  'strategy_plan'
] as const

const telemetryToolNames = new Set<string>(TELEMETRY_TOOL_NAMES)

export function isTelemetryTool(name: string): boolean {
  return telemetryToolNames.has(name)
}

/** Bounded data harness; only strategy notes mutate memory. No filesystem, network or eval. */
export function executeTelemetryTool(history: TelemetryHistory, name: string, input: string): string {
  if (Buffer.byteLength(input, 'utf8') > 2048) return 'Invalid telemetry arguments: too large'
  let args: unknown
  try {
    args = JSON.parse(input)
  } catch {
    return 'Invalid telemetry arguments: expected JSON object'
  }
  try {
    return runTool(history, name, args)
  } catch (error) {
    // A storage-side fault must not be reported as a model argument mistake: the model
    // would retry the same call forever instead of falling back to another tool.
    return `Telemetry read failed: ${(error as Error).message.slice(0, 120)}`
  }
}

function runTool(history: TelemetryHistory, name: string, args: unknown): string {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Invalid telemetry arguments'
    const a = args as Record<string, unknown>
    if (name === 'compare_strategies' || name === 'strategy_plan') {
      const state = history.latestState()
      if (!state) return 'No live telemetry state is retained yet. Start or resume a session, then retry.'
      const now = Date.now()
      const output = JSON.stringify({ dataOnly: true, queriedAt: now, result: name === 'compare_strategies'
        ? compareStrategies(state, a, now) : history.strategyJournal.execute(state, a, now) })
      return toolResultFits(output) ? output : 'Result exceeds context budget.'
    }
    const historyOnly = name === 'get_race_events' || name === 'get_stint_history'
    const layoutOnly = name === 'get_track_layout'
    const allowed = name === 'read_telemetry_packet'
      ? ['packet', 'offset', 'field', 'arrayOffset', 'arrayLimit']
      : layoutOnly ? ['section', 'exitAfterMinS', 'exitAfterMaxS']
      : name === 'get_race_state' ? ['section'] : historyOnly ? ['offset', 'limit'] : ['section', 'offset', 'limit']
    if (Object.keys(a).some(k => !allowed.includes(k))) return 'Invalid telemetry arguments: unknown field'
    if (layoutOnly) {
      const section = a.section ?? 'all'
      if (typeof section !== 'string' || !TRACK_LAYOUT_SECTIONS.includes(section)) return 'Invalid telemetry section'
      const min = a.exitAfterMinS, max = a.exitAfterMaxS
      if ((min !== undefined || max !== undefined) && (section !== 'rejoin' ||
          typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) ||
          min < 0 || max < min || max > 180)) return 'Invalid rejoin horizon: require 0 <= min <= max <= 180 seconds'
      const state = history.latestState()
      if (!state) return 'No live telemetry state is retained yet. Start or resume a session, then retry.'
      const now = Date.now()
      const output = JSON.stringify({ dataOnly: true, queriedAt: now,
        result: readTrackLayout(state, { section, exitAfterMinS: min as number | undefined, exitAfterMaxS: max as number | undefined }, now,
          section === 'thermal' ? history.thermalStates(now) : history.recentPositionStates(now), history.circuitPace) })
      return toolResultFits(output) ? output : 'Result exceeds context budget; select positions, geometry or zones separately.'
    }
    if (name === 'read_telemetry_packet') return history.query(a)
    const section = typeof a.section === 'string' ? a.section : ''
    if (!historyOnly && !sections.includes(section)) return 'Invalid telemetry section'
    const offset = a.offset ?? 0, limit = a.limit ?? (historyOnly ? 20 : 3)
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > (historyOnly ? 8191 : 100000) ||
      typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > (historyOnly ? 20 : 4)) return 'Invalid telemetry pagination'
    let result: unknown
    switch (name) {
      case 'get_race_state': result = history.readState(section); break
      case 'get_telemetry_history': result = history.readHistory(section, offset, limit); break
      case 'get_lap_history': result = history.readLaps(section, offset, limit); break
      case 'get_race_events': result = history.readEvents(offset, limit); break
      case 'get_stint_history': result = history.readStints(offset, limit); break
      default: return 'Unknown telemetry tool'
    }
    const encoded = JSON.stringify({ dataOnly: true, queriedAt: Date.now(), result })
    return toolResultFits(encoded) ? encoded : 'Result exceeds context budget; select a narrower section or limit=1.'
}
