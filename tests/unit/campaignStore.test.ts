import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULTS, CLIMATE_COLORS, CLIMATE_ICONS } from '../../src/renderer/src/lib/constants'

// Mock window.api
const mockApi = {
  getCampaigns: vi.fn(),
  saveCampaigns: vi.fn(),
  collectCampaignMedia: vi.fn(),
}

vi.stubGlobal('window', { api: mockApi })

// Must import after stubbing window
let useCampaignStore: typeof import('../../src/renderer/src/store/campaignStore').useCampaignStore

beforeEach(async () => {
  vi.resetModules()
  mockApi.getCampaigns.mockReset()
  mockApi.saveCampaigns.mockReset()
  mockApi.collectCampaignMedia.mockReset()
  const mod = await import('../../src/renderer/src/store/campaignStore')
  useCampaignStore = mod.useCampaignStore
})

describe('loadCampaigns', () => {
  it('loads campaigns from IPC and sets isLoaded', async () => {
    mockApi.getCampaigns.mockResolvedValue({
      campaigns: [{ id: '1', name: 'Test', climates: [], createdAt: '', updatedAt: '' }],
    })
    await useCampaignStore.getState().loadCampaigns()
    expect(useCampaignStore.getState().campaigns).toHaveLength(1)
    expect(useCampaignStore.getState().isLoaded).toBe(true)
  })

  it('clamps persisted pitch variation while loading', async () => {
    mockApi.getCampaigns.mockResolvedValue({
      campaigns: [
        {
          id: 'campaign-1',
          name: 'Mine',
          createdAt: '',
          updatedAt: '',
          soundboard: [
            {
              id: 'sound-1',
              name: 'Pickaxe',
              localFilePath: '/pickaxe.wav',
              volume: 70,
              playbackMode: 'restart',
              pitchVariation: 90,
              order: 0,
            },
          ],
          climates: [
            {
              id: 'climate-1',
              name: 'Cave',
              color: '#000000',
              icon: 'Mountain',
              tracks: [],
              order: 0,
              crossfadeDuration: 4,
              ambientLayers: [
                {
                  id: 'layer-1',
                  name: 'Drops',
                  mode: 'random',
                  enabled: true,
                  volume: 60,
                  pitchVariation: -10,
                  clips: [],
                  clipOrder: 'shuffle',
                  minDelaySec: 5,
                  maxDelaySec: 10,
                  order: 0,
                },
              ],
            },
          ],
        },
      ],
    })

    await useCampaignStore.getState().loadCampaigns()
    const campaign = useCampaignStore.getState().campaigns[0]
    expect(campaign.soundboard?.[0].pitchVariation).toBe(20)
    expect(campaign.climates[0].ambientLayers?.[0].pitchVariation).toBe(0)
  })
})

describe('campaign CRUD', () => {
  it('creates a campaign', () => {
    const campaign = useCampaignStore.getState().createCampaign('My Campaign', 'A description')
    expect(campaign.name).toBe('My Campaign')
    expect(campaign.description).toBe('A description')
    expect(campaign.id).toBeTruthy()
    expect(useCampaignStore.getState().campaigns).toHaveLength(1)
    expect(mockApi.saveCampaigns).toHaveBeenCalledOnce()
  })

  it('updates a campaign', () => {
    const campaign = useCampaignStore.getState().createCampaign('Original')
    useCampaignStore.getState().updateCampaign(campaign.id, { name: 'Updated' })
    expect(useCampaignStore.getState().campaigns[0].name).toBe('Updated')
    expect(mockApi.saveCampaigns).toHaveBeenCalledTimes(2)
  })

  it('deletes a campaign', () => {
    const campaign = useCampaignStore.getState().createCampaign('To Delete')
    useCampaignStore.getState().deleteCampaign(campaign.id)
    expect(useCampaignStore.getState().campaigns).toHaveLength(0)
  })

  it('clears activeCampaignId when deleting the active campaign', () => {
    const campaign = useCampaignStore.getState().createCampaign('Active')
    useCampaignStore.getState().setActiveCampaign(campaign.id)
    expect(useCampaignStore.getState().activeCampaignId).toBe(campaign.id)

    useCampaignStore.getState().deleteCampaign(campaign.id)
    expect(useCampaignStore.getState().activeCampaignId).toBeNull()
  })

  it('sets active campaign', () => {
    const campaign = useCampaignStore.getState().createCampaign('Test')
    useCampaignStore.getState().setActiveCampaign(campaign.id)
    expect(useCampaignStore.getState().activeCampaignId).toBe(campaign.id)
  })

  it('applies collected paths to every matching local media reference', async () => {
    const campaign = useCampaignStore.getState().createCampaign('Collected')
    const climate = useCampaignStore.getState().createClimate(campaign.id, 'Forest')!
    useCampaignStore.getState().addTrack(campaign.id, climate.id, {
      title: 'Music',
      source: 'local',
      localFilePath: '/library/shared.wav',
    })
    useCampaignStore
      .getState()
      .createAmbientLayer(campaign.id, climate.id, 'Wind', [
        { title: 'Wind', localFilePath: '/library/shared.wav' },
      ])
    useCampaignStore.getState().addSoundboardSound(campaign.id, {
      name: 'Effect',
      localFilePath: '/library/shared.wav',
      volume: 100,
      playbackMode: 'restart',
    })
    mockApi.collectCampaignMedia.mockResolvedValue({
      copiedFiles: 1,
      skippedFiles: 0,
      copiedBytes: 5,
      failures: [],
      pathUpdates: [
        {
          mediaType: 'music',
          sourcePath: '/library/shared.wav',
          collectedPath: '/ambora-data/campaigns/id/media/music/shared.wav',
        },
        {
          mediaType: 'ambient',
          sourcePath: '/library/shared.wav',
          collectedPath: '/ambora-data/campaigns/id/media/ambient/shared.wav',
        },
        {
          mediaType: 'sfx',
          sourcePath: '/library/shared.wav',
          collectedPath: '/ambora-data/campaigns/id/media/sfx/shared.wav',
        },
      ],
    })
    mockApi.saveCampaigns.mockClear()

    const onProgress = vi.fn()
    const result = await useCampaignStore.getState().collectCampaignMedia(campaign.id, onProgress)
    const updated = useCampaignStore.getState().campaigns[0]

    expect(result?.copiedFiles).toBe(1)
    expect(updated.climates[0].tracks[0].localFilePath).toContain('/media/music/shared.wav')
    expect(updated.climates[0].ambientLayers?.[0].clips[0].localFilePath).toContain(
      '/media/ambient/shared.wav',
    )
    expect(updated.soundboard?.[0].localFilePath).toContain('/media/sfx/shared.wav')
    expect(mockApi.saveCampaigns).toHaveBeenCalledOnce()
    expect(mockApi.collectCampaignMedia).toHaveBeenCalledWith(
      expect.objectContaining({ id: campaign.id }),
      onProgress,
    )
  })
})

describe('climate CRUD', () => {
  it('creates a climate with auto-assigned color and icon', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    const climate = useCampaignStore.getState().createClimate(campaign.id, 'Forest')

    expect(climate).not.toBeNull()
    expect(climate!.name).toBe('Forest')
    expect(climate!.color).toBe(CLIMATE_COLORS[0].hex)
    expect(climate!.icon).toBe(CLIMATE_ICONS[0])
    expect(climate!.crossfadeDuration).toBe(DEFAULTS.crossfadeDuration)
  })

  it('assigns next available color and icon', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    useCampaignStore.getState().createClimate(campaign.id, 'First')
    const second = useCampaignStore.getState().createClimate(campaign.id, 'Second')

    expect(second!.color).toBe(CLIMATE_COLORS[1].hex)
    expect(second!.icon).toBe(CLIMATE_ICONS[1])
  })

  it('enforces max climates limit', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    for (let i = 0; i < DEFAULTS.maxClimates; i++) {
      useCampaignStore.getState().createClimate(campaign.id, `Climate ${i}`)
    }
    const overflow = useCampaignStore.getState().createClimate(campaign.id, 'Overflow')
    expect(overflow).toBeNull()
    expect(useCampaignStore.getState().campaigns[0].climates).toHaveLength(DEFAULTS.maxClimates)
  })

  it('updates a climate', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    const climate = useCampaignStore.getState().createClimate(campaign.id, 'Forest')!
    useCampaignStore.getState().updateClimate(campaign.id, climate.id, { name: 'Dark Forest' })

    const updated = useCampaignStore.getState().campaigns[0].climates[0]
    expect(updated.name).toBe('Dark Forest')
  })

  it('deletes a climate and reorders remaining', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    useCampaignStore.getState().createClimate(campaign.id, 'First')
    const second = useCampaignStore.getState().createClimate(campaign.id, 'Second')!
    useCampaignStore.getState().createClimate(campaign.id, 'Third')

    useCampaignStore.getState().deleteClimate(campaign.id, second.id)
    const climates = useCampaignStore.getState().campaigns[0].climates
    expect(climates).toHaveLength(2)
    expect(climates[0].order).toBe(0)
    expect(climates[1].order).toBe(1)
  })

  it('reorders climates', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    const first = useCampaignStore.getState().createClimate(campaign.id, 'First')!
    const second = useCampaignStore.getState().createClimate(campaign.id, 'Second')!

    useCampaignStore.getState().reorderClimates(campaign.id, [second.id, first.id])
    const climates = useCampaignStore.getState().campaigns[0].climates
    expect(climates[0].name).toBe('Second')
    expect(climates[0].order).toBe(0)
    expect(climates[1].name).toBe('First')
    expect(climates[1].order).toBe(1)
  })
})

describe('track CRUD', () => {
  it('adds a track to a climate', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    const climate = useCampaignStore.getState().createClimate(campaign.id, 'Forest')!

    useCampaignStore.getState().addTrack(campaign.id, climate.id, {
      title: 'Rain',
      source: 'youtube',
      youtubeVideoId: 'abc123',
      youtubeUrl: 'https://youtube.com/watch?v=abc123',
    })

    const tracks = useCampaignStore.getState().campaigns[0].climates[0].tracks
    expect(tracks).toHaveLength(1)
    expect(tracks[0].title).toBe('Rain')
    expect(tracks[0].order).toBe(0)
  })

  it('removes a track and reorders remaining', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    const climate = useCampaignStore.getState().createClimate(campaign.id, 'Forest')!

    useCampaignStore.getState().addTrack(campaign.id, climate.id, {
      title: 'Track A',
      source: 'local',
      localFilePath: '/a.mp3',
    })
    useCampaignStore.getState().addTrack(campaign.id, climate.id, {
      title: 'Track B',
      source: 'local',
      localFilePath: '/b.mp3',
    })
    useCampaignStore.getState().addTrack(campaign.id, climate.id, {
      title: 'Track C',
      source: 'local',
      localFilePath: '/c.mp3',
    })

    const trackB = useCampaignStore.getState().campaigns[0].climates[0].tracks[1]
    useCampaignStore.getState().removeTrack(campaign.id, climate.id, trackB.id)

    const tracks = useCampaignStore.getState().campaigns[0].climates[0].tracks
    expect(tracks).toHaveLength(2)
    expect(tracks[0].order).toBe(0)
    expect(tracks[1].order).toBe(1)
    expect(tracks[0].title).toBe('Track A')
    expect(tracks[1].title).toBe('Track C')
  })

  it('reorders tracks', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    const climate = useCampaignStore.getState().createClimate(campaign.id, 'Forest')!

    useCampaignStore.getState().addTrack(campaign.id, climate.id, {
      title: 'First',
      source: 'local',
      localFilePath: '/a.mp3',
    })
    useCampaignStore.getState().addTrack(campaign.id, climate.id, {
      title: 'Second',
      source: 'local',
      localFilePath: '/b.mp3',
    })

    const tracks = useCampaignStore.getState().campaigns[0].climates[0].tracks
    useCampaignStore.getState().reorderTracks(campaign.id, climate.id, [tracks[1].id, tracks[0].id])

    const reordered = useCampaignStore.getState().campaigns[0].climates[0].tracks
    expect(reordered[0].title).toBe('Second')
    expect(reordered[0].order).toBe(0)
    expect(reordered[1].title).toBe('First')
    expect(reordered[1].order).toBe(1)
  })
})

describe('soundboard CRUD', () => {
  it('relinks a sound without replacing its identity or authored settings', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    const sound = useCampaignStore.getState().addSoundboardSound(campaign.id, {
      name: 'Thunder',
      localFilePath: '/old.wav',
      volume: 65,
      shortcutKey: 't',
      playbackMode: 'loop',
      duration: 10,
    })!

    useCampaignStore.getState().relinkSoundboardSound(campaign.id, sound.id, '/new.wav', 42)

    expect(useCampaignStore.getState().campaigns[0].soundboard?.[0]).toMatchObject({
      id: sound.id,
      name: 'Thunder',
      volume: 65,
      shortcutKey: 't',
      playbackMode: 'loop',
      localFilePath: '/new.wav',
      duration: 42,
    })
  })

  it('preserves the previous duration when a relink cannot determine one', () => {
    const campaign = useCampaignStore.getState().createCampaign('Campaign')
    const sound = useCampaignStore.getState().addSoundboardSound(campaign.id, {
      name: 'Thunder',
      localFilePath: '/old.wav',
      volume: 65,
      playbackMode: 'restart',
      duration: 10,
    })!

    useCampaignStore
      .getState()
      .relinkSoundboardSound(campaign.id, sound.id, '/new-vbr.mp3', undefined)

    expect(useCampaignStore.getState().campaigns[0].soundboard?.[0]).toMatchObject({
      localFilePath: '/new-vbr.mp3',
      duration: 10,
    })
  })
})

describe('helpers', () => {
  it('getActiveCampaign returns the active campaign', () => {
    const campaign = useCampaignStore.getState().createCampaign('Active')
    useCampaignStore.getState().setActiveCampaign(campaign.id)
    expect(useCampaignStore.getState().getActiveCampaign()?.name).toBe('Active')
  })

  it('getActiveCampaign returns undefined when no active campaign', () => {
    expect(useCampaignStore.getState().getActiveCampaign()).toBeUndefined()
  })

  it('getCampaign returns a campaign by id', () => {
    const campaign = useCampaignStore.getState().createCampaign('Find Me')
    expect(useCampaignStore.getState().getCampaign(campaign.id)?.name).toBe('Find Me')
  })

  it('getCampaign returns undefined for unknown id', () => {
    expect(useCampaignStore.getState().getCampaign('nonexistent')).toBeUndefined()
  })
})
