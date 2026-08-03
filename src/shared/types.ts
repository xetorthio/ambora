export interface Campaign {
  id: string
  name: string
  description?: string
  climates: Climate[]
  createdAt: string
  updatedAt: string
}

export interface Climate {
  id: string
  name: string
  color: string
  icon: string
  tracks: Track[]
  order: number
  crossfadeDuration: number
  /**
   * Optional so campaigns saved before ambient layers existed load unchanged —
   * treat `undefined` as an empty list everywhere.
   */
  ambientLayers?: AmbientLayer[]
}

export type AmbientMode = 'loop' | 'random' | 'oneshot'

/** How a layer picks its next clip when it has more than one. */
export type AmbientClipOrder = 'shuffle' | 'random' | 'sequential'

/**
 * Ambient clips are local files only. YouTube can't deliver short overlapping
 * clips — one iframe per player, seconds of load latency, no reliable one-shot.
 */
export interface AmbientClip {
  id: string
  title: string
  localFilePath: string
  duration?: number
  order: number
}

export interface AmbientLayer {
  id: string
  name: string
  mode: AmbientMode
  /** Default on/off state applied when the climate activates. */
  enabled: boolean
  /** 0-100, relative to the master volume. */
  volume: number
  clips: AmbientClip[]
  clipOrder: AmbientClipOrder
  /** Random mode only: delay bounds, measured from when the last clip ended. */
  minDelaySec: number
  maxDelaySec: number
  order: number
}

/**
 * Per-layer state for the *active* climate while it plays. Ephemeral: the GM's
 * session tweaks never write back to the stored layer, and re-activating the
 * climate restores the authored defaults.
 */
export interface AmbientLayerRuntime {
  enabled: boolean
  volume: number
  /** Epoch ms of the last one-shot trigger, for the remote's pad flash. */
  triggeredAt?: number
  /**
   * True while this layer actually has audio playing. A loop layer is sounding
   * continuously; a random layer only during a clip, so the GM can see it fire
   * rather than having to trust that the timer is running.
   */
  sounding?: boolean
}

export interface Track {
  id: string
  title: string
  source: 'youtube' | 'local'
  youtubeVideoId?: string
  youtubeUrl?: string
  localFilePath?: string
  duration?: number
  order: number
}

export interface AppState {
  activeCampaignId: string | null
  activeClimateId: string | null
  activeTrackId: string | null
  isPlaying: boolean
  volume: number
  isFadingToSilence: boolean
}

// WebSocket protocol types

export type RemoteCommand =
  | { type: 'activate-climate'; payload: { climateId: string } }
  | { type: 'play-pause' }
  | { type: 'skip-track' }
  | { type: 'set-volume'; payload: { volume: number } }
  | { type: 'toggle-shuffle' }
  | { type: 'set-layer-enabled'; payload: { layerId: string; enabled: boolean } }
  | { type: 'set-layer-volume'; payload: { layerId: string; volume: number } }
  | { type: 'trigger-layer'; payload: { layerId: string } }

export type RemoteStateMessage =
  | { type: 'full-state'; payload: RemoteFullState }
  | { type: 'playback-update'; payload: PlaybackState }
  | { type: 'campaigns-update'; payload: { campaigns: Campaign[] } }

export interface RemoteFadeAnimation {
  climateId: string
  direction: 'in' | 'out'
  durationMs: number
  startedAt: number
}

export interface PlaybackState {
  activeCampaignId: string | null
  activeClimateId: string | null
  activeTrackId: string | null
  isPlaying: boolean
  volume: number
  isFadingToSilence: boolean
  isShuffled: boolean
  fadeAnimations: RemoteFadeAnimation[]
  /** Runtime layer state for the active climate, keyed by layer id. */
  ambientRuntime: Record<string, AmbientLayerRuntime>
}

export interface RemoteFullState {
  campaigns: Campaign[]
  activeCampaignId: string | null
  playback: PlaybackState
}
