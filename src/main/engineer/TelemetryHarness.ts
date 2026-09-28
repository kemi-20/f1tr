import type { TelemetryHistory } from './TelemetryHistory'
import { readTrackLayout, TRACK_LAYOUT_SECTIONS } from './TrackLayoutReport'

const sections = ['all', 'player', 'rivals', 'weather', 'session', 'trackPositions', 'events']
const sectionProperty = { type: 'string', enum: sections, description: 'Select the relevant data category to avoid unnecessary context.' }
const paging = {
  section: sectionProperty,
  offset: { type: 'integer', minimum: 0, maximum: 100000, description: 'Newest-first offset; follow nextOffset for older records.' },
  limit: { type: 'integer', minimum: 1, maximum: 4 }
}

export const TELEMETRY_TOOLS = [
  tool('get_race_state', 'Read latest complete normalized telemetry: all cars, player tyres/temperatures/damage/setup/energy, weather, flags and positions. Returned ts is capture time, not execution time.', { section: sectionProperty }, ['section']),
  tool('get_track_layout', 'Read circuit sectors/zones plus each car\'s lap location, signed physical circuit separation, cumulative race-distance separation, lap difference, pit/phase and speed. Use before naming a location or assessing traffic. Physical proximity and race-order gap are different.', {
    section: { type: 'string', enum: ['summary', 'zones', 'positions', 'all'], description: 'Pick the narrowest section you need.' }
  }, []),
  tool('get_telemetry_history', 'Inspect 5-second time samples from the last 5 minutes to test temperature, gap, energy, fuel or damage trends. Fields retain their real units and nulls. Returns newest first with pagination.', paging, ['section']),
  tool('get_lap_history', 'Inspect completed-lap boundary snapshots (up to 120 retained). Use player for pace/fuel/wear trends and rivals for opponent laps/stops; all includes conditions. These are observations, not guarantees of clean laps.', paging, ['section']),
  tool('get_race_events', 'Read recorded flags, pit entries/exits, penalties, damage and other race events across the current weekend, newest first.', {
    offset: { type: 'integer', minimum: 0, maximum: 8191 }, limit: { type: 'integer', minimum: 1, maximum: 20 }
  }, []),
  tool('get_stint_history', 'Read tyre and fuel stint summaries across the current weekend, newest first.', {
    offset: { type: 'integer', minimum: 0, maximum: 8191 }, limit: { type: 'integer', minimum: 1, maximum: 20 }
  }, []),
  tool('read_telemetry_packet', 'Read original decoded fields absent from the dashboard: sector/validity history, tyre sets, motion, setups, actual energy harvest/deploy and weather forecasts. Use an exact key from the TELEMETRY TOOLS inventory (packetId or packetId:carIndex). Offset 0 is the live latest value; up to 12 samples per key at 5-second spacing. Large packets are rejected as too large: then re-query with field, and with arrayOffset/arrayLimit when that field is an array. Field paths are dot-separated own properties such as m_tyreSets or m_tyreWear.', {
    packet: { type: 'string', pattern: '^\\d{1,2}(?::\\d{1,2})?$' },
    offset: { type: 'integer', minimum: 0, maximum: 11 },
    field: { type: 'string', minLength: 1, maxLength: 256 },
    arrayOffset: { type: 'integer', minimum: 0, maximum: 10000 },
    arrayLimit: { type: 'integer', minimum: 1, maximum: 64 }
  }, ['packet'])
]

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { type: 'function' as const, function: { name, description,
    parameters: { type: 'object' as const, properties, required, additionalProperties: false } } }
}

/** Read-only harness. Model-supplied names/arguments never reach filesystem, network or eval. */
export function executeTelemetryTool(history: TelemetryHistory, name: string, input: string): string {
  if (input.length > 2048) return 'Invalid telemetry arguments: too large'
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
    const historyOnly = name === 'get_race_events' || name === 'get_stint_history'
    const layoutOnly = name === 'get_track_layout'
    const allowed = name === 'read_telemetry_packet'
      ? ['packet', 'offset', 'field', 'arrayOffset', 'arrayLimit']
      : layoutOnly ? ['section']
      : name === 'get_race_state' ? ['section'] : historyOnly ? ['offset', 'limit'] : ['section', 'offset', 'limit']
    if (Object.keys(a).some(k => !allowed.includes(k))) return 'Invalid telemetry arguments: unknown field'
    if (layoutOnly) {
      const section = a.section ?? 'all'
      if (typeof section !== 'string' || !TRACK_LAYOUT_SECTIONS.includes(section)) return 'Invalid telemetry section'
      const state = history.latestState()
      if (!state) return 'No live telemetry state is retained yet. Start or resume a session, then retry.'
      return JSON.stringify({ dataOnly: true, queriedAt: Date.now(), result: readTrackLayout(state, { section }) })
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
    return encoded.length <= 60000 ? encoded : 'Result exceeds context budget; select a narrower section or limit=1.'
}
