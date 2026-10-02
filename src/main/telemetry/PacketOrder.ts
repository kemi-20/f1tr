import type { AnyParsedPacket } from './UdpReceiver'

/** Overall frames stay monotonic through flashbacks; packet streams have separate rates. */
export class PacketOrder {
  private uid = ''
  private retired = new Set<string>()
  private frames = new Map<string, number>()
  private events = new Set<string>()
  private flashbackFloor = -1

  reset(): void {
    this.uid = ''
    this.retired.clear()
    this.frames.clear()
    this.events.clear()
    this.flashbackFloor = -1
  }

  accept(packet: AnyParsedPacket): boolean {
    const h = packet.m_header
    if (!Number.isInteger(h.m_packetId)) return true
    const uid = String(h.m_sessionUID)
    if (uid !== this.uid) {
      if (this.retired.has(uid)) return false
      if (this.uid) this.retired.add(this.uid)
      // Keep a bounded list of previous sessions so late packets cannot revive them.
      if (this.retired.size > 64) this.retired.delete(this.retired.values().next().value!)
      this.uid = uid
      this.frames.clear()
      this.events.clear()
      this.flashbackFloor = -1
    }
    const overall = h.m_overallFrameIdentifier
    const frame = overall > 0 ? overall : h.m_frameIdentifier
    if (h.m_packetId === 3) {
      const event = `${frame}:${packet.m_eventStringCode}:${JSON.stringify(packet.m_eventDetails)}`
      if (this.events.has(event)) return false
      this.events.add(event)
      if (this.events.size > 128) this.events.delete(this.events.values().next().value!)
    }
    // Some older/synthetic feeds omit both counters; no ordering evidence exists.
    if (!Number.isFinite(frame) || frame === 0) {
      if (packet.m_eventStringCode === 'FLBK') this.frames.clear()
      return true
    }
    if (overall > 0 && overall < this.flashbackFloor) return false
    // Events and history packets may have multiple distinct payloads in the same frame.
    const key = `${h.m_packetId}:${h.m_packetId === 11 ? packet.m_carIdx : ''}`
    const previous = this.frames.get(key)
    if (previous != null && (frame < previous || (frame === previous && h.m_packetId !== 3))) return false
    this.frames.set(key, frame)
    if (h.m_packetId === 3 && packet.m_eventStringCode === 'FLBK') {
      this.flashbackFloor = overall > 0 ? overall : -1
      // Without the overall counter, explicit FLBK is the only safe epoch boundary.
      if (!overall) this.frames.clear()
    }
    return true
  }
}
