import { constants } from '@deltazeroproduction/f1-udp-parser'
import { UdpReceiver } from './UdpReceiver'
import { StateAggregator } from '../state/StateAggregator'
import { SnapshotEmitter } from '../state/SnapshotEmitter'
import { TriggerEngine } from '../triggers/TriggerEngine'
import { Sender } from '../ipc/sender'
import { logger } from '../logging/Logger'
import type { PacketFormat, TriggerConfig, TriggerFiring, RecentEvent } from '@shared/index'

const { PACKETS } = constants

/**
 * TelemetryService — owns the ingest + trigger pipeline:
 *   UdpReceiver (dgram) -> StateAggregator (reducers) -> SnapshotEmitter (throttle)
 *                                                  \-> TriggerEngine -> onFiring callback
 * Branches on m_packetFormat internally (2025 vs 2026 handled by the library).
 */
export class TelemetryService {
  private receiver: UdpReceiver
  public aggregator: StateAggregator
  private emitter: SnapshotEmitter
  public triggers: TriggerEngine
  private triggerTimer: NodeJS.Timeout | null = null
  private pendingEvents: RecentEvent[] = []
  private lastOverallFrame = 0
  private lastSessionUID = ''
  private lastTrackId = -1
  private running = false

  constructor(
    port = 20777,
    triggerConfig: TriggerConfig,
    onFiring: (f: TriggerFiring) => void
  ) {
    this.aggregator = new StateAggregator()
    this.receiver = new UdpReceiver(port)
    this.triggers = new TriggerEngine(triggerConfig, onFiring)
    this.emitter = new SnapshotEmitter(this.aggregator, () => ({
      packetsReceived: this.receiver.packetsReceived,
      packetsDropped: this.receiver.packetsDropped,
      lastPacketMs: this.receiver.lastPacketMs,
      format: this.receiver.currentFormat
    }))

    // bind every reducer to its packet event (PACKETS values are strings)
    const P = PACKETS as unknown as Record<string, string>
    this.receiver.on(P.session, (p) => {
      const prevUid = this.aggregator.getState().session.sessionUID
      const newUid = (p.m_header as { m_sessionUID: bigint }).m_sessionUID.toString()
      // reset state BEFORE onSession so the new session's data isn't wiped by an
      // empty reset (otherwise stale-rival + session-data loss bug C2).
      if (prevUid && prevUid !== newUid) {
        logger.info(`Session changed: ${prevUid} -> ${newUid}, resetting state`)
        this.aggregator.reset(this.receiver.currentFormat ?? 2025)
      }
      this.aggregator.onSession(p)
      this.maybeEmitSessionMeta()
    })
    this.receiver.on(P.motion, (p) => this.aggregator.onMotion(p))
    this.receiver.on(P.participants, (p) => this.aggregator.onParticipants(p))
    this.receiver.on(P.lapData, (p) => {
      this.aggregator.onLapData(p)
      // detect flashback (overallFrameIdentifier regression within same session)
      this.checkFlashback(p)
    })
    this.receiver.on(P.carTelemetry, (p) => this.aggregator.onCarTelemetry(p))
    this.receiver.on(P.carStatus, (p) => this.aggregator.onCarStatus(p))
    this.receiver.on(P.carDamage, (p) => this.aggregator.onCarDamage(p))
    this.receiver.on(P.carSetups, (p) => this.aggregator.onCarSetup(p))
    this.receiver.on(P.event, (p) => {
      this.aggregator.onEvent(p)
      this.drainEvents()
    })
    this.receiver.on(P.sessionHistory, (p) => this.aggregator.onSessionHistory(p))
  }

  /** Emit session:meta when format or track changes (so the UI can react). */
  private maybeEmitSessionMeta(): void {
    const s = this.aggregator.getState().session
    const fmt = this.receiver.currentFormat
    if (fmt && (s.trackId !== this.lastTrackId || fmt !== this.lastMetaFormat)) {
      this.lastTrackId = s.trackId
      this.lastMetaFormat = fmt
      Sender.send('session:meta', {
        packetFormat: fmt,
        trackName: s.trackName,
        trackId: s.trackId,
        sessionTypeLabel: s.sessionTypeLabel
      })
    }
  }
  private lastMetaFormat: number | null = null

  start(): void {
    if (this.running) return
    this.receiver.start()
    this.emitter.start()
    // evaluate triggers at 2Hz — fast enough to feel responsive, cheap enough to never thrash
    this.triggerTimer = setInterval(() => this.tick(), 500)
    this.running = true
  }

  private tick(): void {
    const state = this.aggregator.getState()
    this.triggers.evaluate(state)
    this.drainEvents()
  }

  private drainEvents(): void {
    const state = this.aggregator.getState()
    const events = state.recentEvents
    if (events.length === 0) return
    for (const ev of events) {
      if (this.pendingEvents.includes(ev)) continue
      this.pendingEvents.push(ev)
      this.triggers.onEvent(state, ev)
    }
    // cap the dedup buffer
    if (this.pendingEvents.length > 50) this.pendingEvents = this.pendingEvents.slice(-50)
  }

  private checkFlashback(p: { m_header: { m_overallFrameIdentifier: number; m_sessionUID: bigint } }): void {
    const uid = p.m_header.m_sessionUID.toString()
    const frame = p.m_header.m_overallFrameIdentifier
    if (this.lastSessionUID === uid && frame < this.lastOverallFrame - 5) {
      this.triggers.noteFlashback()
    }
    this.lastOverallFrame = frame
    this.lastSessionUID = uid
  }

  stop(): void {
    if (!this.running) return
    if (this.triggerTimer) clearInterval(this.triggerTimer)
    this.triggerTimer = null
    this.emitter.stop()
    this.receiver.stop()
    this.running = false
    logger.info('TelemetryService stopped')
  }

  get packetFormat(): PacketFormat | null {
    return this.receiver.currentFormat
  }

  packetsReceived(): number {
    return this.receiver.packetsReceived
  }
}
