import { getAudioContext } from './audioContext'
import { localAudioUrl } from '@/lib/localAudioUrl'
import { useAudioStore } from '@/store/audioStore'
import type { SoundboardPlaybackMode, SoundboardSound } from '@/lib/types'
import { randomPlaybackRate } from './playbackVariation'
import { userFacingAudioFailure } from './probeTrack'
import { audioLog, extOf } from './audioLog'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'

const STOP_FADE_SECONDS = 0.03
const LOOP_STOP_FADE_SECONDS = 0.4

export type SoundboardTriggerAction = 'ignore' | 'stop' | 'restart' | 'start'

export function soundboardTriggerAction(
  mode: SoundboardPlaybackMode,
  active: boolean,
  loading: boolean,
): SoundboardTriggerAction {
  if (mode === 'ignore' && (active || loading)) return 'ignore'
  if ((mode === 'stop' || mode === 'loop') && (active || loading)) return 'stop'
  if (mode === 'restart') return 'restart'
  return 'start'
}

export interface SoundboardActivity {
  playing: boolean
  voiceCount: number
  /** Wall-clock timestamp used by the renderer to animate the newest voice. */
  startedAtMs?: number
  durationMs?: number
}

type ActivityListener = (soundId: string, activity: SoundboardActivity) => void

interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
  startedAtMs: number
  durationMs?: number
}

/** Low-latency, polyphonic playback for campaign-wide sound effects. */
export class SoundboardEngine {
  private static instance: SoundboardEngine | null = null
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private volumeUnsub: (() => void) | null = null
  private buffers = new Map<string, AudioBuffer>()
  private decoding = new Map<string, Promise<AudioBuffer>>()
  private voices = new Map<string, Set<Voice>>()
  private generations = new Map<string, number>()
  private pending = new Set<string>()
  private listeners = new Set<ActivityListener>()

  static getInstance(): SoundboardEngine {
    if (!SoundboardEngine.instance) SoundboardEngine.instance = new SoundboardEngine()
    return SoundboardEngine.instance
  }

  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private ensureGraph(): AudioContext {
    const ctx = getAudioContext()
    if (this.ctx !== ctx) {
      this.volumeUnsub?.()
      this.volumeUnsub = null
      this.resetRuntime()
      this.masterGain?.disconnect()
      this.ctx = ctx
      this.buffers.clear()
      this.decoding.clear()
      this.masterGain = ctx.createGain()
      this.masterGain.gain.value = useAudioStore.getState().volume / 100
      this.masterGain.connect(ctx.destination)
      this.volumeUnsub = useAudioStore.subscribe((state, previous) => {
        if (state.volume !== previous.volume && this.masterGain) {
          this.masterGain.gain.setValueAtTime(state.volume / 100, ctx.currentTime)
        }
      })
    }
    return ctx
  }

  private async decode(sound: SoundboardSound): Promise<AudioBuffer> {
    const cached = this.buffers.get(sound.localFilePath)
    if (cached) return cached
    const pending = this.decoding.get(sound.localFilePath)
    if (pending) return pending

    const promise = (async () => {
      const ctx = this.ensureGraph()
      const token = await window.api.registerAudioPath(sound.localFilePath)
      const response = await fetch(localAudioUrl(token))
      if (!response.ok) throw new Error(`Failed to read file (HTTP ${String(response.status)})`)
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer())
      this.buffers.set(sound.localFilePath, buffer)
      return buffer
    })()
    this.decoding.set(sound.localFilePath, promise)
    try {
      return await promise
    } finally {
      this.decoding.delete(sound.localFilePath)
    }
  }

  async trigger(sound: SoundboardSound, fullVolume = false): Promise<void> {
    this.ensureGraph()
    const mode = sound.playbackMode ?? 'restart'
    const active = (this.voices.get(sound.id)?.size ?? 0) > 0
    const loading = this.pending.has(sound.id)
    const action = soundboardTriggerAction(mode, active, loading)

    if (action === 'ignore') return
    if (action === 'stop') {
      this.stop(sound.id, mode === 'loop' ? LOOP_STOP_FADE_SECONDS : STOP_FADE_SECONDS)
      return
    }

    let generation: number | null = null
    if (mode !== 'multiple') {
      generation = (this.generations.get(sound.id) ?? 0) + 1
      this.generations.set(sound.id, generation)
      this.pending.add(sound.id)
    }
    if (action === 'restart') this.stopVoices(sound.id, STOP_FADE_SECONDS)

    let buffer: AudioBuffer
    try {
      buffer = await this.decode(sound)
    } catch (error) {
      if (generation !== null && this.generations.get(sound.id) === generation) {
        this.pending.delete(sound.id)
      }
      const detail = error instanceof Error ? error.message : 'Could not decode audio file'
      const reason = userFacingAudioFailure(detail, true)
      useDiagnosticsStore.getState().setUnplayable(sound.id, { source: 'playback', reason })
      audioLog('soundboard', 'decode-failed', {
        trackId: sound.id,
        title: sound.name,
        localFilePath: sound.localFilePath,
        ext: extOf(sound.localFilePath),
        detail,
      })
      throw new Error(reason)
    }
    if (generation !== null && this.generations.get(sound.id) !== generation) return
    this.pending.delete(sound.id)
    useDiagnosticsStore.getState().clearUnplayable(sound.id)

    const activeCtx = this.ensureGraph()
    const source = activeCtx.createBufferSource()
    const gain = activeCtx.createGain()
    const playbackRate = randomPlaybackRate(sound.pitchVariation)
    const voice: Voice = {
      source,
      gain,
      startedAtMs: Date.now(),
      durationMs: mode === 'loop' ? undefined : (buffer.duration / playbackRate) * 1000,
    }
    source.buffer = buffer
    source.loop = mode === 'loop'
    source.playbackRate.value = playbackRate
    gain.gain.value = (fullVolume ? 100 : sound.volume) / 100
    source.connect(gain)
    gain.connect(this.masterGain!)

    const voices = this.voices.get(sound.id) ?? new Set<Voice>()
    voices.add(voice)
    this.voices.set(sound.id, voices)
    this.emitActivity(sound.id)

    source.addEventListener('ended', () => {
      source.disconnect()
      gain.disconnect()
      const live = this.voices.get(sound.id)
      live?.delete(voice)
      if (!live || live.size === 0) {
        this.voices.delete(sound.id)
      }
      this.emitActivity(sound.id)
    })
    source.start()
  }

  stop(soundId: string, fadeSeconds = STOP_FADE_SECONDS): void {
    this.generations.set(soundId, (this.generations.get(soundId) ?? 0) + 1)
    this.pending.delete(soundId)
    this.stopVoices(soundId, fadeSeconds)
  }

  stopAll(fadeSeconds = STOP_FADE_SECONDS): void {
    const soundIds = new Set([...this.voices.keys(), ...this.pending])
    for (const soundId of soundIds) this.stop(soundId, fadeSeconds)
  }

  dispose(): void {
    this.volumeUnsub?.()
    this.volumeUnsub = null
    this.resetRuntime()
    this.buffers.clear()
    this.decoding.clear()
    this.masterGain?.disconnect()
    this.masterGain = null
    this.ctx = null
  }

  private resetRuntime(): void {
    const soundIds = new Set([...this.voices.keys(), ...this.pending])
    const voices = [...this.voices.values()].flatMap((entries) => [...entries])
    this.voices.clear()
    this.pending.clear()
    this.generations.clear()

    for (const voice of voices) {
      try {
        voice.source.stop()
      } catch {
        // A source owned by a closed AudioContext may already be unusable.
      }
      voice.source.disconnect()
      voice.gain.disconnect()
    }
    for (const soundId of soundIds) this.emitActivity(soundId)
  }

  private stopVoices(soundId: string, fadeSeconds: number): void {
    const voices = this.voices.get(soundId)
    if (!voices || voices.size === 0 || !this.ctx) return
    const now = this.ctx.currentTime
    for (const voice of voices) {
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
      voice.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds)
      voice.source.stop(now + fadeSeconds)
    }
  }

  private emitActivity(soundId: string): void {
    const voices = this.voices.get(soundId)
    if (!voices || voices.size === 0) {
      for (const listener of this.listeners) {
        listener(soundId, { playing: false, voiceCount: 0 })
      }
      return
    }

    const newest = [...voices].reduce((latest, voice) =>
      voice.startedAtMs > latest.startedAtMs ? voice : latest,
    )
    const activity: SoundboardActivity = {
      playing: true,
      voiceCount: voices.size,
      startedAtMs: newest.startedAtMs,
      durationMs: newest.durationMs,
    }
    for (const listener of this.listeners) listener(soundId, activity)
  }
}
