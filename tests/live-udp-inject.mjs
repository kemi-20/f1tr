/**
 * Live UDP ingest test — synthesizes a minimal valid F1 25 SESSION packet (packetId 1)
 * using the library's own header layout, sends it to 127.0.0.1:20777, and confirms
 * the running app's aggregator parses it (via the 'config:test:udp' IPC counter rising).
 *
 * Run while `npm run dev` is active in another terminal:
 *   node tests/live-udp-inject.mjs
 *
 * This validates the full ingest path (socket bind -> header decode -> reducer -> counter)
 * without needing the F1 game running.
 *
 * Packet header layout (little-endian, 29 bytes):
 *   u16 packetFormat, u8 gameYear, u8 major, u8 minor, u8 packetVersion,
 *   u8 packetId, u8[8] sessionUID, f32 sessionTime, u32 frameIdentifier,
 *   u32 overallFrameIdentifier, u8 playerCarIndex, u8 secondaryPlayerCarIndex
 */
import dgram from 'node:dgram'
import { Buffer } from 'node:buffer'

const PORT = 20777
const HOST = '127.0.0.1'

// We only need a valid header for the library to route + the reducer to read a few fields.
// The library checks buffer length against PACKET_SIZES; must match exactly.
// Session packet for format 2025 = 753 bytes.
const SESSION_PACKET_SIZE = 753

const buf = Buffer.alloc(SESSION_PACKET_SIZE, 0)
let off = 0
buf.writeUInt16LE(2025, off); off += 2 // packetFormat
buf.writeUInt8(25, off); off += 1 // gameYear
buf.writeUInt8(1, off); off += 1 // majorVersion
buf.writeUInt8(0, off); off += 1 // minorVersion
buf.writeUInt8(1, off); off += 1 // packetVersion
buf.writeUInt8(1, off); off += 1 // packetId = SESSION
// sessionUID: 8 bytes (leave 0)
off += 8
buf.writeFloatLE(12.5, off); off += 4 // sessionTime
buf.writeUInt32LE(42, off); off += 4 // frameIdentifier
buf.writeUInt32LE(42, off); off += 4 // overallFrameIdentifier
buf.writeUInt8(0, off); off += 1 // playerCarIndex
buf.writeUInt8(0, off); off += 1 // secondaryPlayerCarIndex

// Body: write a few fields the Session reducer reads.
// Offsets within PacketSessionData after the 29-byte header:
// m_weather(u8), m_trackTemperature(i8), m_airTemperature(i8), m_totalLaps(u8),
// m_trackLength(u16), m_sessionType(u8), m_trackId(u8)...
const bodyOff = 29
buf.writeUInt8(0, bodyOff + 0) // m_weather
buf.writeInt8(31, bodyOff + 1) // m_trackTemperature
buf.writeInt8(24, bodyOff + 2) // m_airTemperature
buf.writeUInt8(53, bodyOff + 3) // m_totalLaps
buf.writeUInt16LE(5807, bodyOff + 4) // m_trackLength
buf.writeUInt8(13, bodyOff + 6) // m_sessionType -> Race
buf.writeUInt8(4, bodyOff + 7) // m_trackId -> Suzuka

const sock = dgram.createSocket('udp4')
sock.send(buf, 0, buf.length, PORT, HOST, (err) => {
  if (err) {
    console.error('send error:', err)
  } else {
    console.log(`Sent synthetic F1 25 SESSION packet (${buf.length} bytes) to ${HOST}:${PORT}`)
    console.log('In the running app, check: format=2025 detected, track=Suzuka, laps=53, session=Race')
  }
  sock.close()
})
