import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AMBIENT_DEFAULTS } from '../../src/renderer/src/lib/constants'
import type { Campaign, Climate } from '../../src/shared/types'

const mockApi = {
  getCampaigns: vi.fn(),
  saveCampaigns: vi.fn(),
}

vi.stubGlobal('window', { api: mockApi })

let useCampaignStore: typeof import('../../src/renderer/src/store/campaignStore').useCampaignStore

beforeEach(async () => {
  vi.resetModules()
  mockApi.getCampaigns.mockReset()
  mockApi.saveCampaigns.mockReset()
  const mod = await import('../../src/renderer/src/store/campaignStore')
  useCampaignStore = mod.useCampaignStore
})

/** Creates a campaign with one climate and returns both ids. */
function setup(): { campaignId: string; climateId: string } {
  const campaign = useCampaignStore.getState().createCampaign('Test Campaign')
  const climate = useCampaignStore.getState().createClimate(campaign.id, 'Forest')
  return { campaignId: campaign.id, climateId: climate!.id }
}

function getClimate(campaignId: string, climateId: string): Climate {
  const campaign = useCampaignStore.getState().campaigns.find((c: Campaign) => c.id === campaignId)!
  return campaign.climates.find((cl) => cl.id === climateId)!
}

describe('createAmbientLayer', () => {
  it('creates a Loop layer with sensible defaults', () => {
    const { campaignId, climateId } = setup()
    const layer = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Wind')

    expect(layer).not.toBeNull()
    expect(layer!.name).toBe('Wind')
    expect(layer!.mode).toBe('loop')
    expect(layer!.enabled).toBe(true)
    expect(layer!.volume).toBe(AMBIENT_DEFAULTS.volume)
    expect(layer!.clipOrder).toBe('shuffle')
    expect(layer!.clips).toEqual([])
    expect(layer!.order).toBe(0)
  })

  it('assigns ids and sequential order to seeded clips', () => {
    const { campaignId, climateId } = setup()
    const layer = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Birds', [
      { title: 'bird1.wav', localFilePath: '/a/bird1.wav' },
      { title: 'bird2.wav', localFilePath: '/a/bird2.wav', duration: 3 },
    ])!

    expect(layer.clips.map((c) => c.order)).toEqual([0, 1])
    expect(layer.clips.every((c) => c.id.length > 0)).toBe(true)
    expect(layer.clips[1].duration).toBe(3)
  })

  it('appends layers in order and persists each change', () => {
    const { campaignId, climateId } = setup()
    useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Wind')
    useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Birds')

    const layers = getClimate(campaignId, climateId).ambientLayers!
    expect(layers.map((l) => l.name)).toEqual(['Wind', 'Birds'])
    expect(layers.map((l) => l.order)).toEqual([0, 1])
    expect(mockApi.saveCampaigns).toHaveBeenCalled()
  })

  it('refuses to exceed the per-climate layer limit', () => {
    const { campaignId, climateId } = setup()
    for (let i = 0; i < AMBIENT_DEFAULTS.maxLayers; i++) {
      expect(
        useCampaignStore.getState().createAmbientLayer(campaignId, climateId, `Layer ${String(i)}`),
      ).not.toBeNull()
    }
    expect(
      useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'One too many'),
    ).toBeNull()
  })
})

describe('updateAmbientLayer', () => {
  it('applies partial updates', () => {
    const { campaignId, climateId } = setup()
    const layer = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Birds')!

    useCampaignStore
      .getState()
      .updateAmbientLayer(campaignId, climateId, layer.id, { mode: 'random', volume: 35 })

    const updated = getClimate(campaignId, climateId).ambientLayers![0]
    expect(updated.mode).toBe('random')
    expect(updated.volume).toBe(35)
    expect(updated.name).toBe('Birds')
  })

  it('pushes max up when min is raised past it', () => {
    const { campaignId, climateId } = setup()
    const layer = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Bells')!

    useCampaignStore
      .getState()
      .updateAmbientLayer(campaignId, climateId, layer.id, { minDelaySec: 120 })

    const updated = getClimate(campaignId, climateId).ambientLayers![0]
    expect(updated.minDelaySec).toBe(120)
    expect(updated.maxDelaySec).toBe(120)
  })

  it('pulls min down when max is lowered past it', () => {
    const { campaignId, climateId } = setup()
    const layer = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Bells')!

    useCampaignStore
      .getState()
      .updateAmbientLayer(campaignId, climateId, layer.id, { maxDelaySec: 3 })

    const updated = getClimate(campaignId, climateId).ambientLayers![0]
    expect(updated.maxDelaySec).toBe(3)
    expect(updated.minDelaySec).toBe(3)
  })
})

describe('deleteAmbientLayer and reorderAmbientLayers', () => {
  it('removes a layer and re-sequences the rest', () => {
    const { campaignId, climateId } = setup()
    const a = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'A')!
    useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'B')
    useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'C')

    useCampaignStore.getState().deleteAmbientLayer(campaignId, climateId, a.id)

    const layers = getClimate(campaignId, climateId).ambientLayers!
    expect(layers.map((l) => l.name)).toEqual(['B', 'C'])
    expect(layers.map((l) => l.order)).toEqual([0, 1])
  })

  it('reorders layers by the given id list', () => {
    const { campaignId, climateId } = setup()
    const a = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'A')!
    const b = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'B')!
    const c = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'C')!

    useCampaignStore.getState().reorderAmbientLayers(campaignId, climateId, [c.id, a.id, b.id])

    const layers = getClimate(campaignId, climateId).ambientLayers!
    expect(layers.map((l) => l.name)).toEqual(['C', 'A', 'B'])
    expect(layers.map((l) => l.order)).toEqual([0, 1, 2])
  })
})

describe('clip CRUD', () => {
  it('appends clips with continuing order', () => {
    const { campaignId, climateId } = setup()
    const layer = useCampaignStore
      .getState()
      .createAmbientLayer(campaignId, climateId, 'Birds', [
        { title: 'bird1.wav', localFilePath: '/a/bird1.wav' },
      ])!

    useCampaignStore.getState().addAmbientClips(campaignId, climateId, layer.id, [
      { title: 'bird2.wav', localFilePath: '/a/bird2.wav' },
      { title: 'bird3.wav', localFilePath: '/a/bird3.wav' },
    ])

    const clips = getClimate(campaignId, climateId).ambientLayers![0].clips
    expect(clips.map((c) => c.title)).toEqual(['bird1.wav', 'bird2.wav', 'bird3.wav'])
    expect(clips.map((c) => c.order)).toEqual([0, 1, 2])
  })

  it('ignores an empty clip list without persisting', () => {
    const { campaignId, climateId } = setup()
    const layer = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Birds')!
    const before = mockApi.saveCampaigns.mock.calls.length

    useCampaignStore.getState().addAmbientClips(campaignId, climateId, layer.id, [])

    expect(mockApi.saveCampaigns.mock.calls.length).toBe(before)
  })

  it('removes a clip and re-sequences the rest', () => {
    const { campaignId, climateId } = setup()
    const layer = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Birds', [
      { title: 'bird1.wav', localFilePath: '/a/bird1.wav' },
      { title: 'bird2.wav', localFilePath: '/a/bird2.wav' },
      { title: 'bird3.wav', localFilePath: '/a/bird3.wav' },
    ])!

    const middle = layer.clips[1].id
    useCampaignStore.getState().removeAmbientClip(campaignId, climateId, layer.id, middle)

    const clips = getClimate(campaignId, climateId).ambientLayers![0].clips
    expect(clips.map((c) => c.title)).toEqual(['bird1.wav', 'bird3.wav'])
    expect(clips.map((c) => c.order)).toEqual([0, 1])
  })
})

describe('copyAmbientLayer', () => {
  it('copies a layer to another climate with fresh ids', () => {
    const campaign = useCampaignStore.getState().createCampaign('Test')
    const forest = useCampaignStore.getState().createClimate(campaign.id, 'Forest')!
    const swamp = useCampaignStore.getState().createClimate(campaign.id, 'Swamp')!

    const rain = useCampaignStore
      .getState()
      .createAmbientLayer(campaign.id, forest.id, 'Rain', [
        { title: 'rain.wav', localFilePath: '/a/rain.wav' },
      ])!

    useCampaignStore.getState().copyAmbientLayer(campaign.id, forest.id, rain.id, swamp.id)

    const copy = getClimate(campaign.id, swamp.id).ambientLayers![0]
    expect(copy.name).toBe('Rain')
    expect(copy.id).not.toBe(rain.id)
    expect(copy.order).toBe(0)
    expect(copy.clips).toHaveLength(1)
    expect(copy.clips[0].id).not.toBe(rain.clips[0].id)
    expect(copy.clips[0].localFilePath).toBe('/a/rain.wav')

    // The source is untouched
    expect(getClimate(campaign.id, forest.id).ambientLayers).toHaveLength(1)
  })

  it('does nothing when the target climate is at the layer limit', () => {
    const campaign = useCampaignStore.getState().createCampaign('Test')
    const forest = useCampaignStore.getState().createClimate(campaign.id, 'Forest')!
    const swamp = useCampaignStore.getState().createClimate(campaign.id, 'Swamp')!

    const rain = useCampaignStore.getState().createAmbientLayer(campaign.id, forest.id, 'Rain')!
    for (let i = 0; i < AMBIENT_DEFAULTS.maxLayers; i++) {
      useCampaignStore.getState().createAmbientLayer(campaign.id, swamp.id, `L${String(i)}`)
    }

    useCampaignStore.getState().copyAmbientLayer(campaign.id, forest.id, rain.id, swamp.id)

    expect(getClimate(campaign.id, swamp.id).ambientLayers).toHaveLength(AMBIENT_DEFAULTS.maxLayers)
  })

  it('does nothing for an unknown layer id', () => {
    const campaign = useCampaignStore.getState().createCampaign('Test')
    const forest = useCampaignStore.getState().createClimate(campaign.id, 'Forest')!
    const swamp = useCampaignStore.getState().createClimate(campaign.id, 'Swamp')!

    useCampaignStore.getState().copyAmbientLayer(campaign.id, forest.id, 'nope', swamp.id)

    expect(getClimate(campaign.id, swamp.id).ambientLayers ?? []).toHaveLength(0)
  })
})

describe('backward compatibility', () => {
  it('treats a climate saved without ambientLayers as having none', () => {
    const { campaignId, climateId } = setup()
    const climate = getClimate(campaignId, climateId)
    expect(climate.ambientLayers).toBeUndefined()

    // Adding the first layer initialises the list rather than throwing.
    const layer = useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'Wind')
    expect(layer).not.toBeNull()
    expect(getClimate(campaignId, climateId).ambientLayers).toHaveLength(1)
  })
})

describe('fillAmbientClipDurations', () => {
  it('fills in clips missing a duration for that path', () => {
    const { campaignId, climateId } = setup()
    useCampaignStore
      .getState()
      .createAmbientLayer(campaignId, climateId, 'Animals', [
        { title: 'a.mp3', localFilePath: '/sfx/a.mp3' },
      ])

    useCampaignStore.getState().fillAmbientClipDurations('/sfx/a.mp3', 12.5)

    expect(getClimate(campaignId, climateId).ambientLayers![0].clips[0].duration).toBe(12.5)
  })

  it('fills matching clips across layers and leaves others alone', () => {
    const { campaignId, climateId } = setup()
    useCampaignStore.getState().createAmbientLayer(campaignId, climateId, 'One', [
      { title: 'a.mp3', localFilePath: '/sfx/a.mp3' },
      { title: 'b.mp3', localFilePath: '/sfx/b.mp3' },
    ])
    useCampaignStore
      .getState()
      .createAmbientLayer(campaignId, climateId, 'Two', [
        { title: 'a.mp3', localFilePath: '/sfx/a.mp3' },
      ])

    useCampaignStore.getState().fillAmbientClipDurations('/sfx/a.mp3', 4)

    const layers = getClimate(campaignId, climateId).ambientLayers!
    expect(layers[0].clips[0].duration).toBe(4)
    expect(layers[0].clips[1].duration).toBeUndefined()
    expect(layers[1].clips[0].duration).toBe(4)
  })

  it('never overwrites a duration that is already known', () => {
    const { campaignId, climateId } = setup()
    useCampaignStore
      .getState()
      .createAmbientLayer(campaignId, climateId, 'One', [
        { title: 'a.mp3', localFilePath: '/sfx/a.mp3', duration: 9 },
      ])

    useCampaignStore.getState().fillAmbientClipDurations('/sfx/a.mp3', 4)

    expect(getClimate(campaignId, climateId).ambientLayers![0].clips[0].duration).toBe(9)
  })

  it('does not persist when nothing was missing', () => {
    const { campaignId, climateId } = setup()
    useCampaignStore
      .getState()
      .createAmbientLayer(campaignId, climateId, 'One', [
        { title: 'a.mp3', localFilePath: '/sfx/a.mp3', duration: 9 },
      ])
    const before = mockApi.saveCampaigns.mock.calls.length

    useCampaignStore.getState().fillAmbientClipDurations('/sfx/a.mp3', 4)
    useCampaignStore.getState().fillAmbientClipDurations('/sfx/unknown.mp3', 4)

    expect(mockApi.saveCampaigns.mock.calls.length).toBe(before)
  })

  it('ignores non-finite or zero durations', () => {
    const { campaignId, climateId } = setup()
    useCampaignStore
      .getState()
      .createAmbientLayer(campaignId, climateId, 'One', [
        { title: 'a.mp3', localFilePath: '/sfx/a.mp3' },
      ])

    useCampaignStore.getState().fillAmbientClipDurations('/sfx/a.mp3', Infinity)
    useCampaignStore.getState().fillAmbientClipDurations('/sfx/a.mp3', 0)

    expect(getClimate(campaignId, climateId).ambientLayers![0].clips[0].duration).toBeUndefined()
  })
})
