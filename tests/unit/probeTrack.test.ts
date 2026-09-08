import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  probeLocalTrack,
  probeSoundboardTrack,
  resultForOutcome,
  userFacingAudioFailure,
} from '../../src/renderer/src/audio/probeTrack'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('userFacingAudioFailure', () => {
  it('replaces raw missing-file transport errors with an actionable message', () => {
    expect(userFacingAudioFailure('Failed to read file (HTTP 404)', true)).toBe(
      'Audio file is missing — locate it to play',
    )
    expect(userFacingAudioFailure('/music/rain.wav: No such file or directory', true)).toBe(
      'Audio file is missing — locate it to play',
    )
  })

  it('does not name a relink flow the caller cannot offer', () => {
    // Ambient clips have no locate affordance, so the instruction would be a
    // dead end. The diagnosis stays; only the remedy is dropped. See #45.
    expect(userFacingAudioFailure('Failed to read file (HTTP 404)', false)).toBe(
      'Audio file is missing',
    )
    expect(userFacingAudioFailure(undefined, false)).toBe('Audio file could not be read')
    expect(userFacingAudioFailure(undefined, true)).toBe(
      'Audio file could not be read — locate or replace it to play',
    )
  })

  it('keeps a permissions failure identical either way, since relinking will not fix it', () => {
    const expected = 'Audio file cannot be accessed — check the drive or file permissions'
    expect(userFacingAudioFailure('permission denied', true)).toBe(expected)
    expect(userFacingAudioFailure('permission denied', false)).toBe(expected)
  })

  it('keeps useful codec diagnostics intact', () => {
    expect(userFacingAudioFailure('Unsupported audio codec: ac4', true)).toBe(
      'Unsupported audio codec: ac4',
    )
  })

  it('does not misreport an ffmpeg spawn failure as a missing audio file', () => {
    const reason = 'Could not probe audio file: spawn /app/ffmpeg ENOENT'
    expect(userFacingAudioFailure(reason, true)).toBe(reason)
  })

  it('does not treat a generic not-found diagnostic as a missing audio file', () => {
    const reason = 'ffmpeg binary not found (tried: /app/ffmpeg)'
    expect(userFacingAudioFailure(reason, true)).toBe(reason)
  })
})

describe('audio probe consumers', () => {
  it('preserves raw probe details for climate and ambient consumers', async () => {
    vi.stubGlobal('window', {
      api: {
        probeAudioFile: vi
          .fn()
          .mockResolvedValue({ ok: false, reason: '/music/rain.wav: No such file or directory' }),
      },
    })

    await expect(probeLocalTrack('/music/rain.wav')).resolves.toEqual({
      ok: false,
      reason: '/music/rain.wav: No such file or directory',
    })
  })

  it('maps raw probe details to actionable soundboard copy', async () => {
    vi.stubGlobal('window', {
      api: {
        probeAudioFile: vi
          .fn()
          .mockResolvedValue({ ok: false, reason: '/music/rain.wav: No such file or directory' }),
      },
    })

    await expect(probeSoundboardTrack('/music/rain.wav')).resolves.toEqual({
      ok: false,
      reason: 'Audio file is missing — locate it to play',
    })
  })
})
