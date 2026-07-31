import { describe, it, expect } from 'vitest'
import {
  computeGainCorrection,
  computeLufsFromBuffer,
  TARGET_LUFS,
  MAX_GAIN_DB,
  type DecodedAudio,
} from '../../src/renderer/src/audio/LufsAnalyzer'

describe('computeGainCorrection', () => {
  it('returns gain > 1 for quiet tracks (below target)', () => {
    const result = computeGainCorrection(-20)
    expect(result.integratedLufs).toBe(-20)
    // -14 - (-20) = 6 dB boost
    const expectedGain = Math.pow(10, 6 / 20)
    expect(result.gainCorrection).toBeCloseTo(expectedGain, 4)
  })

  it('returns gain < 1 for loud tracks (above target)', () => {
    const result = computeGainCorrection(-10)
    expect(result.integratedLufs).toBe(-10)
    // -14 - (-10) = -4 dB cut
    const expectedGain = Math.pow(10, -4 / 20)
    expect(result.gainCorrection).toBeCloseTo(expectedGain, 4)
  })

  it('returns gain of 1.0 when at target LUFS', () => {
    const result = computeGainCorrection(TARGET_LUFS)
    expect(result.gainCorrection).toBeCloseTo(1.0, 4)
  })

  it('clamps gain to MAX_GAIN_DB for very quiet tracks', () => {
    const result = computeGainCorrection(-40)
    // Without clamping: -14 - (-40) = 26 dB — way too much
    const maxGain = Math.pow(10, MAX_GAIN_DB / 20)
    expect(result.gainCorrection).toBeCloseTo(maxGain, 4)
  })

  it('returns gain 1.0 for silence (-Infinity)', () => {
    const result = computeGainCorrection(-Infinity)
    expect(result.gainCorrection).toBe(1.0)
  })

  it('returns gain 1.0 for near-silence (below -70 LUFS)', () => {
    const result = computeGainCorrection(-75)
    expect(result.gainCorrection).toBe(1.0)
  })

  it('returns gain 1.0 for NaN input', () => {
    const result = computeGainCorrection(NaN)
    expect(result.gainCorrection).toBe(1.0)
  })

  it('handles exactly -70 LUFS (boundary)', () => {
    const result = computeGainCorrection(-70)
    // -70 is <= -70, so treated as silence
    expect(result.gainCorrection).toBe(1.0)
  })

  it('handles just above -70 LUFS', () => {
    const result = computeGainCorrection(-69.9)
    // Should compute a correction (clamped to MAX_GAIN_DB)
    const correctionDb = Math.min(TARGET_LUFS - -69.9, MAX_GAIN_DB)
    const expectedGain = Math.pow(10, correctionDb / 20)
    expect(result.gainCorrection).toBeCloseTo(expectedGain, 4)
  })
})

describe('computeLufsFromBuffer', () => {
  const SR = 48000

  const mono = (samples: Float32Array, sampleRate = SR): DecodedAudio => ({
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    getChannelData: () => samples,
  })

  const sine = (out: Float32Array, from: number, to: number, amp: number): void => {
    for (let i = from; i < to; i++) {
      out[i] = amp * Math.sin((2 * Math.PI * 440 * i) / SR)
    }
  }

  it('analyzes only the first maxSeconds of decoded PCM (ignores the tail)', () => {
    const oneMin = 60 * SR
    // 2 minutes: quiet first minute, much louder second minute.
    const data = new Float32Array(2 * oneMin)
    sine(data, 0, oneMin, 0.05)
    sine(data, oneMin, 2 * oneMin, 0.9)

    // Capping at 60s must match analyzing a buffer that is only the first 60s —
    // i.e. the loud tail is excluded. (Regression guard for the old byte-slice.)
    const capped = computeLufsFromBuffer(mono(data), 60)
    const firstMinuteOnly = computeLufsFromBuffer(mono(data.subarray(0, oneMin)), 60)

    expect(Number.isFinite(capped.gainCorrection)).toBe(true)
    expect(capped.integratedLufs).toBeCloseTo(firstMinuteOnly.integratedLufs, 5)
  })

  it('does not throw and stays finite on a long buffer', () => {
    const twoMin = new Float32Array(2 * 60 * SR)
    sine(twoMin, 0, twoMin.length, 0.2)
    const result = computeLufsFromBuffer(mono(twoMin), 60)
    expect(Number.isFinite(result.gainCorrection)).toBe(true)
    expect(result.gainCorrection).toBeGreaterThan(0)
  })
})
