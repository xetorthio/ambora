import { describe, it, expect } from 'vitest'
import { resultForOutcome } from '../../src/renderer/src/audio/probeTrack'

describe('resultForOutcome', () => {
  it('maps loadedmetadata to ok', () => {
    expect(resultForOutcome('loadedmetadata')).toEqual({ ok: true })
  })

  it('treats a timeout as inconclusive (ok, no false flag)', () => {
    expect(resultForOutcome('timeout')).toEqual({ ok: true })
  })

  it('maps an error with a message to not-ok + that reason', () => {
    const r = resultForOutcome('error', { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('DEMUXER_ERROR_COULD_NOT_OPEN')
  })

  it('falls back to a code-based reason when the message is empty', () => {
    const r = resultForOutcome('error', { code: 4, message: '' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Audio error (code 4)')
  })

  it('handles a null error', () => {
    const r = resultForOutcome('error', null)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Audio error (code ?)')
  })
})
