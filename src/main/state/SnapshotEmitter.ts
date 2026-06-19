import type { StateAggregator } from './StateAggregator'
import { Sender } from '../ipc/sender'
import { logger } from '../logging/Logger'
import type { SnapshotPayload, RaceState, HealthPayload } from '@shared/index'

const SNAPSHOT_HZ = 12
const PAINT_HZ = 2
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

  constructor(
    private aggregator: StateAggregator,
    private getStats: () => { packetsReceived: number; packetsDropped: number; lastPacketMs: number; format: number | null }
  ) {}

  start(): void {
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

    this.snapshotTimer = setInterval(snapshot, 1000 / SNAPSHOT_HZ)
    this.paintTimer = setInterval(paint, 1000 / PAINT_HZ)
    this.healthTimer = setInterval(health, 1000 / HEALTH_HZ)
    logger.info(`SnapshotEmitter started (snapshot ${SNAPSHOT_HZ}Hz, paint ${PAINT_HZ}Hz, health ${HEALTH_HZ}Hz)`)
  }

  stop(): void {
    for (const t of [this.snapshotTimer, this.paintTimer, this.healthTimer]) {
      if (t) clearInterval(t)
    }
    this.snapshotTimer = this.paintTimer = this.healthTimer = null
  }
}
