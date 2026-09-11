export interface Campaign {
  id: string
  name: string
  description?: string
  climates: Climate[]
  /** Campaign-wide one-shot effects, available regardless of the active climate. */
  soundboard?: SoundboardSound[]
  createdAt: string
  updatedAt: string
}

export interface SoundboardSound {
  id: string
  name: string
  localFilePath: string
  /** 0-100, relative to the app's master volume. */
  volume: number
  /** A single Unicode letter, normalized to lowercase. */
  shortcutKey?: string
  /** Lucide icon identifier displayed beside the shortcut letter. */
  icon?: string
  /** Optional CSS color for the selected icon. */
  iconColor?: string
  /** Behavior when triggered again while this sound is active. */
  playbackMode: SoundboardPlaybackMode
  /** Symmetric random playback-rate range, 0-20%. Changes pitch and speed together. */
  pitchVariation?: number
  duration?: number
  order: number
}

export type SoundboardPlaybackMode = 'ignore' | 'stop' | 'restart' | 'multiple' | 'loop'

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
  /** Symmetric random playback-rate range, 0-20%. Changes pitch and speed together. */
  pitchVariation?: number
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

/** Result of loading campaigns from disk (main → renderer via IPC). */
export interface LoadCampaignsResult {
  campaigns: Campaign[]
  /** Primary file was corrupt; campaigns came from the last-known-good backup. */
  warning?: string
  /** Campaigns could not be loaded (corrupt primary and missing/bad backup). */
  error?: string
}

export interface CollectMediaFailure {
  sourcePath: string
  reason: string
}

export type CampaignMediaType = 'music' | 'ambient' | 'sfx'

export interface CollectMediaPathUpdate {
  mediaType: CampaignMediaType
  sourcePath: string
  collectedPath: string
}

export interface CollectMediaProgress {
  completedFiles: number
  totalFiles: number
  copiedFiles: number
  skippedFiles: number
  failedFiles: number
  completedBytes: number
  copiedBytes: number
  totalBytes: number
  failures: CollectMediaFailure[]
}

export interface CollectCampaignMediaResult {
  copiedFiles: number
  skippedFiles: number
  copiedBytes: number
  failures: CollectMediaFailure[]
  pathUpdates: CollectMediaPathUpdate[]
  finalProgress: CollectMediaProgress
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
  | { type: 'trigger-soundboard'; payload: { soundId: string } }

/**
 * Phone-remote projection of a track. Intentionally omits filesystem paths and
 * YouTube URLs — the remote only needs identity + title for "now playing".
 */
export interface RemoteTrack {
  id: string
  title: string
  order: number
}

/** Phone-remote projection of an ambient layer (no clips / paths). */
export interface RemoteAmbientLayer {
  id: string
  name: string
  mode: AmbientMode
  enabled: boolean
  volume: number
  order: number
}

export interface RemoteClimate {
  id: string
  name: string
  color: string
  icon: string
  order: number
  tracks: RemoteTrack[]
  ambientLayers?: RemoteAmbientLayer[]
}

export interface RemoteCampaign {
  id: string
  name: string
  climates: RemoteClimate[]
  soundboard?: RemoteSoundboardSound[]
}

/** Phone projection of a soundboard item; local paths and authoring controls are omitted. */
export interface RemoteSoundboardSound {
  id: string
  name: string
  shortcutKey?: string
  icon?: string
  iconColor?: string
  order: number
  /** Session diagnostic only; no filesystem details are exposed to the phone. */
  unavailable?: boolean
}

export type RemoteStateMessage =
  | { type: 'full-state'; payload: RemoteFullState }
  | { type: 'playback-update'; payload: PlaybackState }
  | { type: 'campaigns-update'; payload: { campaigns: RemoteCampaign[] } }
  | { type: 'soundboard-activity'; payload: RemoteSoundboardActivity }

export interface RemoteSoundboardActivity {
  soundId: string
  playing: boolean
  voiceCount: number
  startedAtMs?: number
  durationMs?: number
}

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
  campaigns: RemoteCampaign[]
  activeCampaignId: string | null
  playback: PlaybackState
}
