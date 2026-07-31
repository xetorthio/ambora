import { create } from 'zustand'

export type DiagnosticSource = 'probe' | 'playback'

export interface TrackDiagnostic {
  reason: string
  source: DiagnosticSource
}

/**
 * Session-scoped playability diagnostics for tracks, keyed by track id. Absence of
 * an entry means playable/unknown. Fed by two signals: proactive probes (on climate
 * open / add) and reactive playback failures pushed by the AudioEngine.
 *
 * Deliberately NOT persisted — a fixed/replaced file self-heals on the next probe,
 * there's no campaigns.json schema change, and there's no staleness to reconcile.
 */
interface DiagnosticsStore {
  unplayable: Record<string, TrackDiagnostic>
  // Track ids probed this session, to avoid re-probing the same file repeatedly.
  probed: Set<string>

  setUnplayable: (trackId: string, diagnostic: TrackDiagnostic) => void
  clearUnplayable: (trackId: string) => void
  markProbed: (trackId: string) => void
  hasProbed: (trackId: string) => boolean
  // Drop all diagnostics for a track (e.g. when it's removed from a climate).
  forgetTrack: (trackId: string) => void
  clearAll: () => void
}

export const useDiagnosticsStore = create<DiagnosticsStore>((set, get) => ({
  unplayable: {},
  probed: new Set(),

  setUnplayable: (trackId, diagnostic) =>
    set((state) => ({ unplayable: { ...state.unplayable, [trackId]: diagnostic } })),

  clearUnplayable: (trackId) =>
    set((state) => {
      if (!(trackId in state.unplayable)) return state
      const unplayable = { ...state.unplayable }
      delete unplayable[trackId]
      return { unplayable }
    }),

  markProbed: (trackId) =>
    set((state) => {
      if (state.probed.has(trackId)) return state
      const probed = new Set(state.probed)
      probed.add(trackId)
      return { probed }
    }),

  hasProbed: (trackId) => get().probed.has(trackId),

  forgetTrack: (trackId) =>
    set((state) => {
      const probed = new Set(state.probed)
      probed.delete(trackId)
      if (!(trackId in state.unplayable)) return { probed }
      const unplayable = { ...state.unplayable }
      delete unplayable[trackId]
      return { probed, unplayable }
    }),

  clearAll: () => set({ unplayable: {}, probed: new Set() }),
}))
