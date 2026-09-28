import { describe, expect, it } from 'vitest'
import { safeToolError } from './ToolError'

describe('safeToolError', () => {
  it('preserves the actionable failure reason', () => {
    expect(safeToolError(new Error('Web search provider returned HTTP 429'), []))
      .toBe('Web search provider returned HTTP 429')
  })

  it('redacts host credentials and removes control characters', () => {
    const result = safeToolError(new Error('Key secret-key\nToken bridge-token'), ['secret-key', 'bridge-token'])
    expect(result).toBe('Key [redacted] Token [redacted]')
    expect(result).not.toContain('secret-key')
    expect(result).not.toContain('bridge-token')
  })

  it('bounds untrusted errors and handles an empty message', () => {
    expect(safeToolError('x'.repeat(300), []).length).toBe(200)
    expect(Buffer.byteLength(safeToolError('错'.repeat(300), []), 'utf8')).toBeLessThanOrEqual(500)
    expect(safeToolError(new Error(''), [])).toBe('Unknown tool error')
  })
})
