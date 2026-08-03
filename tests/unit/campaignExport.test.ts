import { describe, it, expect } from 'vitest'
import type { Campaign } from '../../src/shared/types'
import type { AmboraExportFile } from '../../src/shared/exportTypes'
import { AMBORA_FILE_VERSION } from '../../src/shared/exportTypes'
import {
  serializeCampaignForExport,
  deserializeCampaignFromImport,
} from '../../src/renderer/src/lib/campaignExport'

const sampleCampaign: Campaign = {
  id: 'campaign-uuid-123',
  name: 'Curse of Strahd',
  description: 'Gothic horror campaign',
  climates: [
    {
      id: 'climate-uuid-456',
      name: 'Barovia Village',
      color: '#DC3545',
      icon: 'Castle',
      order: 0,
      crossfadeDuration: 4,
      tracks: [
        {
          id: 'track-uuid-789',
          title: 'Dark Ambience',
          source: 'youtube',
          youtubeVideoId: 'abc123',
          youtubeUrl: 'https://youtube.com/watch?v=abc123',
          duration: 300,
          order: 0,
        },
        {
          id: 'track-uuid-012',
          title: 'Local Track',
          source: 'local',
          localFilePath: '/Users/dm/music/tavern.mp3',
          duration: 180,
          order: 1,
        },
      ],
    },
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-06-15T12:00:00.000Z',
}

describe('serializeCampaignForExport', () => {
  it('strips IDs from campaign, climates, and tracks', () => {
    const json = serializeCampaignForExport(sampleCampaign, '0.1.0')
    const parsed = JSON.parse(json) as AmboraExportFile
    const campaign = parsed.campaign
    expect(campaign).not.toHaveProperty('id')
    expect(campaign).not.toHaveProperty('createdAt')
    expect(campaign).not.toHaveProperty('updatedAt')
    expect(campaign.climates[0]).not.toHaveProperty('id')
    expect(campaign.climates[0].tracks[0]).not.toHaveProperty('id')
    expect(campaign.climates[0].tracks[1]).not.toHaveProperty('id')
  })

  it('strips localFilePath from tracks', () => {
    const json = serializeCampaignForExport(sampleCampaign, '0.1.0')
    const parsed = JSON.parse(json) as AmboraExportFile
    const localTrack = parsed.campaign.climates[0].tracks[1]
    expect(localTrack).not.toHaveProperty('localFilePath')
  })

  it('preserves YouTube data', () => {
    const json = serializeCampaignForExport(sampleCampaign, '0.1.0')
    const parsed = JSON.parse(json) as AmboraExportFile
    const ytTrack = parsed.campaign.climates[0].tracks[0]
    expect(ytTrack.youtubeVideoId).toBe('abc123')
    expect(ytTrack.youtubeUrl).toBe('https://youtube.com/watch?v=abc123')
    expect(ytTrack.source).toBe('youtube')
    expect(ytTrack.duration).toBe(300)
  })

  it('includes correct envelope with version and app version', () => {
    const json = serializeCampaignForExport(sampleCampaign, '0.1.0')
    const parsed = JSON.parse(json) as AmboraExportFile
    expect(parsed.ambora.version).toBe(AMBORA_FILE_VERSION)
    expect(parsed.ambora.appVersion).toBe('0.1.0')
    expect(typeof parsed.ambora.exportedAt).toBe('string')
  })

  it('preserves campaign name and description', () => {
    const json = serializeCampaignForExport(sampleCampaign, '0.1.0')
    const parsed = JSON.parse(json) as AmboraExportFile
    expect(parsed.campaign.name).toBe('Curse of Strahd')
    expect(parsed.campaign.description).toBe('Gothic horror campaign')
  })
})

describe('deserializeCampaignFromImport', () => {
  function makeValidExport(): string {
    return serializeCampaignForExport(sampleCampaign, '0.1.0')
  }

  it('generates fresh UUIDs for all entities', () => {
    const result = deserializeCampaignFromImport(makeValidExport())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.campaign.id).not.toBe('campaign-uuid-123')
    expect(result.campaign.climates[0].id).not.toBe('climate-uuid-456')
    expect(result.campaign.climates[0].tracks[0].id).not.toBe('track-uuid-789')
  })

  it('generates fresh timestamps', () => {
    const result = deserializeCampaignFromImport(makeValidExport())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.campaign.createdAt).not.toBe('2025-01-01T00:00:00.000Z')
    expect(result.campaign.updatedAt).not.toBe('2025-06-15T12:00:00.000Z')
  })

  it('preserves campaign name, description, and climate structure', () => {
    const result = deserializeCampaignFromImport(makeValidExport())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.campaign.name).toBe('Curse of Strahd')
    expect(result.campaign.description).toBe('Gothic horror campaign')
    expect(result.campaign.climates).toHaveLength(1)
    expect(result.campaign.climates[0].name).toBe('Barovia Village')
    expect(result.campaign.climates[0].tracks).toHaveLength(2)
  })

  it('warns about local tracks', () => {
    const result = deserializeCampaignFromImport(makeValidExport())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('1 local track')
    expect(result.warnings[0]).toContain('Barovia Village')
  })

  it('rejects invalid JSON', () => {
    const result = deserializeCampaignFromImport('not json at all {{{')
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('Invalid JSON')
  })

  it('rejects missing envelope', () => {
    const result = deserializeCampaignFromImport(JSON.stringify({ campaign: { name: 'Test' } }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('missing envelope')
  })

  it('rejects future version', () => {
    const data = {
      ambora: { version: 999, exportedAt: '', appVersion: '99.0.0' },
      campaign: { name: 'Test', climates: [] },
    }
    const result = deserializeCampaignFromImport(JSON.stringify(data))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('newer version')
  })

  it('rejects missing campaign data', () => {
    const data = { ambora: { version: 1, exportedAt: '', appVersion: '0.1.0' } }
    const result = deserializeCampaignFromImport(JSON.stringify(data))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('missing campaign data')
  })

  it('rejects campaign without name', () => {
    const data = {
      ambora: { version: 1, exportedAt: '', appVersion: '0.1.0' },
      campaign: { name: '', climates: [] },
    }
    const result = deserializeCampaignFromImport(JSON.stringify(data))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain('no name')
  })

  it('round-trip: export then import produces equivalent data', () => {
    const json = serializeCampaignForExport(sampleCampaign, '0.1.0')
    const result = deserializeCampaignFromImport(json)
    expect(result.success).toBe(true)
    if (!result.success) return

    const imported = result.campaign
    expect(imported.name).toBe(sampleCampaign.name)
    expect(imported.description).toBe(sampleCampaign.description)
    expect(imported.climates).toHaveLength(sampleCampaign.climates.length)

    const origClimate = sampleCampaign.climates[0]
    const importedClimate = imported.climates[0]
    expect(importedClimate.name).toBe(origClimate.name)
    expect(importedClimate.color).toBe(origClimate.color)
    expect(importedClimate.icon).toBe(origClimate.icon)
    expect(importedClimate.crossfadeDuration).toBe(origClimate.crossfadeDuration)
    expect(importedClimate.tracks).toHaveLength(origClimate.tracks.length)

    const origYtTrack = origClimate.tracks[0]
    const importedYtTrack = importedClimate.tracks[0]
    expect(importedYtTrack.title).toBe(origYtTrack.title)
    expect(importedYtTrack.source).toBe('youtube')
    expect(importedYtTrack.youtubeVideoId).toBe(origYtTrack.youtubeVideoId)
    expect(importedYtTrack.youtubeUrl).toBe(origYtTrack.youtubeUrl)
    expect(importedYtTrack.duration).toBe(origYtTrack.duration)
  })

  it('importing same file twice produces different IDs', () => {
    const json = makeValidExport()
    const result1 = deserializeCampaignFromImport(json)
    const result2 = deserializeCampaignFromImport(json)
    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
    if (!result1.success || !result2.success) return
    expect(result1.campaign.id).not.toBe(result2.campaign.id)
    expect(result1.campaign.climates[0].id).not.toBe(result2.campaign.climates[0].id)
  })
})

const ambientCampaign: Campaign = {
  id: 'campaign-ambient',
  name: 'Vaesen',
  climates: [
    {
      id: 'climate-forest',
      name: 'Deep Forest',
      color: '#2D9A5D',
      icon: 'TreePine',
      order: 0,
      crossfadeDuration: 5,
      tracks: [],
      ambientLayers: [
        {
          id: 'layer-wind',
          name: 'Wind',
          mode: 'loop',
          enabled: true,
          volume: 55,
          clipOrder: 'shuffle',
          minDelaySec: 10,
          maxDelaySec: 30,
          order: 0,
          clips: [
            { id: 'clip-wind', title: 'wind.wav', localFilePath: '/dm/sfx/wind.wav', order: 0 },
          ],
        },
        {
          id: 'layer-birds',
          name: 'Birds',
          mode: 'random',
          enabled: false,
          volume: 40,
          clipOrder: 'sequential',
          minDelaySec: 8,
          maxDelaySec: 20,
          order: 1,
          clips: [
            {
              id: 'clip-b1',
              title: 'bird1.wav',
              localFilePath: '/dm/sfx/bird1.wav',
              duration: 2.5,
              order: 0,
            },
            { id: 'clip-b2', title: 'bird2.wav', localFilePath: '/dm/sfx/bird2.wav', order: 1 },
          ],
        },
      ],
    },
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

describe('ambient layer export', () => {
  it('exports layer settings without ids or file paths', () => {
    const parsed = JSON.parse(
      serializeCampaignForExport(ambientCampaign, '0.4.0'),
    ) as AmboraExportFile
    const layers = parsed.campaign.climates[0].ambientLayers!

    expect(layers).toHaveLength(2)
    expect(layers[0]).not.toHaveProperty('id')
    expect(layers[0].name).toBe('Wind')
    expect(layers[0].mode).toBe('loop')
    expect(layers[0].volume).toBe(55)
    expect(layers[1].mode).toBe('random')
    expect(layers[1].enabled).toBe(false)
    expect(layers[1].clipOrder).toBe('sequential')
    expect(layers[1].minDelaySec).toBe(8)
    expect(layers[1].maxDelaySec).toBe(20)

    for (const clip of layers.flatMap((l) => l.clips)) {
      expect(clip).not.toHaveProperty('id')
      expect(clip).not.toHaveProperty('localFilePath')
    }
    expect(layers[1].clips[0].duration).toBe(2.5)
  })

  it('omits ambientLayers entirely for a climate without any', () => {
    const parsed = JSON.parse(
      serializeCampaignForExport(sampleCampaign, '0.4.0'),
    ) as AmboraExportFile
    expect(parsed.campaign.climates[0].ambientLayers).toBeUndefined()
  })
})

describe('ambient layer import', () => {
  it('round-trips layer settings with fresh ids and empty clip paths', () => {
    const result = deserializeCampaignFromImport(
      serializeCampaignForExport(ambientCampaign, '0.4.0'),
    )
    expect(result.success).toBe(true)
    if (!result.success) return

    const layers = result.campaign.climates[0].ambientLayers!
    expect(layers.map((l) => l.name)).toEqual(['Wind', 'Birds'])
    expect(layers[0].id).not.toBe('layer-wind')
    expect(layers[1].mode).toBe('random')
    expect(layers[1].enabled).toBe(false)
    expect(layers[1].clipOrder).toBe('sequential')

    const clips = layers[1].clips
    expect(clips.map((c) => c.title)).toEqual(['bird1.wav', 'bird2.wav'])
    expect(clips.every((c) => c.localFilePath === '')).toBe(true)
    expect(clips.map((c) => c.order)).toEqual([0, 1])
  })

  it('warns about ambient clips whose files cannot travel', () => {
    const result = deserializeCampaignFromImport(
      serializeCampaignForExport(ambientCampaign, '0.4.0'),
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.warnings.some((w) => w.includes('3 ambient clips'))).toBe(true)
  })

  it('falls back to defaults for malformed layer fields', () => {
    const file = {
      ambora: { version: AMBORA_FILE_VERSION, exportedAt: '', appVersion: '0.4.0' },
      campaign: {
        name: 'Broken',
        climates: [
          {
            name: 'Odd',
            color: '#000000',
            icon: 'Swords',
            order: 0,
            crossfadeDuration: 4,
            tracks: [],
            ambientLayers: [{ mode: 'nonsense', clips: [{}] }],
          },
        ],
      },
    }

    const result = deserializeCampaignFromImport(JSON.stringify(file))
    expect(result.success).toBe(true)
    if (!result.success) return

    const layer = result.campaign.climates[0].ambientLayers![0]
    expect(layer.name).toBe('Untitled Layer')
    expect(layer.mode).toBe('loop')
    expect(layer.enabled).toBe(true)
    expect(layer.clipOrder).toBe('shuffle')
    expect(layer.clips[0].title).toBe('Untitled Clip')
  })

  it('imports a v1 file (no ambient layers) unchanged', () => {
    const file = {
      ambora: { version: 1, exportedAt: '', appVersion: '0.3.0' },
      campaign: {
        name: 'Old Campaign',
        climates: [
          {
            name: 'Tavern',
            color: '#D4943A',
            icon: 'Beer',
            order: 0,
            crossfadeDuration: 4,
            tracks: [],
          },
        ],
      },
    }

    const result = deserializeCampaignFromImport(JSON.stringify(file))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.campaign.climates[0].ambientLayers).toBeUndefined()
  })
})
