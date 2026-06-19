import type { Digest } from '@shared/index'
import type { RaceState } from '@shared/types/state'
import type { TriggerFiring } from '@shared/types/triggers'
import { fmtLapTime, fmtGap, fmtPct } from '@shared/util/format'

/**
 * DigestBuilder — the lossy projection of RaceState -> a compact ~120-300 token text block.
 * This is what makes "send ALL data to the AI" actually usable and cheap:
 * the aggregator holds everything; the digest is what crosses to the LLM, only at meaningful moments.
 */
export class DigestBuilder {
  build(state: RaceState, firing: TriggerFiring): Digest {
    const s = state.session
    const w = state.weather
    const p = state.player
    const sc = s.isRedFlag ? 'red' : s.isSafetyCar ? 'sc' : s.isVirtualSafetyCar ? 'vsc' : 'none'

    const playerRivals = this.rivalsAroundPlayer(state, 4)

    return {
      ts: Date.now(),
      session: {
        track: s.trackName || `track#${s.trackId}`,
        type: s.sessionTypeLabel,
        // practice has no lap limit — don't show "Lap X" (AI misreads as "last lap")
        lap: s.totalLaps ? `${s.currentLap}/${s.totalLaps}` : '',
        timeLeft: s.sessionTimeLeftS != null ? this.fmtClock(s.sessionTimeLeftS) : undefined,
        sc
      },
      weather: {
        airC: Math.round(w.airTempC),
        trackC: Math.round(w.trackTempC),
        rainPct: Math.round(w.rainPercentage),
        wet: Math.round(w.wetness * 100),
        expected: this.weatherExpected(w)
      },
      player: {
        pos: `P${p.position}`,
        gapAhead: this.fmtAheadGap(state),
        gapBehind: this.fmtBehindGap(state),
        lastLap: fmtLapTime(p.lastLapTimeS ? p.lastLapTimeS * 1000 : null),
        bestLap: fmtLapTime(p.bestLapTimeS ? p.bestLapTimeS * 1000 : null),
        fuel: p.fuelRemainingKg != null ? `${p.fuelRemainingKg.toFixed(1)}kg` : '--',
        pits: p.pitStopCount,
        ers: fmtPct(p.ersPercent),
        drs: p.drsAllowed ? 'available' : p.drsActive ? 'active' : 'no',
        tyre: {
          compound: p.tyres.compound,
          age: `${p.tyres.ageLaps}L`,
          wear: this.fmtCorners(p.tyres.wear),
          surfaceT: this.fmtCorners(p.tyres.surfaceTempC),
          blister: String(this.maxCorner(p.tyres.blisters))
        },
        dmg: {
          wingL: this.fmtDamage(p.damage.frontLeftWing),
          wingR: this.fmtDamage(p.damage.frontRightWing)
        }
      },
      rivals: playerRivals,
      events: state.recentEvents.slice(-4).map((e) => `[${e.type}] ${e.text}`),
      trigger: { code: firing.reasonCode, reason: firing.reason, priority: firing.priority }
    }
  }

  /** Render the digest to the compact text block actually sent to the LLM. */
  toText(d: Digest): string {
    const lines: string[] = []
    // practice sessions (lap=''): don't show Lap — AI would misread as "last lap"
    const lapPart = d.session.lap ? `Lap ${d.session.lap}` : ''
    lines.push(
      `RACE: ${d.session.track} • ${d.session.type}` +
        (lapPart ? ` • ${lapPart}` : '') +
        (d.session.timeLeft ? ` • ${d.session.timeLeft} left` : '') +
        ` • SC: ${d.session.sc.toUpperCase()}`
    )
    lines.push(
      `WEATHER: air ${d.weather.airC}C track ${d.weather.trackC}C rain ${d.weather.rainPct}% wet ${d.weather.wet}% expected: ${d.weather.expected}`
    )
    lines.push(
      `PLAYER: ${d.player.pos}` +
        (d.player.gapAhead ? ` • ${d.player.gapAhead} to car ahead` : '') +
        (d.player.gapBehind ? ` • ${d.player.gapBehind} to car behind` : '') +
        ` • last ${d.player.lastLap} best ${d.player.bestLap} • fuel ${d.player.fuel} • pits ${d.player.pits}` +
        ` • ERS ${d.player.ers} • DRS ${d.player.drs}`
    )
    lines.push(
      `  TYRE: ${d.player.tyre.compound} ${d.player.tyre.age} • wear ${d.player.tyre.wear}` +
        ` • surf ${d.player.tyre.surfaceT}C • blister ${d.player.tyre.blister}`
    )
    lines.push(`  DMG: F-wing L ${d.player.dmg.wingL} R ${d.player.dmg.wingR}`)
    if (d.rivals.length > 0) {
      lines.push('RIVALS:')
      for (const r of d.rivals) {
        lines.push(
          `  P${r.pos} ${r.name} ${r.tyre} gap ${r.gap} pits ${r.pits}` +
            (r.pen ? ` pen ${r.pen}` : '') +
            (r.note ? ` — ${r.note}` : '')
        )
      }
    }
    if (d.events.length > 0) lines.push(`EVENTS: ${d.events.join(' • ')}`)
    lines.push(`TRIGGER [${d.trigger.priority}] ${d.trigger.code}: ${d.trigger.reason}`)
    return lines.join('\n')
  }

  // ───────────────────────── helpers ─────────────────────────

  private rivalsAroundPlayer(state: RaceState, count: number): Digest['rivals'] {
    const playerPos = state.player.position
    const all = Object.values(state.rivals)
    // cars immediately ahead and behind the player
    const ahead = all.filter((r) => r.position < playerPos).sort((a, b) => b.position - a.position).slice(0, count)
    const behind = all.filter((r) => r.position > playerPos).sort((a, b) => a.position - b.position).slice(0, count)
    const window = [...ahead, ...behind]
    return window.map((r) => ({
      pos: r.position,
      name: (r.name || `car${r.carIndex}`).toUpperCase(),
      tyre: r.tyreCompound,
      gap: fmtGap(r.gapToPlayerS),
      pits: r.pitStopCount,
      pen: r.penaltiesS > 0 ? `${r.penaltiesS}s` : undefined,
      note:
        r.status === 'retired'
          ? 'DNF'
          : r.pitStatus === 2
            ? 'in pit'
            : r.deltaToCarBehindS != null && Math.abs(r.deltaToCarBehindS) < 0.8
              ? 'pressuring'
              : undefined
    }))
  }

  private fmtAheadGap(state: RaceState): string | undefined {
    const playerPos = state.player.position
    const ahead = Object.values(state.rivals).find((r) => r.position === playerPos - 1)
    if (!ahead) return undefined
    // use the ahead car's gapToPlayerS (cumulative from player = correct), or the
    // player's own deltaToCarInFrontS for the directly-adjacent car
    const gap = ahead.gapToPlayerS
    if (gap == null || gap === 0) return undefined
    return `${fmtGap(gap)} to ${ahead.name || 'ahead'}`
  }

  private fmtBehindGap(state: RaceState): string | undefined {
    const playerPos = state.player.position
    const behind = Object.values(state.rivals).find((r) => r.position === playerPos + 1)
    if (!behind) return undefined
    const gap = behind.gapToPlayerS
    if (gap == null || gap === 0) return undefined
    return `${fmtGap(gap)} to ${behind.name || 'behind'}`
  }

  private fmtClock(s: number): string {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  private weatherExpected(w: RaceState['weather']): string {
    if (w.rainPercentage > 50 || w.isRaining) return 'wet'
    if (w.rainPercentage > 25) return 'changeable'
    if (w.wetness > 0.3) return 'drying'
    return 'dry'
  }

  private fmtCorners(c: { rl: number; rr: number; fl: number; fr: number }): string {
    return `${Math.round(c.rl)}/${Math.round(c.rr)}/${Math.round(c.fl)}/${Math.round(c.fr)}`
  }

  private maxCorner(c: { rl: number; rr: number; fl: number; fr: number }): number {
    return Math.max(c.rl, c.rr, c.fl, c.fr)
  }

  private fmtDamage(v: number): string {
    return `${Math.round(v * 100)}%`
  }
}
