/**
 * Minimal SSE line-parser for the MiMo TTS streaming response.
 * Each `data: {...}\n` line carries a base64 PCM16 chunk in choices[0].delta.audio.data.
 * Terminated by `data: [DONE]`.
 */
export class SseParser {
  private buffer = ''
  private decoder = new TextDecoder()

  /** Feed raw bytes; invoke onData(base64Chunk) for each audio chunk, onDone() at [DONE]. */
  feed(
    chunk: Uint8Array | string,
    onData: (base64Pcm16: string) => void,
    onDone: () => void
  ): void {
    // Reuse one TextDecoder so multi-byte UTF-8 split across chunks is handled correctly.
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (!line || line.startsWith(':')) continue // SSE comment / heartbeat
      if (!line.startsWith('data:')) continue
      const payload = line.slice(line.indexOf(':') + 1).trim()
      if (payload === '[DONE]') {
        onDone()
        return
      }
      try {
        const json = JSON.parse(payload)
        const b64 = json?.choices?.[0]?.delta?.audio?.data
        if (typeof b64 === 'string' && b64.length > 0) onData(b64)
      } catch {
        // partial JSON mid-chunk — ignore; will be completed in a later feed
      }
    }
  }

  reset(): void {
    this.buffer = ''
  }
}
