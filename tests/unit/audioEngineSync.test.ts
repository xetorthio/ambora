import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Climate } from '../../src/shared/types'

interface AudioEngineState {
  currentClimate: Climate | null
  currentTrackIndex: number
  climateSnapshots: Map<string, { trackId: string; positionSec: number; trackFingerprint: string }>
  getTrackSetFingerprint: (climate: Climate) => string
  getClimateSnapshot: (climate: Climate) => { trackIndex: number; positionSec: number } | null
  engineState: string
  isActivationLoading: boolean
  activeChannelId: 'A' | 'B'
  channelA: unknown
  channelB: unknown
  ensureContext: () => void
  loadAndPlayOnChannel: () => Promise<boolean>
  ambient: { startClimate: () => void }
}

function climate(trackIds: string[], id = 'climate-1'): Climate {
  return {
    id,
    name: 'Forest',
    color: '#2D9A5D',
    icon: 'TreePine',
    order: 0,
    crossfadeDuration: 4,
    tracks: trackIds.map((id, order) => ({
      id,
      title: id,
      source: 'local',
      localFilePath: `/${id}.mp3`,
      order,
    })),
  }
}

describe('AudioEngine climate synchronisation', () => {
  let engine: import('../../src/renderer/src/audio/AudioEngine').AudioEngine
  let internal: AudioEngineState
  let useAudioStore: typeof import('../../src/renderer/src/store/audioStore').useAudioStore

  beforeAll(async () => {
    vi.stubGlobal('window', { api: { platform: 'linux' } })
    ;({ useAudioStore } = await import('../../src/renderer/src/store/audioStore'))
    const { AudioEngine } = await import('../../src/renderer/src/audio/AudioEngine')
    engine = AudioEngine.getInstance()
    internal = engine as unknown as AudioEngineState
  })

  beforeEach(() => {
    internal.currentClimate = climate(['track-a', 'track-b', 'track-c'])
    internal.currentTrackIndex = 1
    internal.climateSnapshots.clear()
    useAudioStore.setState({ activeTrackId: 'track-b' })
  })

  it('updates the active Climate and follows the active track when tracks are reordered', () => {
    const reordered = climate(['track-c', 'track-a', 'track-b'])

    engine.syncClimate(reordered)

    expect(internal.currentClimate).toBe(reordered)
    expect(internal.currentTrackIndex).toBe(2)
  })

  it('clamps the playback index when the active track is deleted', () => {
    const withoutActiveTrack = climate(['track-a'])

    engine.syncClimate(withoutActiveTrack)

    expect(internal.currentClimate).toBe(withoutActiveTrack)
    expect(internal.currentTrackIndex).toBe(0)
  })

  it('ignores edits to a Climate that is not active in the engine', () => {
    const otherClimate = { ...climate(['track-x']), id: 'climate-2' }
    const currentClimate = internal.currentClimate

    engine.syncClimate(otherClimate)

    expect(internal.currentClimate).toBe(currentClimate)
    expect(internal.currentTrackIndex).toBe(1)
  })

  it('resumes the same track after its position in the Climate changes', () => {
    const original = climate(['track-a', 'track-b', 'track-c'])
    internal.climateSnapshots.set(original.id, {
      trackId: 'track-b',
      positionSec: 150,
      trackFingerprint: internal.getTrackSetFingerprint(original),
    })

    const snapshot = internal.getClimateSnapshot(climate(['track-b', 'track-a', 'track-c']))

    expect(snapshot).toEqual({ trackIndex: 0, positionSec: 150 })
  })

  describe('switching climates while music plays', () => {
    const forest = climate(['track-a', 'track-b', 'track-c'], 'forest')
    const tavern = climate(['track-x', 'track-y'], 'tavern')
    let positionSec: number

    function channel(id: 'A' | 'B'): unknown {
      return {
        id,
        state: 'active',
        player: { getCurrentTime: () => positionSec, stop: vi.fn(), dispose: vi.fn() },
        volumeController: null,
      }
    }

    beforeEach(() => {
      // Stop each activation at its first await: the snapshot is saved before it.
      internal.ensureContext = (): void => {}
      internal.loadAndPlayOnChannel = (): Promise<boolean> => new Promise(() => {})
      internal.ambient = { startClimate: (): void => {} }
      internal.channelA = channel('A')
      internal.channelB = channel('B')
      internal.activeChannelId = 'A'
      internal.engineState = 'playing'
      internal.isActivationLoading = false
      internal.currentClimate = forest
      internal.currentTrackIndex = 1
      positionSec = 95
      useAudioStore.setState({ activeClimateId: 'forest', activeTrackId: 'track-b' })
    })

    it('saves the outgoing climate, not the incoming one', () => {
      void engine.activateClimate(tavern)

      expect(internal.climateSnapshots.has('tavern')).toBe(false)
      expect(internal.getClimateSnapshot(forest)).toEqual({ trackIndex: 1, positionSec: 95 })
    })

    it('does not save while superseding an activation that is still loading', () => {
      void engine.activateClimate(tavern)
      positionSec = 97

      // Tavern is still loading, so the audible channel is still Forest's.
      void engine.activateClimate(climate(['track-q'], 'dungeon'))

      expect(internal.climateSnapshots.has('tavern')).toBe(false)
      expect(internal.getClimateSnapshot(forest)).toEqual({ trackIndex: 1, positionSec: 95 })
    })
  })
})
