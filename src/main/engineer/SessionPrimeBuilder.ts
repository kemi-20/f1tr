import type { RaceState } from '@shared/types/state'
import { getTrack } from '@shared/index'

/**
 * SessionPrimeBuilder — layer 2 of the context.
 *
 * Builds the stable baseline of facts that rarely change within a race:
 *   track (name/length/corners/DRS), session type & rules, weather baseline,
 *   the full driver/team/number grid, and the player's car SETUP (from packet 5).
 *
 * This is injected ONCE at race start as a stable message prefix, so prompt-cache hits
 * on every subsequent call — only the short digest (layer 3) is charged as fresh input.
 *
 * Per plan: rebuild on session change (P/Q/R transitions), keep ConversationMemory otherwise.
 */
export class SessionPrimeBuilder {
  build(state: RaceState): string {
    const s = state.session
    const w = state.weather
    const track = getTrack(s.trackId)
    const lines: string[] = []

    lines.push('=== RACE WEEKEND BASELINE (stable, cached) ===')
    lines.push(`TRACK: ${s.trackName || `#${s.trackId}`}${track ? ` • ${track.country} • ${track.lengthKm}km • ${track.laps} laps` : ''}`)
    lines.push(`SESSION: ${s.sessionTypeLabel}${s.totalLaps ? ` • ${s.totalLaps} laps` : ''}${s.pitSpeedLimitKmh ? ` • pit limit ${s.pitSpeedLimitKmh}km/h` : ''}`)
    lines.push(`WEATHER BASELINE: air ${Math.round(w.airTempC)}C, track ${Math.round(w.trackTempC)}C, rain ${Math.round(w.rainPercentage)}%`)
    lines.push(`FORMAT: F1 ${s.packetFormat} (year ${s.gameYear})`)

    // grid of drivers/teams/numbers
    const rivals = Object.values(state.rivals).sort((a, b) => a.position - b.position)
    if (rivals.length > 0) {
      lines.push('GRID:')
      for (const r of rivals) {
        const num = r.raceNumber || r.carIndex
        lines.push(`  P${r.position} #${num} ${r.name || `car${r.carIndex}`}`)
      }
    }

    // player setup (packet 5)
    const setup = state.player.setup
    if (setup) {
      lines.push('YOUR SETUP:')
      lines.push(
        `  wings F${setup.frontWing} R${setup.rearWing} • diff on/off ${setup.onThrottleDiff}/${setup.offThrottleDiff}` +
          ` • brake bias ${setup.brakeBias} pressure ${setup.brakePressure}`
      )
      lines.push(
        `  camber F${setup.camberFL.toFixed(2)} R${setup.camberRL.toFixed(2)} • ARB ${setup.antiRollFront}/${setup.antiRollRear}`
      )
      lines.push(
        `  tyre pressures F${setup.frontTyrePressure.toFixed(1)} R${setup.rearTyrePressure.toFixed(1)} • ballast ${setup.ballast} • fuel ${setup.fuelLoad}`
      )
    }

    lines.push('=== END BASELINE ===')
    lines.push('Above is cached. Newest info arrives in the RACE STATE digest below each time. Keep replies short.')
    return lines.join('\n')
  }
}
