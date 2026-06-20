import type { StateAggregator } from './StateAggregator'
import { Sender } from '../ipc/sender'
import { logger } from '../logging/Logger'
import type { SnapshotPayload, RaceState, HealthPayload } from '@shared/index'

const HEALTH_HZ = 2

/**
 * SnapshotEmitter — the flood-defense throttle.
 * Main process holds full-resolution state; we only send compact slices to the renderer:
 *   - SNAPSHOT ~12Hz: fast paint fields (speed/gear/rpm/ers/drs/pedals)
 *   - PAINT    ~2Hz:  the full RaceState for panels (tyres/damage/rivals/positions)
 *   - HEALTH   ~2Hz:  packet watchdog + counters
 */
export class SnapshotEmitter {
  private snapshotTimer: NodeJS.Timeout | null = null
  private paintTimer: NodeJS.Timeout | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private lastPaintJson = ''
  private running = false
  private snapshotHz = 12
  private paintHz = 12

  constructor(
    private aggregator: StateAggregator,
    private getStats: () => { packetsReceived: number; packetsDropped: number; lastPacketMs: number; format: number | null },
    rendererPaintHz = 12
  ) {
    this.setRendererPaintHz(rendererPaintHz)
  }

  setRendererPaintHz(hz: number): void {
    const next = clampHz(hz)
    if (next === this.paintHz && next === this.snapshotHz) return
    this.snapshotHz = next
    this.paintHz = next
    if (this.running) {
      this.stopTimers()
      this.startTimers()
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.startTimers()
  }

  private startTimers(): void {
    const snapshot = (): void => {
      const s = this.aggregator.state
      const p = s.player
      const payload: SnapshotPayload = {
        ts: Date.now(),
        speedKmh: p.speedKmh,
        gear: p.gear,
        rpm: p.rpm,
        ersPercent: p.ersPercent,
        drsActive: p.drsActive,
        drsAllowed: p.drsAllowed,
        throttle: p.throttle,
        brake: p.brake,
        revLightsPercent: p.revLightsPercent
      }
      Sender.send('telemetry:snapshot', payload)
    }

    const paint = (): void => {
      const state: RaceState = this.aggregator.getState()
      const json = JSON.stringify(state)
      // shallow diff: skip if nothing changed
      if (json === this.lastPaintJson) return
      this.lastPaintJson = json
      Sender.send('state:paint', state)
    }

    const health = (): void => {
      const stats = this.getStats()
      const now = Date.now()
      const waiting = stats.lastPacketMs === 0 || now - stats.lastPacketMs > 3000
      const state = this.aggregator.state
      state.lastPacketMs = stats.lastPacketMs
      state.packetsReceived = stats.packetsReceived
      state.packetsDropped = stats.packetsDropped
      const payload: HealthPayload = {
        connected: !waiting,
        waiting,
        packetsReceived: stats.packetsReceived,
        packetsDropped: stats.packetsDropped,
        lastPacketMs: stats.lastPacketMs,
        errors: []
      }
      Sender.send('health', payload)
    }

    this.snapshotTimer = setInterval(snapshot, 1000 / this.snapshotHz)
    this.paintTimer = setInterval(paint, 1000 / this.paintHz)
    this.healthTimer = setInterval(health, 1000 / HEALTH_HZ)
    logger.info(`SnapshotEmitter started (snapshot ${this.snapshotHz}Hz, paint ${this.paintHz}Hz, health ${HEALTH_HZ}Hz)`)
  }

  stop(): void {
    this.stopTimers()
    this.running = false
  }

  private stopTimers(): void {
    for (const t of [this.snapshotTimer, this.paintTimer, this.healthTimer]) {
      if (t) clearInterval(t)
    }
    this.snapshotTimer = this.paintTimer = this.healthTimer = null
  }
}

function clampHz(hz: number): number {
  if (!Number.isFinite(hz)) return 12
  return Math.max(2, Math.min(60, Math.round(hz)))
}
