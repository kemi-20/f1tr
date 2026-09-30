// Result payload budget; the bridge/plugin retain room for their JSON envelopes.
export const MAX_TOOL_RESULT_BYTES = 53_000

export function toolResultFits(result: string): boolean {
  return Buffer.byteLength(result, 'utf8') <= MAX_TOOL_RESULT_BYTES
}
