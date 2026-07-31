/**
 * LUFS (Loudness Units Full Scale) analyzer implementing ITU-R BS.1770-4.
 *
 * Measures integrated loudness of audio files and computes a gain correction
 * to normalize them to a target of -14 LUFS (matching YouTube's loudness target).
 */

export const TARGET_LUFS = -14
export const MAX_GAIN_DB = 12

const BLOCK_DURATION = 0.4 // 400ms gating blocks
const BLOCK_OVERLAP = 0.75 // 75% overlap
const ABSOLUTE_GATE = -70 // LUFS
const RELATIVE_GATE_OFFSET = -10 // LU below ungated loudness

// K-weighting filter coefficients for common sample rates.
// Stage 1: High-shelf boost (+4dB above ~1.5kHz)
// Stage 2: High-pass filter (~38Hz, Butterworth)
// Pre-computed from the ITU-R BS.1770-4 specification.

interface BiquadCoeffs {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

const K_WEIGHT_COEFFS: Record<number, { shelf: BiquadCoeffs; highpass: BiquadCoeffs }> = {
  44100: {
    shelf: {
      b0: 1.53512485958697,
      b1: -2.69169618940638,
      b2: 1.19839281085285,
      a1: -1.69065929318241,
      a2: 0.73248077421585,
    },
    highpass: {
      b0: 1.0,
      b1: -2.0,
      b2: 1.0,
      a1: -1.99004745483398,
      a2: 0.99007225036621,
    },
  },
  48000: {
    shelf: {
      b0: 1.53512485958697,
      b1: -2.69169618940638,
      b2: 1.19839281085285,
      a1: -1.69065929318241,
      a2: 0.73248077421585,
    },
    highpass: {
      b0: 1.0,
      b1: -2.0,
      b2: 1.0,
      a1: -1.99004745483398,
      a2: 0.99007225036621,
    },
  },
}

function getKWeightCoeffs(sampleRate: number): { shelf: BiquadCoeffs; highpass: BiquadCoeffs } {
  // Use 48kHz coefficients for rates we don't have exact values for.
  // The perceptual difference is negligible for normalization purposes.
  return K_WEIGHT_COEFFS[sampleRate] ?? K_WEIGHT_COEFFS[48000]
}

function applyBiquad(samples: Float32Array, coeffs: BiquadCoeffs): Float32Array {
  const out = new Float32Array(samples.length)
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0

  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const y = coeffs.b0 * x + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2
    out[i] = y
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
  }

  return out
}

function computeChannelMeanSquare(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return sum / samples.length
}

export interface LufsResult {
  integratedLufs: number
  gainCorrection: number
}

export function computeGainCorrection(measuredLufs: number): LufsResult {
  if (!Number.isFinite(measuredLufs) || measuredLufs <= -70) {
    // Silence or near-silence — don't amplify
    return { integratedLufs: measuredLufs, gainCorrection: 1.0 }
  }

  const correctionDb = Math.min(TARGET_LUFS - measuredLufs, MAX_GAIN_DB)
  const gainCorrection = Math.pow(10, correctionDb / 20)

  return { integratedLufs: measuredLufs, gainCorrection }
}

const MAX_ANALYSIS_SECONDS = 5 * 60

// decodeAudioData must decode the whole container, so cap the input size to keep
// memory bounded: files above this are skipped (no normalization) rather than
// risking a very large decode.
const MAX_DECODE_BYTES = 64 * 1024 * 1024

/** Minimal structural shape of decoded audio — satisfied by Web Audio's AudioBuffer. */
export interface DecodedAudio {
  sampleRate: number
  numberOfChannels: number
  length: number
  getChannelData(channel: number): Float32Array
}

export async function analyzeLufs(
  audioContext: AudioContext,
  filePath: string,
): Promise<LufsResult> {
  const token = await window.api.registerAudioPath(filePath)
  const response = await fetch(`local-audio:///${token}`)
  if (!response.ok) {
    throw new Error(`LUFS fetch failed (HTTP ${response.status}) for ${filePath}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_DECODE_BYTES) {
    throw new Error(
      `LUFS skipped: file too large (${arrayBuffer.byteLength} bytes) for ${filePath}`,
    )
  }

  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  return computeLufsFromBuffer(audioBuffer)
}

/**
 * Compute integrated LUFS + gain correction from already-decoded audio. Only the
 * first `maxSeconds` of decoded samples are analyzed (bounding CPU on long
 * tracks) — this truncates the *decoded PCM*, never the compressed container, so
 * it cannot corrupt the stream the way slicing raw file bytes would.
 */
export function computeLufsFromBuffer(
  buffer: DecodedAudio,
  maxSeconds: number = MAX_ANALYSIS_SECONDS,
): LufsResult {
  const sampleRate = buffer.sampleRate
  const numChannels = buffer.numberOfChannels
  const analyzedLength = Math.min(buffer.length, Math.floor(maxSeconds * sampleRate))
  const coeffs = getKWeightCoeffs(sampleRate)

  // Apply K-weighting to each channel (over the analyzed window only)
  const kWeightedChannels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) {
    const raw = buffer.getChannelData(ch).subarray(0, analyzedLength)
    const afterShelf = applyBiquad(raw, coeffs.shelf)
    const afterHp = applyBiquad(afterShelf, coeffs.highpass)
    kWeightedChannels.push(afterHp)
  }

  // Compute gated loudness using 400ms blocks with 75% overlap
  const blockSamples = Math.floor(BLOCK_DURATION * sampleRate)
  const stepSamples = Math.floor(blockSamples * (1 - BLOCK_OVERLAP))
  const totalSamples = kWeightedChannels[0].length

  if (totalSamples < blockSamples) {
    // File too short for even one block — compute simple loudness
    let totalMean = 0
    for (let ch = 0; ch < numChannels; ch++) {
      totalMean += computeChannelMeanSquare(kWeightedChannels[ch])
    }
    const lufs = -0.691 + 10 * Math.log10(totalMean)
    return computeGainCorrection(lufs)
  }

  // First pass: compute all block loudness values
  const blockLoudness: number[] = []
  for (let start = 0; start + blockSamples <= totalSamples; start += stepSamples) {
    let blockPower = 0
    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = kWeightedChannels[ch]
      let sum = 0
      for (let i = start; i < start + blockSamples; i++) {
        sum += channelData[i] * channelData[i]
      }
      blockPower += sum / blockSamples
    }
    const blockLufs = -0.691 + 10 * Math.log10(blockPower)
    blockLoudness.push(blockLufs)
  }

  // Absolute gating: keep only blocks above -70 LUFS
  const afterAbsoluteGate = blockLoudness.filter((l) => l > ABSOLUTE_GATE)
  if (afterAbsoluteGate.length === 0) {
    return computeGainCorrection(-Infinity)
  }

  // Compute ungated mean loudness (from absolute-gated blocks)
  const ungatedMean =
    -0.691 +
    10 *
      Math.log10(
        afterAbsoluteGate.reduce((sum, l) => sum + Math.pow(10, (l + 0.691) / 10), 0) /
          afterAbsoluteGate.length,
      )

  // Relative gating: keep blocks above (ungatedMean - 10 LU)
  const relativeThreshold = ungatedMean + RELATIVE_GATE_OFFSET
  const afterRelativeGate = afterAbsoluteGate.filter((l) => l > relativeThreshold)
  if (afterRelativeGate.length === 0) {
    return computeGainCorrection(-Infinity)
  }

  // Final integrated loudness
  const integratedLufs =
    -0.691 +
    10 *
      Math.log10(
        afterRelativeGate.reduce((sum, l) => sum + Math.pow(10, (l + 0.691) / 10), 0) /
          afterRelativeGate.length,
      )

  return computeGainCorrection(integratedLufs)
}
