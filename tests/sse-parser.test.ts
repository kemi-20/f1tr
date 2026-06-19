import { describe, it, expect } from 'vitest'
import { SseParser } from '../src/main/tts/SseParser'

describe('SseParser', () => {
  it('extracts base64 audio chunks from SSE data lines', () => {
    const parser = new SseParser()
    const chunks: string[] = []
    let done = false
    parser.feed(
      'data: {"choices":[{"delta":{"audio":{"data":"AAAA"}}}]}\n' +
        'data: {"choices":[{"delta":{"audio":{"data":"BBBB"}}}]}\n' +
        'data: {"choices":[{"delta":{"audio":{"data":"CCCC"}}}]}\n' +
        'data: [DONE]\n',
      (c) => chunks.push(c),
      () => {
        done = true
      }
    )
    expect(chunks).toEqual(['AAAA', 'BBBB', 'CCCC'])
    expect(done).toBe(true)
  })

  it('handles chunks split across feeds (partial JSON)', () => {
    const parser = new SseParser()
    const chunks: string[] = []
    let done = false
    const onChunk = (c: string) => {
      chunks.push(c)
    }
    const onDone = () => {
      done = true
    }
    // split mid-JSON: balanced braces total to {"choices":[{"delta":{"audio":{"data":"XYZ"}}}]}
    parser.feed('data: {"choices":[{"delta":{"audio":{"data":"XYZ"', onChunk, onDone)
    parser.feed('}}}]}\ndata: [DONE]\n', onChunk, onDone)
    expect(chunks).toEqual(['XYZ'])
    expect(done).toBe(true)
  })

  it('ignores comment lines and non-audio payloads', () => {
    const parser = new SseParser()
    const chunks: string[] = []
    parser.feed(
      ': heartbeat\n' +
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n' +
        'data: {"choices":[{"delta":{"audio":{"data":"AUDIO1"}}}]}\n',
      (c) => chunks.push(c),
      () => {}
    )
    expect(chunks).toEqual(['AUDIO1'])
  })
})
