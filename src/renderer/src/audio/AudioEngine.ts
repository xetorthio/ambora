import { toast } from 'sonner'
import { CrossfadeManager } from './CrossfadeManager'
import { LocalPlayer } from './LocalPlayer'
import { YouTubePlayer, removeOrphanedYouTubeContainers } from './YouTubePlayer'
import {
  GainNodeVolumeController,
  DirectVolumeController,
  type VolumeController,
} from './VolumeController'
import { LufsCache } from './LufsCache'
import { analyzeLufs, computeGainCorrection } from './LufsAnalyzer'
import { NormalizationChain } from './NormalizationChain'
import { YouTubeAGC } from './YouTubeAGC'
import { ShuffleBag, nextSequentialIndex } from './trackSelection'
import { audioLog, extOf } from './audioLog'
import { useAudioStore } from '@/store/audioStore'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import type { Climate, Track } from '@/lib/types'

export interface NormalizationInfo {
  type: 'lufs' | 'agc' | 'none'
  gainDb: number
  compressorReductionDb: number
  analyser: AnalyserNode | null
}

export interface ITrackPlayer {
  load(track: Track): Promise<void>
  play(): void
  pause(): void
  stop(): void
  setVolume(volume: number): void
  getDuration(): number | undefined
  getCurrentTime(): number
  seekTo(timeSec: number): void
  hasEnded(): boolean
  getMediaSource(): MediaElementAudioSourceNode | null
  onEnded(callback: () => void): void
  onError(callback: (error: Error) => void): void
  dispose(): void
}

type ChannelId = 'A' | 'B'
type ChannelState = 'inactive' | 'loading' | 'active' | 'fading-out'
type EngineState = 'idle' | 'playing' | 'crossfading' | 'fading-to-silence'

interface Channel {
  id: ChannelId
  gainNode: GainNode
  player: ITrackPlayer | null
  volumeController: VolumeController | null
  state: ChannelState
}

interface ClimatePlaybackSnapshot {
  trackIndex: number
  positionSec: number
  trackFingerprint: string
}

const FADE_IN_DURATION = 1
const FADE_TO_SILENCE_DURATION = 3
const TRACK_CROSSFADE_DURATION = 2
// Extra lead time (on top of the crossfade length) for loading the next track so
// it is ready to overlap the outgoing one instead of starting from silence.
const NEAR_END_PRELOAD_MARGIN = 1
// How often to poll the active track's position to detect the near-end window.
const POSITION_POLL_MS = 250

// Run a low-priority callback when the browser is idle, bounded by a timeout so
// it still runs promptly under sustained load. Falls back to a short timeout.
function scheduleIdle(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => cb(), { timeout: 2000 })
  } else {
    setTimeout(cb, 200)
  }
}

export class AudioEngine {
  private static instance: AudioEngine | null = null

  private audioContext: AudioContext | null = null
  private channelA: Channel | null = null
  private channelB: Channel | null = null
  private activeChannelId: ChannelId = 'A'
  private crossfadeManager: CrossfadeManager
  private engineState: EngineState = 'idle'

  private currentClimate: Climate | null = null
  private currentTrackIndex = 0
  private pendingActiveChannelId: ChannelId | null = null
  private activationSeq = 0
  private isActivationLoading = false

  private volumeUnsub: (() => void) | null = null
  private onDurationAvailable: ((trackId: string, duration: number) => void) | null = null
  private climateSnapshots = new Map<string, ClimatePlaybackSnapshot>()
  private lufsCache = new LufsCache()
  private channelNormChains = new Map<ChannelId, NormalizationChain>()
  private youtubeAGC = new YouTubeAGC()
  private positionInterval: ReturnType<typeof setInterval> | null = null
  private autoAdvancing = false
  // Tracks that failed to load/play this climate session, so selection skips them
  // instead of repeatedly landing on them. Cleared on (re)activation and goIdle.
  private failedTrackIds = new Set<string>()
  private shuffleBag = new ShuffleBag()

  private constructor() {
    this.crossfadeManager = new CrossfadeManager()
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine()
    }
    return AudioEngine.instance
  }

  setOnDurationAvailable(callback: (trackId: string, duration: number) => void): void {
    this.onDurationAvailable = callback
  }

  private reportDuration(track: Track, player: ITrackPlayer): void {
    if (track.duration !== undefined) return

    const tryReport = (): void => {
      const dur = player.getDuration()
      if (dur !== undefined && dur > 0) {
        this.onDurationAvailable?.(track.id, dur)
      }
    }

    // Try immediately (works for local files)
    tryReport()

    // Retry for YouTube where getDuration() may return 0 until playback starts
    if (track.source === 'youtube') {
      setTimeout(tryReport, 1000)
      setTimeout(tryReport, 3000)
    }
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()

      const gainA = this.audioContext.createGain()
      gainA.gain.value = 0
      gainA.connect(this.audioContext.destination)
      this.channelA = {
        id: 'A',
        gainNode: gainA,
        player: null,
        volumeController: null,
        state: 'inactive',
      }

      const gainB = this.audioContext.createGain()
      gainB.gain.value = 0
      gainB.connect(this.audioContext.destination)
      this.channelB = {
        id: 'B',
        gainNode: gainB,
        player: null,
        volumeController: null,
        state: 'inactive',
      }

      this.subscribeToVolumeChanges()
      this.lufsCache.loadFromDisk()
      this.startPositionMonitor()
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }

    return this.audioContext
  }

  private getChannel(id: ChannelId): Channel {
    return id === 'A' ? this.channelA! : this.channelB!
  }

  private getActiveChannel(): Channel {
    return this.getChannel(this.activeChannelId)
  }

  private getInactiveChannelId(): ChannelId {
    return this.activeChannelId === 'A' ? 'B' : 'A'
  }

  private getVolume01(): number {
    return useAudioStore.getState().volume / 100
  }

  private updateStore(
    updates: Partial<{
      isPlaying: boolean
      activeClimateId: string | null
      activeTrackId: string | null
      isFadingToSilence: boolean
    }>,
  ): void {
    const store = useAudioStore.getState()
    if (updates.isPlaying !== undefined) store.setIsPlaying(updates.isPlaying)
    if (updates.activeClimateId !== undefined) store.setActiveClimateId(updates.activeClimateId)
    if (updates.activeTrackId !== undefined) store.setActiveTrackId(updates.activeTrackId)
    if (updates.isFadingToSilence !== undefined)
      store.setIsFadingToSilence(updates.isFadingToSilence)
  }

  private subscribeToVolumeChanges(): void {
    this.volumeUnsub = useAudioStore.subscribe((state, prev) => {
      if (state.volume !== prev.volume && this.engineState === 'playing') {
        const channel = this.getActiveChannel()
        if (channel.volumeController) {
          this.crossfadeManager.setImmediate(channel.volumeController, state.volume / 100)
        }
      }
    })
  }

  private createPlayer(track: Track): ITrackPlayer {
    if (track.source === 'youtube') {
      return new YouTubePlayer()
    }
    return new LocalPlayer(this.ensureContext())
  }

  private createVolumeController(player: ITrackPlayer, gainNode: GainNode): VolumeController {
    if (player.getMediaSource() !== null) {
      // Local file — volume through GainNode
      return new GainNodeVolumeController(gainNode)
    }
    // YouTube — volume through player.setVolume() via RAF
    return new DirectVolumeController(player)
  }

  private connectPlayer(player: ITrackPlayer, channel: Channel): void {
    const source = player.getMediaSource()
    if (source) {
      const ctx = this.audioContext!
      const chain = new NormalizationChain(ctx)
      source.connect(chain.input)
      chain.output.connect(channel.gainNode)
      this.channelNormChains.set(channel.id, chain)
    }
  }

  private disposeChannel(channel: Channel): void {
    if (channel.volumeController) {
      if (channel.volumeController instanceof DirectVolumeController) {
        channel.volumeController.dispose()
      }
      channel.volumeController = null
    }
    const normChain = this.channelNormChains.get(channel.id)
    if (normChain) {
      normChain.dispose()
      this.channelNormChains.delete(channel.id)
    }
    if (channel.player) {
      channel.player.stop()
      channel.player.dispose()
      channel.player = null
    }
    channel.state = 'inactive'
    // Reset the GainNode to 0 for local file routing
    const now = channel.gainNode.context.currentTime
    channel.gainNode.gain.cancelScheduledValues(now)
    channel.gainNode.gain.setValueAtTime(0, now)
  }

  private sortedTracks(climate: Climate): Track[] {
    return [...climate.tracks].sort((a, b) => a.order - b.order)
  }

  private getNextTrackIndex(): number {
    if (!this.currentClimate || this.currentClimate.tracks.length === 0) return 0
    const sorted = this.sortedTracks(this.currentClimate)
    const ids = sorted.map((t) => t.id)

    if (!useAudioStore.getState().isShuffled || sorted.length <= 1) {
      return nextSequentialIndex(this.currentTrackIndex, ids, this.failedTrackIds)
    }

    return this.shuffleBag.next(
      ids,
      this.failedTrackIds,
      this.currentTrackIndex,
      this.getTrackFingerprint(this.currentClimate),
    )
  }

  private getTrackFingerprint(climate: Climate): string {
    return [...climate.tracks]
      .map((t) => t.id)
      .sort()
      .join(',')
  }

  private saveClimateSnapshot(): void {
    if (!this.currentClimate) return
    const channel = this.getActiveChannel()
    if (!channel.player) return

    this.climateSnapshots.set(this.currentClimate.id, {
      trackIndex: this.currentTrackIndex,
      positionSec: channel.player.getCurrentTime(),
      trackFingerprint: this.getTrackFingerprint(this.currentClimate),
    })
  }

  private getClimateSnapshot(climate: Climate): ClimatePlaybackSnapshot | null {
    const snapshot = this.climateSnapshots.get(climate.id)
    if (!snapshot) return null
    if (snapshot.trackFingerprint !== this.getTrackFingerprint(climate)) {
      this.climateSnapshots.delete(climate.id)
      return null
    }
    return snapshot
  }

  private async loadAndPlayOnChannel(
    channel: Channel,
    track: Track,
    seekToSec?: number,
    loadSeq?: number,
  ): Promise<boolean> {
    if (channel.player) {
      if (channel.volumeController instanceof DirectVolumeController) {
        channel.volumeController.dispose()
      }
      channel.volumeController = null
      channel.player.stop()
      channel.player.dispose()
      channel.player = null
    }

    channel.state = 'loading'
    const player = this.createPlayer(track)
    channel.player = player

    try {
      await player.load(track)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load track'
      // Suppress the toast when a newer activation superseded this load (e.g. the
      // user skipped tracks rapidly) — the aborted load is expected, not a failure.
      const superseded = loadSeq !== undefined && this.activationSeq !== loadSeq
      if (!superseded) {
        toast.error(`Skipping "${track.title}": ${message}`)
        // Remember genuine failures so selection skips this track for the rest of
        // the session instead of repeatedly landing on it.
        this.failedTrackIds.add(track.id)
        // Surface it in the UI (persists past the engine's per-session reset).
        useDiagnosticsStore.getState().setUnplayable(track.id, {
          source: 'playback',
          reason: message,
        })
      }
      audioLog('playback', 'load-failed', {
        trackId: track.id,
        title: track.title,
        trackSource: track.source,
        localFilePath: track.localFilePath,
        ext: extOf(track.localFilePath),
        outcome: superseded ? 'superseded' : 'skipped',
        detail: message,
      })
      player.dispose()
      channel.player = null
      channel.state = 'inactive'
      return false
    }

    this.connectPlayer(player, channel)

    const controller = this.createVolumeController(player, channel.gainNode)
    channel.volumeController = controller

    // Ensure volume starts at 0 before play — the crossfade will ramp it up.
    // For YouTube this prevents a burst at 100% before the first RAF tick.
    controller.setImmediate(0)

    player.play()
    if (seekToSec && seekToSec > 0) {
      player.seekTo(seekToSec)
    }

    player.onEnded(() => this.handleTrackEnded())
    player.onError((err) => {
      toast.error(`Playback error: ${err.message}`)
      // A track that errors mid-playback is treated as ended; remember it so we
      // don't crossfade straight back into the same broken track.
      this.failedTrackIds.add(track.id)
      useDiagnosticsStore.getState().setUnplayable(track.id, {
        source: 'playback',
        reason: err.message,
      })
      audioLog('playback', 'runtime-error', {
        trackId: track.id,
        title: track.title,
        trackSource: track.source,
        localFilePath: track.localFilePath,
        ext: extOf(track.localFilePath),
        detail: err.message,
      })
      this.handleTrackEnded()
    })

    this.reportDuration(track, player)

    // Apply LUFS normalization for local files
    if (track.source === 'local' && track.localFilePath) {
      this.applyNormalization(channel, player, track.localFilePath)
    }

    return true
  }

  private applyNormalization(channel: Channel, player: ITrackPlayer, filePath: string): void {
    const chain = this.channelNormChains.get(channel.id)
    if (!chain) return

    const cachedLufs = this.lufsCache.get(filePath)
    if (cachedLufs !== undefined) {
      const { gainCorrection } = computeGainCorrection(cachedLufs)
      chain.setNormalizationGain(gainCorrection)
      return
    }

    // Fire-and-forget background analysis. Analysis reads and decodes the whole
    // file, so defer it until the browser is idle: this keeps the second read
    // off the track-start path (where it would compete with establishing
    // playback), and skips tracks the channel has already moved past.
    if (!this.audioContext) return
    const ctx = this.audioContext
    scheduleIdle(() => {
      if (channel.player !== player) return // channel advanced to another track
      analyzeLufs(ctx, filePath)
        .then((result) => {
          this.lufsCache.set(filePath, result.integratedLufs)
          // Only apply if this chain is still driving this same player
          const currentChain = this.channelNormChains.get(channel.id)
          if (currentChain === chain && channel.player === player) {
            chain.setNormalizationGain(result.gainCorrection, 0.5)
          }
        })
        .catch((err) => {
          // Analysis failed — leave gain at 1.0 (no normalization). Logged (not
          // surfaced) so a LUFS-path decode error is distinguishable from a real
          // playback failure when triaging console noise.
          audioLog('lufs', 'analysis-failed', {
            localFilePath: filePath,
            ext: extOf(filePath),
            detail: err instanceof Error ? err.message : String(err),
          })
        })
    })
  }

  private startYouTubeAGC(channel: Channel): void {
    if (!this.audioContext || !(channel.volumeController instanceof DirectVolumeController)) return

    const controller = channel.volumeController
    this.youtubeAGC.start(
      this.audioContext,
      (gain) => {
        // Multiply AGC gain with the user's volume setting
        if (this.engineState === 'playing' && controller === channel.volumeController) {
          const userVolume = this.getVolume01()
          controller.setImmediate(userVolume * gain)
        }
      },
      () => this.getVolume01(),
    )
  }

  private stopYouTubeAGC(): void {
    this.youtubeAGC.stop()
  }

  private startPositionMonitor(): void {
    if (this.positionInterval !== null) return
    this.positionInterval = setInterval(() => this.checkNearEnd(), POSITION_POLL_MS)
  }

  private stopPositionMonitor(): void {
    if (this.positionInterval === null) return
    clearInterval(this.positionInterval)
    this.positionInterval = null
  }

  // Detects when the active track is approaching its end and starts the crossfade
  // to the next track early, so the two overlap (a real crossfade) instead of the
  // next track fading in only after the current one has fully stopped. Tracks with
  // an unknown duration or shorter than the crossfade window fall back to the
  // `ended`-triggered advance in handleTrackEnded().
  private checkNearEnd(): void {
    if (this.engineState !== 'playing' || this.autoAdvancing || !this.currentClimate) return

    const player = this.getActiveChannel().player
    if (!player) return

    const duration = player.getDuration()
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return

    const crossfade = this.currentClimate.crossfadeDuration
    // Only worth an overlapping crossfade if the track is longer than the window.
    if (duration <= crossfade + NEAR_END_PRELOAD_MARGIN) return

    const remaining = duration - player.getCurrentTime()
    if (remaining > crossfade + NEAR_END_PRELOAD_MARGIN) return

    this.triggerAdvance(this.getNextTrackIndex(), crossfade)
  }

  // Single guarded entry point for auto-advances. Holds `autoAdvancing` for the
  // whole load phase so a track that ends (or a poll tick) while an advance is
  // still loading cannot spawn a second, concurrent advanceToTrack — the race
  // behind abrupt mid-track cuts.
  private triggerAdvance(nextIndex: number, crossfadeDuration?: number): void {
    if (this.autoAdvancing) return
    this.autoAdvancing = true
    void this.advanceToTrack(nextIndex, crossfadeDuration)
      .catch(() => {})
      .finally(() => {
        this.autoAdvancing = false
      })
  }

  private handleTrackEnded(): void {
    if (this.engineState !== 'playing' || this.isActivationLoading || this.autoAdvancing) {
      return
    }

    if (!this.currentClimate || this.currentClimate.tracks.length <= 1) {
      this.triggerAdvance(this.currentTrackIndex)
      return
    }

    this.triggerAdvance(this.getNextTrackIndex())
  }

  private completePendingCrossfade(): void {
    if (this.engineState !== 'crossfading' || !this.pendingActiveChannelId) return

    this.crossfadeManager.cancelAll()

    const inId = this.pendingActiveChannelId
    const outId: ChannelId = inId === 'A' ? 'B' : 'A'
    const outChannel = this.getChannel(outId)
    const inChannel = this.getChannel(inId)

    this.disposeChannel(outChannel)
    inChannel.state = 'active'
    if (inChannel.volumeController) {
      this.crossfadeManager.setImmediate(inChannel.volumeController, this.getVolume01())
    }
    this.activeChannelId = inId
    this.pendingActiveChannelId = null
    this.engineState = 'playing'
  }

  private async advanceToTrack(
    nextIndex: number,
    crossfadeDuration: number = TRACK_CROSSFADE_DURATION,
  ): Promise<void> {
    if (!this.currentClimate) return
    const mySeq = this.activationSeq

    const sorted = [...this.currentClimate.tracks].sort((a, b) => a.order - b.order)
    if (sorted.length === 0) {
      this.goIdle()
      return
    }

    const ids = sorted.map((t) => t.id)

    // Everything is already known-bad this session — don't churn through
    // guaranteed failures (which would re-toast each one); just stop.
    if (this.failedTrackIds.size >= sorted.length) {
      audioLog('select', 'all-tracks-failed', {
        failedCount: this.failedTrackIds.size,
        trackCount: sorted.length,
      })
      toast.error('All tracks failed to load')
      this.goIdle()
      return
    }

    let idx = nextIndex % sorted.length

    for (let attempts = 0; attempts < sorted.length; attempts++) {
      this.currentTrackIndex = idx
      const track = sorted[idx]

      // Skip tracks already known to fail (unless every track has failed) so a
      // few broken files don't repeatedly interrupt or collapse selection.
      if (this.failedTrackIds.has(track.id) && this.failedTrackIds.size < sorted.length) {
        idx = nextSequentialIndex(idx, ids, this.failedTrackIds)
        continue
      }

      this.updateStore({ activeTrackId: track.id })

      const inId = this.getInactiveChannelId()
      const inChannel = this.getChannel(inId)
      const outChannel = this.getActiveChannel()

      this.stopYouTubeAGC()
      const loaded = await this.loadAndPlayOnChannel(inChannel, track, undefined, mySeq)
      if (this.activationSeq !== mySeq) return
      if (loaded) {
        this.engineState = 'crossfading'
        this.pendingActiveChannelId = inId

        // Clamp the crossfade to the outgoing track's remaining time: a manual
        // skip (lots of time left) stays snappy at the requested length, while a
        // near-end auto-advance fades out exactly as the track ends instead of
        // overrunning into silence.
        let fade = crossfadeDuration
        const outPlayer = outChannel.player
        if (outPlayer) {
          const outDuration = outPlayer.getDuration()
          if (outDuration !== undefined && Number.isFinite(outDuration) && outDuration > 0) {
            const outRemaining = outDuration - outPlayer.getCurrentTime()
            if (outRemaining > 0.3) fade = Math.min(fade, outRemaining)
          }
        }

        const incomingTrackSource = track.source
        this.crossfadeManager.crossfade(
          outChannel.id,
          outChannel.volumeController!,
          inChannel.id,
          inChannel.volumeController!,
          this.getVolume01(),
          fade,
          () => {
            if (this.activationSeq !== mySeq) return
            this.disposeChannel(outChannel)
            inChannel.state = 'active'
            this.activeChannelId = inId
            this.pendingActiveChannelId = null
            this.engineState = 'playing'

            if (incomingTrackSource === 'youtube') {
              this.startYouTubeAGC(inChannel)
            }
            // Track may have ended during crossfade — advance if so
            if (inChannel.player?.hasEnded()) {
              this.handleTrackEnded()
            }
          },
        )
        return
      }

      idx = nextSequentialIndex(idx, ids, this.failedTrackIds)
    }

    // Nothing in this pass could load. Keep the message honest about how many
    // tracks are unplayable so a mostly-working climate reads differently from a
    // fully-broken one.
    const failedCount = this.failedTrackIds.size
    audioLog('select', 'advance-exhausted', {
      failedCount,
      trackCount: sorted.length,
    })
    toast.error(
      failedCount >= sorted.length
        ? 'All tracks failed to load'
        : `${failedCount} of ${sorted.length} tracks couldn't be played`,
    )
    this.goIdle()
  }

  private goIdle(): void {
    this.stopYouTubeAGC()
    this.autoAdvancing = false
    this.crossfadeManager.cancelAll()
    if (this.channelA) this.disposeChannel(this.channelA)
    if (this.channelB) this.disposeChannel(this.channelB)
    // Safe to remove orphaned YouTube iframes now — no players are active.
    removeOrphanedYouTubeContainers()
    this.engineState = 'idle'
    this.pendingActiveChannelId = null
    this.isActivationLoading = false

    this.currentClimate = null
    this.currentTrackIndex = 0
    this.failedTrackIds.clear()
    this.shuffleBag.reset()
    useAudioStore.getState().clearAllFadeAnimations()
    this.updateStore({
      isPlaying: false,
      activeClimateId: null,
      activeTrackId: null,
      isFadingToSilence: false,
    })
  }

  async activateClimate(climate: Climate, startTrackId?: string): Promise<void> {
    // Already playing this climate — no-op. An explicit track request (startTrackId)
    // always takes effect, even when this climate is already the active one.
    if (
      !startTrackId &&
      useAudioStore.getState().activeClimateId === climate.id &&
      this.engineState === 'playing'
    ) {
      return
    }

    if (climate.tracks.length === 0) {
      toast.error('This climate has no tracks')
      return
    }

    const mySeq = ++this.activationSeq
    this.isActivationLoading = true

    this.ensureContext()

    // New activation session for this climate — forget prior per-session failures
    // and start a fresh shuffle cycle so retries and full coverage both reset.
    this.failedTrackIds.clear()
    this.shuffleBag.reset()

    if (this.engineState === 'crossfading') {
      this.completePendingCrossfade()
    }
    this.crossfadeManager.cancelAll()

    const sorted = [...climate.tracks].sort((a, b) => a.order - b.order)

    // A specific track was requested: start it from the beginning. Otherwise
    // restore from snapshot if available, else start at track 0 (or a random
    // track when shuffling).
    const snapshot = this.getClimateSnapshot(climate)
    let startTrackIndex: number
    let startPositionSec: number
    if (startTrackId) {
      const idx = sorted.findIndex((t) => t.id === startTrackId)
      startTrackIndex = idx === -1 ? 0 : idx
      startPositionSec = 0
    } else if (snapshot) {
      startTrackIndex = snapshot.trackIndex % sorted.length
      startPositionSec = snapshot.positionSec ?? 0
    } else if (useAudioStore.getState().isShuffled && sorted.length > 1) {
      startTrackIndex = this.shuffleBag.next(
        sorted.map((t) => t.id),
        this.failedTrackIds,
        -1,
        this.getTrackFingerprint(climate),
      )
      startPositionSec = 0
    } else {
      startTrackIndex = 0
      startPositionSec = 0
    }

    this.currentClimate = climate
    this.currentTrackIndex = startTrackIndex

    if (this.engineState === 'idle' || this.engineState === 'fading-to-silence') {
      // Clean up any existing state
      if (this.channelA) this.disposeChannel(this.channelA)
      if (this.channelB) this.disposeChannel(this.channelB)
      this.activeChannelId = 'A'

      const channel = this.getChannel('A')
      const track = sorted[startTrackIndex]

      this.updateStore({
        activeClimateId: climate.id,
        activeTrackId: track.id,
        isPlaying: true,
        isFadingToSilence: false,
      })

      const loaded = await this.loadAndPlayOnChannel(channel, track, startPositionSec, mySeq)
      if (this.activationSeq !== mySeq) return
      this.isActivationLoading = false
      if (loaded) {
        channel.state = 'active'
        this.engineState = 'playing'

        if (track.source === 'youtube') {
          this.startYouTubeAGC(channel)
        }
        const store = useAudioStore.getState()
        store.clearAllFadeAnimations()
        store.startFadeAnimation({
          climateId: climate.id,
          direction: 'in',
          durationMs: FADE_IN_DURATION * 1000,
          startedAt: Date.now(),
        })
        this.crossfadeManager.fadeChannel(
          'A',
          channel.volumeController!,
          this.getVolume01(),
          FADE_IN_DURATION,
        )
      } else {
        // Try next tracks
        await this.advanceToTrack(startTrackIndex + 1)
      }
    } else {
      // Currently playing — crossfade to new climate
      this.saveClimateSnapshot()
      const previousClimateId = useAudioStore.getState().activeClimateId

      const outChannel = this.getActiveChannel()
      const inId = this.getInactiveChannelId()
      const inChannel = this.getChannel(inId)
      const track = sorted[startTrackIndex]
      const duration = climate.crossfadeDuration

      this.updateStore({
        activeClimateId: climate.id,
        activeTrackId: track.id,
        isPlaying: true,
        isFadingToSilence: false,
      })

      this.stopYouTubeAGC()
      const loaded = await this.loadAndPlayOnChannel(inChannel, track, startPositionSec, mySeq)
      if (this.activationSeq !== mySeq) return
      this.isActivationLoading = false
      if (loaded) {
        this.engineState = 'crossfading'
        this.pendingActiveChannelId = inId
        outChannel.state = 'fading-out'
        inChannel.state = 'active'

        const store = useAudioStore.getState()
        store.clearAllFadeAnimations()
        const now = Date.now()
        const durationMs = duration * 1000
        if (previousClimateId) {
          store.startFadeAnimation({
            climateId: previousClimateId,
            direction: 'out',
            durationMs,
            startedAt: now,
          })
        }
        store.startFadeAnimation({
          climateId: climate.id,
          direction: 'in',
          durationMs,
          startedAt: now,
        })

        const incomingTrackSource = track.source
        this.crossfadeManager.crossfade(
          outChannel.id,
          outChannel.volumeController!,
          inChannel.id,
          inChannel.volumeController!,
          this.getVolume01(),
          duration,
          () => {
            if (this.activationSeq !== mySeq) return
            this.disposeChannel(outChannel)
            this.activeChannelId = inId
            this.pendingActiveChannelId = null
            this.engineState = 'playing'

            if (incomingTrackSource === 'youtube') {
              this.startYouTubeAGC(this.getChannel(inId))
            }
            useAudioStore.getState().clearAllFadeAnimations()
            // Track may have ended during crossfade — advance if so
            const activePlayer = this.getChannel(inId).player
            if (activePlayer?.hasEnded()) {
              this.handleTrackEnded()
            }
          },
        )
      } else {
        await this.advanceToTrack(startTrackIndex + 1)
      }
    }
  }

  async nextTrack(): Promise<void> {
    if (!this.currentClimate) return

    if (this.engineState === 'crossfading') {
      this.completePendingCrossfade()
    }

    if (this.engineState !== 'playing') return
    ++this.activationSeq
    // Hold the guard for the load so a near-end poll tick can't start a second,
    // competing advance while this user-initiated skip is still loading.
    this.autoAdvancing = true
    try {
      await this.advanceToTrack(this.getNextTrackIndex())
    } finally {
      this.autoAdvancing = false
    }
  }

  // Crossfade to a specific track within the currently playing climate. Only
  // valid while playing — callers should route to activateClimate() when the
  // climate isn't the active one or is idle/fading-to-silence.
  async skipToTrack(trackId: string): Promise<void> {
    if (!this.currentClimate) return

    const sorted = this.sortedTracks(this.currentClimate)
    const trackIndex = sorted.findIndex((t) => t.id === trackId)
    if (trackIndex === -1) return

    if (this.engineState === 'crossfading') {
      this.completePendingCrossfade()
    }

    if (this.engineState !== 'playing') return
    ++this.activationSeq
    this.autoAdvancing = true
    try {
      await this.advanceToTrack(trackIndex)
    } finally {
      this.autoAdvancing = false
    }
  }

  fadeToSilence(): void {
    if (this.engineState !== 'playing') return

    this.stopYouTubeAGC()
    this.saveClimateSnapshot()
    this.engineState = 'fading-to-silence'
    this.updateStore({ isFadingToSilence: true })

    const activeClimateId = useAudioStore.getState().activeClimateId
    const store = useAudioStore.getState()
    store.clearAllFadeAnimations()
    if (activeClimateId) {
      store.startFadeAnimation({
        climateId: activeClimateId,
        direction: 'out',
        durationMs: FADE_TO_SILENCE_DURATION * 1000,
        startedAt: Date.now(),
      })
    }

    const channel = this.getActiveChannel()
    this.crossfadeManager.fadeChannel(
      channel.id,
      channel.volumeController!,
      0,
      FADE_TO_SILENCE_DURATION,
      () => {
        channel.player?.pause()
        this.updateStore({ isPlaying: false })
        useAudioStore.getState().clearAllFadeAnimations()
      },
    )
  }

  resume(): void {
    const store = useAudioStore.getState()
    if (!store.activeClimateId || store.isPlaying) return

    const channel = this.getActiveChannel()
    if (!channel.player) return

    this.ensureContext()
    channel.player.play()
    this.engineState = 'playing'

    this.updateStore({ isPlaying: true, isFadingToSilence: false })

    store.clearAllFadeAnimations()
    store.startFadeAnimation({
      climateId: store.activeClimateId,
      direction: 'in',
      durationMs: FADE_IN_DURATION * 1000,
      startedAt: Date.now(),
    })

    this.crossfadeManager.fadeChannel(
      channel.id,
      channel.volumeController!,
      this.getVolume01(),
      FADE_IN_DURATION,
    )
  }

  setVolume(volume: number): void {
    if (this.engineState === 'playing') {
      const channel = this.getActiveChannel()
      if (channel.volumeController) {
        this.crossfadeManager.setImmediate(channel.volumeController, volume / 100)
      }
    }
  }

  getNormalizationInfo(): NormalizationInfo {
    const none: NormalizationInfo = {
      type: 'none',
      gainDb: 0,
      compressorReductionDb: 0,
      analyser: null,
    }
    if (this.engineState === 'idle') return none

    // During crossfade, prefer the incoming channel
    const channelId = this.pendingActiveChannelId ?? this.activeChannelId

    // Check for local file normalization chain
    const chain = this.channelNormChains.get(channelId)
    if (chain) {
      const linearGain = chain.getNormalizationGainValue()
      const gainDb = linearGain > 0 ? 20 * Math.log10(linearGain) : -Infinity
      return {
        type: 'lufs',
        gainDb,
        compressorReductionDb: chain.getCompressorReduction(),
        analyser: chain.getAnalyser(),
      }
    }

    // Check for YouTube AGC
    if (this.youtubeAGC.isActive()) {
      const linearGain = this.youtubeAGC.getCurrentGain()
      const gainDb = linearGain > 0 ? 20 * Math.log10(linearGain) : -Infinity
      return { type: 'agc', gainDb, compressorReductionDb: 0, analyser: null }
    }

    return none
  }

  dispose(): void {
    this.youtubeAGC.dispose()
    this.stopPositionMonitor()
    this.autoAdvancing = false
    this.crossfadeManager.cancelAll()
    if (this.channelA) this.disposeChannel(this.channelA)
    if (this.channelB) this.disposeChannel(this.channelB)
    removeOrphanedYouTubeContainers()
    this.lufsCache.dispose()
    this.volumeUnsub?.()
    this.audioContext?.close()
    this.audioContext = null
    this.channelA = null
    this.channelB = null
    this.engineState = 'idle'
    this.isActivationLoading = false

    this.failedTrackIds.clear()
    this.shuffleBag.reset()
    this.climateSnapshots.clear()
    AudioEngine.instance = null
  }
}
