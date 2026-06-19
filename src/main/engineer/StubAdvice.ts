import type { Digest } from '@shared/index'

/**
 * StubAdvice — placeholder engineer responses for the P2 milestone.
 * Produces a canned radio-style line from the digest WITHOUT calling the LLM,
 * so the digest -> advice -> UI path can be validated end-to-end before P3.
 * Replaced by the real LLM client in P3.
 */
export class StubAdvice {
  generate(d: Digest): string {
    const reason = d.trigger.code

    if (reason.startsWith('tyre_wear')) {
      const lvl = d.player.tyre.wear
      return `Tyres at ${lvl}, manage them — lift and coast into the heavy braking zones.`
    }
    if (reason === 'defend_warning') {
      return `Car behind within a second, defending. Hold the inside line, use the full track.`
    }
    if (reason === 'attack_opportunity') {
      return `Car ahead within reach, attack. Get a clean exit and set up the move.`
    }
    if (reason === 'pit_window_open' || reason === 'stint_end') {
      return `Box this lap, box. Fresh tyres ready — ${d.player.tyre.compound} stint done.`
    }
    if (reason === 'safety_car' || reason === 'vsc') {
      return `Safety car. Pit now if we can — cheap stop, big gain.`
    }
    if (reason === 'rain_imminent' || reason === 'rain_started') {
      return `Rain coming. Box for inters next lap, stay out one more if it's light.`
    }
    if (reason === 'low_fuel') {
      return `Fuel critical — lift and coast, lean mix, we'll make it to the end.`
    }
    if (reason === 'wing_damaged' || reason === 'suspension_damaged') {
      return `Damage confirmed. We'll assess at the next stop, keep pushing for now.`
    }
    if (reason === 'penalty') {
      return `Penalty served, push now — clean air, fast lap.`
    }

    // heartbeat / default
    return `P${reason ? '' : ''}${d.player.pos}, ${d.player.fuel} fuel, tyres at ${d.player.tyre.wear}. Push, keep the gap.`
  }
}
