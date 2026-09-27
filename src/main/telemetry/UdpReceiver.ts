import dgram from 'node:dgram'
import { F1TelemetryClient, constants } from '@z0mt3c/f1-telemetry-client'
import type { PacketHeader } from './HeaderTypes'
import { logger } from '../logging/Logger'
import type { PacketFormat } from '@shared/index'

const { PACKETS, PACKET_SIZES, PACKET_ID_TO_PACKET } = constants

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
  onDecoded: (id: number, packet: AnyParsedPacket) => void = () => {}
  private formatOverride: PacketFormat | null = null

  constructor(private port = 20777, formatOverride: 'auto' | PacketFormat = 'auto') {
    this.setFormatOverride(formatOverride)
  }

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

  setPort(port: number): void {
    const next = normalizePort(port, this.port)
    if (next === this.port) return
    const wasRunning = this.running
    if (wasRunning) this.stop()
    this.port = next
    this.packetsReceived = 0
    this.packetsDropped = 0
    this.lastPacketMs = 0
    this.currentFormat = null
    if (wasRunning) this.start()
  }

  private handleMessage(msg: Buffer): void {
    if (msg.length < 29) {
      this.packetsDropped++
      return
    }
    const fmt = msg.readUInt16LE(0)
    const packetId = msg.readUInt8(6)
    if ((fmt !== 2025 && fmt !== 2026) || (this.formatOverride != null && fmt !== this.formatOverride)) {
      this.packetsDropped++
      return
    }
    const name = (PACKET_ID_TO_PACKET as Record<number, string | undefined>)[packetId]
    const expected = name ? (PACKET_SIZES as Record<string, Record<number, number>>)[name]?.[fmt] : undefined
    // Event payloads vary by event code; every event has a 29-byte header and 4-byte code.
    if (!name || expected == null || msg.length < (packetId === 3 ? 33 : expected)) {
      // truncated datagram — drop instead of letting the parser throw
      this.packetsDropped++
      return
    }
    try {
      const parsed = F1TelemetryClient.parseBufferMessage(msg, true)
      const data = parsed?.data as AnyParsedPacket | undefined
      if (!data?.m_header || parsed.name !== name) {
        this.packetsDropped++
        return
      }
      this.record(packetId, fmt)
      const cb = this.handlers.get(name)
      if (cb) cb(data)
      this.onDecoded(packetId, data)
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

  setFormatOverride(format: 'auto' | PacketFormat): void {
    this.formatOverride = format === 'auto' ? null : format
    this.currentFormat = null
  }

  stop(): void {
    if (!this.running || !this.socket) return
    const sock = this.socket
    try {
      sock.removeAllListeners()
      sock.close()
    } catch (e) {
      logger.warn('UDP close error:', e)
    }
    this.socket = null
    this.running = false
  }
}

export { PACKETS }

function normalizePort(port: number, fallback: number): number {
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback
}
