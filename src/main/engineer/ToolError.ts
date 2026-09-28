/** Keep tool failures actionable without passing host credentials or control text to DSH. */
export function safeToolError(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : String(error)
  const redacted = [...secrets].sort((a, b) => b.length - a.length).reduce(
    (value, secret) => secret ? value.split(secret).join('[redacted]') : value,
    message
  )
  const clean = redacted.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  let output = ''
  for (const char of clean) {
    if (output.length + char.length > 200 || Buffer.byteLength(output + char, 'utf8') > 500) break
    output += char
  }
  return output || 'Unknown tool error'
}
