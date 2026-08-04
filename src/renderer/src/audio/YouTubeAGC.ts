/**
 * Automatic Gain Control for YouTube tracks via audio loopback.
 *
 * YouTube audio lives in a cross-origin iframe, so we can't route it through
 * Web Audio nodes. Instead we capture the window's audio output as a MediaStream
 * (using Electron's setDisplayMediaRequestHandler with audio: 'loopback'),
 * monitor its RMS level, and adjust the YouTube player's volume to compensate
 * for overly loud passages.
 *
 * The AGC only attenuates (max gain = 1.0) since YouTube already normalizes to
 * roughly -14 LUFS. We just tame dynamic peaks.
 *
 * NOTE: This feature is Windows-only, because Electron supports
 * `audio: 'loopback'` only there. Elsewhere the capture returns a video-only
 * stream, so the AGC gets no audio to measure and gives up — but not before the
 * OS has prompted for screen recording:
 *
 * - macOS shows "Ambora is requesting to bypass the system private window picker
 *   and directly access your screen and audio", an alarming prompt for a
 *   capability the app then cannot use.
 * - Linux routes getDisplayMedia() through the xdg-desktop-portal ScreenCast
 *   interface, which on Wayland re-prompts on every stream (re)acquisition, i.e.
 *   every track switch (issue #3).
 *
 * Audio plays fine without the AGC — YouTube already normalizes to roughly
 * -14 LUFS, and this only tames peaks — so rather than ask for screen recording
 * on platforms that cannot deliver the audio, we skip it entirely.
 */

const TARGET_RMS = 0.08 // Approximate RMS corresponding to -14 LUFS
const MIN_GAIN = 0.3 // Max 70% attenuation
const MAX_GAIN = 1.0 // No amplification
const ATTACK_COEFF = 0.05 // Fast attack for peaks (~10ms effective)
const RELEASE_COEFF = 0.002 // Slow release (~500ms effective)
const SILENCE_THRESHOLD = 0.001 // Below this RMS, don't adjust

// Electron's `audio: 'loopback'` is Windows-only. Everywhere else the capture
// yields no audio track, so the AGC can't work — and asking for screen recording
// to achieve nothing is the worst of both worlds.
const AGC_SUPPORTED = window.api.platform === 'win32'

export class YouTubeAGC {
  private stream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private rafId: number | null = null
  private currentGain = 1.0
  private onGainChange: ((gain: number) => void) | null = null
  private getVolume01: (() => number) | null = null
  private active = false

  async start(
    audioContext: AudioContext,
    onGainChange: (gain: number) => void,
    getVolume01: () => number,
  ): Promise<void> {
    if (this.active) return
    if (!AGC_SUPPORTED) return

    this.onGainChange = onGainChange
    this.getVolume01 = getVolume01
    this.currentGain = 1.0

    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      })

      // Discard video tracks — we only need audio
      for (const vt of this.stream.getVideoTracks()) {
        vt.stop()
        this.stream.removeTrack(vt)
      }

      if (this.stream.getAudioTracks().length === 0) {
        this.cleanup()
        return
      }

      this.sourceNode = audioContext.createMediaStreamSource(this.stream)
      this.analyser = audioContext.createAnalyser()
      this.analyser.fftSize = 2048

      // Connect to analyser only — NOT to destination (no double audio)
      this.sourceNode.connect(this.analyser)

      this.active = true
      this.tick()
    } catch {
      this.cleanup()
    }
  }

  stop(): void {
    if (!this.active) return
    this.active = false

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    this.cleanup()

    // Restore gain to 1.0
    this.currentGain = 1.0
    this.onGainChange?.(1.0)
    this.onGainChange = null
    this.getVolume01 = null
  }

  isActive(): boolean {
    return this.active
  }

  getCurrentGain(): number {
    return this.currentGain
  }

  private tick = (): void => {
    if (!this.active || !this.analyser || !this.getVolume01) return

    const buffer = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(buffer)

    // Compute RMS of captured audio
    let sum = 0
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i]
    }
    const measuredRms = Math.sqrt(sum / buffer.length)

    const currentVolume = this.getVolume01()
    if (currentVolume > 0 && measuredRms > SILENCE_THRESHOLD) {
      // Compensate for our own volume setting to estimate natural loudness
      const naturalRms = measuredRms / currentVolume
      const ratio = TARGET_RMS / naturalRms

      // Determine target gain (clamped)
      const targetGain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, ratio))

      // Smooth with asymmetric attack/release
      const coeff = targetGain < this.currentGain ? ATTACK_COEFF : RELEASE_COEFF
      this.currentGain += (targetGain - this.currentGain) * coeff

      this.onGainChange?.(this.currentGain)
    }

    this.rafId = requestAnimationFrame(this.tick)
  }

  private cleanup(): void {
    // Stop media tracks BEFORE disconnecting Web Audio nodes.
    // Disconnecting the sourceNode first causes macOS to tear down the
    // loopback stream internally, and the subsequent track.stop() then
    // tries to stop an already-stopped stream, triggering an OS-level error.
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        if (track.readyState === 'live') {
          track.stop()
        }
      }
      this.stream = null
    }

    this.sourceNode?.disconnect()
    this.sourceNode = null
    this.analyser?.disconnect()
    this.analyser = null
  }

  dispose(): void {
    this.stop()
  }
}
