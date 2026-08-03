import { create } from 'zustand'
import { DEFAULTS } from '@/lib/constants'
import type { AmbientLayerRuntime } from '@/lib/types'

export interface FadeAnimation {
  climateId: string
  direction: 'in' | 'out'
  durationMs: number
  startedAt: number
}

interface AudioStore {
  isPlaying: boolean
  volume: number
  activeClimateId: string | null
  activeTrackId: string | null
  isFadingToSilence: boolean
  isShuffled: boolean
  fadeAnimations: FadeAnimation[]
  /**
   * Per-layer state for the active climate, keyed by layer id. Ephemeral by
   * design: the stored layer holds the scene's authored defaults, and this map
   * is reseeded from them every time the climate is activated, so a session's
   * tweaks can never quietly rewrite a carefully-built scene.
   */
  ambientRuntime: Record<string, AmbientLayerRuntime>
  /** Layer currently being auditioned in the desktop editor, if any. */
  auditioningLayerId: string | null

  setIsPlaying: (isPlaying: boolean) => void
  setVolume: (volume: number) => void
  setActiveClimateId: (id: string | null) => void
  setActiveTrackId: (id: string | null) => void
  setIsFadingToSilence: (isFading: boolean) => void
  toggleShuffle: () => void
  startFadeAnimation: (animation: FadeAnimation) => void
  clearAllFadeAnimations: () => void
  setAmbientRuntime: (runtime: Record<string, AmbientLayerRuntime>) => void
  setAmbientLayerEnabled: (layerId: string, enabled: boolean) => void
  setAmbientLayerVolume: (layerId: string, volume: number) => void
  markAmbientLayerTriggered: (layerId: string) => void
  setAmbientLayerSounding: (layerId: string, sounding: boolean) => void
  setAuditioningLayerId: (layerId: string | null) => void
}

export const useAudioStore = create<AudioStore>((set) => ({
  isPlaying: false,
  volume: DEFAULTS.volume,
  activeClimateId: null,
  activeTrackId: null,
  isFadingToSilence: false,
  isShuffled: true,
  fadeAnimations: [],
  ambientRuntime: {},
  auditioningLayerId: null,

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setVolume: (volume) => set({ volume }),
  setActiveClimateId: (id) => set({ activeClimateId: id }),
  setActiveTrackId: (id) => set({ activeTrackId: id }),
  setIsFadingToSilence: (isFading) => set({ isFadingToSilence: isFading }),
  toggleShuffle: () => set((state) => ({ isShuffled: !state.isShuffled })),
  startFadeAnimation: (animation) =>
    set((state) => ({
      fadeAnimations: [
        ...state.fadeAnimations.filter((fa) => fa.climateId !== animation.climateId),
        animation,
      ],
    })),
  clearAllFadeAnimations: () => set({ fadeAnimations: [] }),

  setAmbientRuntime: (ambientRuntime) => set({ ambientRuntime }),

  setAmbientLayerEnabled: (layerId, enabled) =>
    set((state) => {
      const current = state.ambientRuntime[layerId]
      if (!current || current.enabled === enabled) return state
      return {
        ambientRuntime: { ...state.ambientRuntime, [layerId]: { ...current, enabled } },
      }
    }),

  setAmbientLayerVolume: (layerId, volume) =>
    set((state) => {
      const current = state.ambientRuntime[layerId]
      if (!current || current.volume === volume) return state
      return {
        ambientRuntime: { ...state.ambientRuntime, [layerId]: { ...current, volume } },
      }
    }),

  markAmbientLayerTriggered: (layerId) =>
    set((state) => {
      const current = state.ambientRuntime[layerId]
      if (!current) return state
      return {
        ambientRuntime: {
          ...state.ambientRuntime,
          [layerId]: { ...current, triggeredAt: Date.now() },
        },
      }
    }),

  setAmbientLayerSounding: (layerId, sounding) =>
    set((state) => {
      const current = state.ambientRuntime[layerId]
      if (!current || (current.sounding ?? false) === sounding) return state
      return {
        ambientRuntime: { ...state.ambientRuntime, [layerId]: { ...current, sounding } },
      }
    }),

  setAuditioningLayerId: (auditioningLayerId) => set({ auditioningLayerId }),
}))
