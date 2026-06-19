import dgram from 'node:dgram'
import { F1TelemetryClient, constants } from '@deltazeroproduction/f1-udp-parser'
import type { PacketHeader } from './HeaderTypes'
import { logger } from '../logging/Logger'
import type { PacketFormat } from '@shared/index'

const { PACKETS, PACKET_SIZES } = constants
// packetId -> event-name lookup
const PACKET_NAMES = Object.keys(PACKETS) as string[]

export interface AnyParsedPacket {
  m_header: PacketHeader
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * UdpReceiver — owns the dgram socket and parses packets itself via the library's
 * static parseBufferMessage, so we can robustly catch parse errors from truncated/
 * malformed UDP datagrams (which would otherwise be uncaught inside the lib).
 *
 * Pre-validates buffer length against PACKET_SIZES (per m_packetFormat) before parsing.
 * Branches on m_packetFormat (2025 vs 2026 season pack).
 */
export class UdpReceiver {
  private socket: dgram.Socket | null = null
  private handlers = new Map<string, (p: AnyParsedPacket) => void>()
  private running = false
  public packetsReceived = 0
  public packetsDropped = 0
  public lastPacketMs = 0
  public currentFormat: PacketFormat | null = null

  constructor(private readonly port = 20777) {}

  /** Register a reducer for a packet event name (one of the PACKETS keys). */
  on(name: string, cb: (p: AnyParsedPacket) => void): void {
    this.handlers.set(name, cb)
  }

  start(): void {
    if (this.running) return
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket.on('message', (msg: Buffer) => this.handleMessage(msg))
    this.socket.on('error', (err: Error) => logger.error('UDP socket error:', err.message))
    this.socket.bind(this.port, () => {
      logger.info(`UDP receiver started on port ${this.port} (0.0.0.0)`)
    })
    this.running = true
  }

  private handleMessage(msg: Buffer): void {
    if (msg.length < 29) {
      this.packetsDropped++
      return
    }
    const fmt = msg.readUInt16LE(0)
    const packetId = msg.readUInt8(6)
    // 2026 season-pack packet 16 (CAR_TELEMETRY_2) is valid for that format but not registered
    // by our reducers — don't count it as a dropped/error packet.
    if (fmt === 2026 && packetId === 16) {
      this.record(packetId, fmt)
      return
    }
    const expected = this.expectedSize(packetId, fmt)
    if (expected != null && msg.length < expected) {
      // truncated datagram — drop instead of letting the parser throw
      this.packetsDropped++
      return
    }
    try {
      const parsed = F1TelemetryClient.parseBufferMessage(msg)
      if (!parsed) {
        this.packetsDropped++
        return
      }
      const { packetID, packetData } = parsed as { packetID: string; packetData: { data: AnyParsedPacket } }
      const data = packetData?.data
      if (!data || !data.m_header) {
        this.packetsDropped++
        return
      }
      this.record(packetId, fmt)
      const cb = this.handlers.get(packetID)
      if (cb) cb(data)
    } catch (err) {
      this.packetsDropped++
      logger.warn(`UDP packet dropped (id=${packetId} fmt=${fmt}, len=${msg.length}):`, (err as Error)?.message ?? err)
    }
  }

  private record(packetId: number, fmt: number): void {
    this.packetsReceived++
    this.lastPacketMs = Date.now()
    const format = (fmt === 2026 ? 2026 : 2025) as PacketFormat
    if (this.currentFormat !== format) {
      this.currentFormat = format
      logger.info(`F1 packet format detected: ${format} (packetId ${packetId})`)
    }
  }

  private expectedSize(packetId: number, fmt: number): number | null {
    const name = PACKET_NAMES[packetId]
    if (!name) return null
    const sizes = (PACKET_SIZES as Record<string, Record<number, number>>)[name]
    if (!sizes) return null
    return sizes[fmt] ?? sizes[2025] ?? null
  }

  stop(): void {
    if (!this.running || !this.socket) return
    try {
      this.socket.close()
    } catch (e) {
      logger.warn('UDP close error:', e)
    }
    this.running = false
  }
}

export { PACKETS }
