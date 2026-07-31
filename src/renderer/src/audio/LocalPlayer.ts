import type { ITrackPlayer } from './AudioEngine'
import type { Track } from '@/lib/types'

export class LocalPlayer implements ITrackPlayer {
  private audio: HTMLAudioElement
  private mediaSource: MediaElementAudioSourceNode | null = null
  private endedCallback: (() => void) | null = null
  private errorCallback: ((error: Error) => void) | null = null
  private disposed = false

  constructor(private audioContext: AudioContext) {
    this.audio = new Audio()

    this.audio.addEventListener('ended', () => {
      if (!this.disposed) this.endedCallback?.()
    })

    this.audio.addEventListener('error', () => {
      if (this.disposed) return
      const code = this.audio.error?.code
      const message = this.audio.error?.message ?? 'Unknown playback error'
      this.errorCallback?.(new Error(`Audio error (code ${code}): ${message}`))
    })
  }

  async load(track: Track): Promise<void> {
    if (!track.localFilePath) {
      throw new Error(`Track "${track.title}" has no local file path`)
    }

    const token = await window.api.registerAudioPath(track.localFilePath)
    this.audio.src = `local-audio:///${token}`

    if (!this.mediaSource) {
      this.mediaSource = this.audioContext.createMediaElementSource(this.audio)
    }

    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanup()
        resolve()
      }
      const onError = (): void => {
        cleanup()
        const code = this.audio.error?.code
        const message = this.audio.error?.message ?? 'Failed to load audio file'
        reject(new Error(`Audio error (code ${code}): ${message}`))
      }
      const cleanup = (): void => {
        this.audio.removeEventListener('canplaythrough', onReady)
        this.audio.removeEventListener('error', onError)
      }

      this.audio.addEventListener('canplaythrough', onReady, { once: true })
      this.audio.addEventListener('error', onError, { once: true })
      this.audio.load()
    })
  }

  play(): void {
    this.audio.play()
  }

  pause(): void {
    this.audio.pause()
  }

  stop(): void {
    this.audio.pause()
    this.audio.currentTime = 0
  }

  getDuration(): number | undefined {
    const dur = this.audio.duration
    return Number.isFinite(dur) ? dur : undefined
  }

  getCurrentTime(): number {
    return this.audio.currentTime
  }

  seekTo(timeSec: number): void {
    this.audio.currentTime = timeSec
  }

  hasEnded(): boolean {
    return this.audio.ended
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setVolume(_volume: number): void {
    // Volume controlled via GainNode
  }

  getMediaSource(): MediaElementAudioSourceNode | null {
    return this.mediaSource
  }

  onEnded(callback: () => void): void {
    this.endedCallback = callback
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback
  }

  dispose(): void {
    this.disposed = true
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.mediaSource?.disconnect()
    this.mediaSource = null
    this.endedCallback = null
    this.errorCallback = null
  }
}
