import { create } from 'zustand'
import type {
  AmbientClip,
  AmbientLayer,
  Campaign,
  CollectCampaignMediaResult,
  CollectMediaProgress,
  Climate,
  LoadCampaignsResult,
  SoundboardSound,
  Track,
} from '@/lib/types'
import { DEFAULTS, CLIMATE_COLORS, CLIMATE_ICONS, AMBIENT_DEFAULTS } from '@/lib/constants'
import { clampPitchVariation } from '@/audio/playbackVariation'

interface CampaignStore {
  campaigns: Campaign[]
  activeCampaignId: string | null
  isLoaded: boolean

  // Init
  loadCampaigns: () => Promise<LoadCampaignsResult>

  // Campaign CRUD
  importCampaign: (campaign: Campaign) => void
  createCampaign: (name: string, description?: string) => Campaign
  updateCampaign: (id: string, updates: Partial<Pick<Campaign, 'name' | 'description'>>) => void
  deleteCampaign: (id: string) => void
  collectCampaignMedia: (
    id: string,
    onProgress: (progress: CollectMediaProgress) => void,
  ) => Promise<CollectCampaignMediaResult | null>
  setActiveCampaign: (id: string | null) => void

  // Climate CRUD
  createClimate: (campaignId: string, name: string) => Climate | null
  updateClimate: (
    campaignId: string,
    climateId: string,
    updates: Partial<Pick<Climate, 'name' | 'color' | 'icon' | 'crossfadeDuration'>>,
  ) => void
  deleteClimate: (campaignId: string, climateId: string) => void
  reorderClimates: (campaignId: string, climateIds: string[]) => void

  // Track CRUD
  addTrack: (campaignId: string, climateId: string, track: Omit<Track, 'id' | 'order'>) => void
  removeTrack: (campaignId: string, climateId: string, trackId: string) => void
  reorderTracks: (campaignId: string, climateId: string, trackIds: string[]) => void
  updateTrackDuration: (
    campaignId: string,
    climateId: string,
    trackId: string,
    duration: number,
  ) => void

  // Ambient layer CRUD
  createAmbientLayer: (
    campaignId: string,
    climateId: string,
    name: string,
    clips?: Omit<AmbientClip, 'id' | 'order'>[],
  ) => AmbientLayer | null
  updateAmbientLayer: (
    campaignId: string,
    climateId: string,
    layerId: string,
    updates: Partial<Omit<AmbientLayer, 'id' | 'clips' | 'order'>>,
  ) => void
  deleteAmbientLayer: (campaignId: string, climateId: string, layerId: string) => void
  reorderAmbientLayers: (campaignId: string, climateId: string, layerIds: string[]) => void
  addAmbientClips: (
    campaignId: string,
    climateId: string,
    layerId: string,
    clips: Omit<AmbientClip, 'id' | 'order'>[],
  ) => void
  removeAmbientClip: (
    campaignId: string,
    climateId: string,
    layerId: string,
    clipId: string,
  ) => void
  copyAmbientLayer: (
    campaignId: string,
    fromClimateId: string,
    layerId: string,
    toClimateId: string,
  ) => void
  /**
   * Fills in the length of every clip pointing at `localFilePath` that doesn't
   * have one yet. Keyed by path rather than clip id because the duration comes
   * from decoding the file, which is shared across clips and campaigns.
   */
  fillAmbientClipDurations: (localFilePath: string, duration: number) => void

  // Campaign soundboard CRUD
  addSoundboardSound: (
    campaignId: string,
    sound: Omit<SoundboardSound, 'id' | 'order'>,
  ) => SoundboardSound | null
  updateSoundboardSound: (
    campaignId: string,
    soundId: string,
    updates: Partial<
      Pick<
        SoundboardSound,
        'name' | 'volume' | 'shortcutKey' | 'icon' | 'iconColor' | 'playbackMode' | 'pitchVariation'
      >
    >,
  ) => void
  relinkSoundboardSound: (
    campaignId: string,
    soundId: string,
    localFilePath: string,
    duration?: number,
  ) => void
  deleteSoundboardSound: (campaignId: string, soundId: string) => void

  // Helpers
  getActiveCampaign: () => Campaign | undefined
  getCampaign: (id: string) => Campaign | undefined
}

function layersOf(climate: Climate): AmbientLayer[] {
  return climate.ambientLayers ?? []
}

/** Fresh ids and orders, so a copied layer is fully independent of its source. */
function cloneLayer(layer: AmbientLayer, order: number): AmbientLayer {
  return {
    ...layer,
    id: crypto.randomUUID(),
    order,
    clips: layer.clips.map((clip, i) => ({ ...clip, id: crypto.randomUUID(), order: i })),
  }
}

function persist(campaigns: Campaign[]): void {
  window.api.saveCampaigns(campaigns)
}

function now(): string {
  return new Date().toISOString()
}

function mapClimate(
  campaigns: Campaign[],
  campaignId: string,
  climateId: string,
  fn: (climate: Climate) => Climate,
): Campaign[] {
  return campaigns.map((c) =>
    c.id === campaignId
      ? {
          ...c,
          climates: c.climates.map((cl) => (cl.id === climateId ? fn(cl) : cl)),
          updatedAt: now(),
        }
      : c,
  )
}

function mapLayer(
  climate: Climate,
  layerId: string,
  fn: (layer: AmbientLayer) => AmbientLayer,
): Climate {
  return {
    ...climate,
    ambientLayers: layersOf(climate).map((l) => (l.id === layerId ? fn(l) : l)),
  }
}

function normalizePitchVariation(campaign: Campaign): Campaign {
  return {
    ...campaign,
    ...(campaign.soundboard
      ? {
          soundboard: campaign.soundboard.map((sound) =>
            sound.pitchVariation === undefined
              ? sound
              : { ...sound, pitchVariation: clampPitchVariation(sound.pitchVariation) },
          ),
        }
      : {}),
    climates: campaign.climates.map((climate) => ({
      ...climate,
      ...(climate.ambientLayers
        ? {
            ambientLayers: climate.ambientLayers.map((layer) =>
              layer.pitchVariation === undefined
                ? layer
                : { ...layer, pitchVariation: clampPitchVariation(layer.pitchVariation) },
            ),
          }
        : {}),
    })),
  }
}

function mediaKey(mediaType: 'music' | 'ambient' | 'sfx', localFilePath: string): string {
  return `${mediaType}\0${localFilePath}`
}

function replaceLocalPaths(campaign: Campaign, replacements: Map<string, string>): Campaign {
  return {
    ...campaign,
    climates: campaign.climates.map((climate) => ({
      ...climate,
      tracks: climate.tracks.map((track) => {
        if (track.source !== 'local' || !track.localFilePath) return track
        const replacement = replacements.get(mediaKey('music', track.localFilePath))
        return replacement
          ? {
              ...track,
              localFilePath: replacement,
            }
          : track
      }),
      ...(climate.ambientLayers
        ? {
            ambientLayers: climate.ambientLayers.map((layer) => ({
              ...layer,
              clips: layer.clips.map((clip) => {
                const replacement = replacements.get(mediaKey('ambient', clip.localFilePath))
                return replacement
                  ? {
                      ...clip,
                      localFilePath: replacement,
                    }
                  : clip
              }),
            })),
          }
        : {}),
    })),
    ...(campaign.soundboard
      ? {
          soundboard: campaign.soundboard.map((sound) => {
            const replacement = replacements.get(mediaKey('sfx', sound.localFilePath))
            return replacement
              ? {
                  ...sound,
                  localFilePath: replacement,
                }
              : sound
          }),
        }
      : {}),
  }
}

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  campaigns: [],
  activeCampaignId: null,
  isLoaded: false,

  loadCampaigns: async () => {
    const result = await window.api.getCampaigns()
    const campaigns = result.campaigns.map(normalizePitchVariation)
    set({ campaigns, isLoaded: true })
    return { ...result, campaigns }
  },

  importCampaign: (campaign) => {
    const campaigns = [...get().campaigns, normalizePitchVariation(campaign)]
    set({ campaigns })
    persist(campaigns)
  },

  createCampaign: (name, description) => {
    const campaign: Campaign = {
      id: crypto.randomUUID(),
      name,
      description,
      climates: [],
      createdAt: now(),
      updatedAt: now(),
    }
    const campaigns = [...get().campaigns, campaign]
    set({ campaigns })
    persist(campaigns)
    return campaign
  },

  updateCampaign: (id, updates) => {
    const campaigns = get().campaigns.map((c) =>
      c.id === id ? { ...c, ...updates, updatedAt: now() } : c,
    )
    set({ campaigns })
    persist(campaigns)
  },

  deleteCampaign: (id) => {
    const campaigns = get().campaigns.filter((c) => c.id !== id)
    const activeCampaignId = get().activeCampaignId === id ? null : get().activeCampaignId
    set({ campaigns, activeCampaignId })
    persist(campaigns)
  },

  collectCampaignMedia: async (id, onProgress) => {
    const campaign = get().campaigns.find((candidate) => candidate.id === id)
    if (!campaign) return null

    const result = await window.api.collectCampaignMedia(campaign, onProgress)
    if (result.pathUpdates.length === 0) return result

    const replacements = new Map(
      result.pathUpdates.map(({ mediaType, sourcePath, collectedPath }) => [
        mediaKey(mediaType, sourcePath),
        collectedPath,
      ]),
    )
    const campaigns = get().campaigns.map((candidate) =>
      candidate.id === id
        ? { ...replaceLocalPaths(candidate, replacements), updatedAt: now() }
        : candidate,
    )
    set({ campaigns })
    persist(campaigns)
    return result
  },

  setActiveCampaign: (id) => {
    set({ activeCampaignId: id })
  },

  createClimate: (campaignId, name) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId)
    if (!campaign || campaign.climates.length >= DEFAULTS.maxClimates) {
      return null
    }

    const usedColors = new Set(campaign.climates.map((cl) => cl.color))
    const availableColor =
      CLIMATE_COLORS.find((c) => !usedColors.has(c.hex))?.hex ?? CLIMATE_COLORS[0].hex

    const usedIcons = new Set(campaign.climates.map((cl) => cl.icon))
    const availableIcon = CLIMATE_ICONS.find((i) => !usedIcons.has(i)) ?? CLIMATE_ICONS[0]

    const climate: Climate = {
      id: crypto.randomUUID(),
      name,
      color: availableColor,
      icon: availableIcon,
      tracks: [],
      order: campaign.climates.length,
      crossfadeDuration: DEFAULTS.crossfadeDuration,
    }

    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId ? { ...c, climates: [...c.climates, climate], updatedAt: now() } : c,
    )
    set({ campaigns })
    persist(campaigns)
    return climate
  },

  updateClimate: (campaignId, climateId, updates) => {
    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId
        ? {
            ...c,
            climates: c.climates.map((cl) => (cl.id === climateId ? { ...cl, ...updates } : cl)),
            updatedAt: now(),
          }
        : c,
    )
    set({ campaigns })
    persist(campaigns)
  },

  deleteClimate: (campaignId, climateId) => {
    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId
        ? {
            ...c,
            climates: c.climates
              .filter((cl) => cl.id !== climateId)
              .map((cl, i) => ({ ...cl, order: i })),
            updatedAt: now(),
          }
        : c,
    )
    set({ campaigns })
    persist(campaigns)
  },

  reorderClimates: (campaignId, climateIds) => {
    const campaigns = get().campaigns.map((c) => {
      if (c.id !== campaignId) return c
      const climateMap = new Map(c.climates.map((cl) => [cl.id, cl]))
      const reordered = climateIds
        .map((id, i) => {
          const cl = climateMap.get(id)
          return cl ? { ...cl, order: i } : null
        })
        .filter((cl): cl is Climate => cl !== null)
      return { ...c, climates: reordered, updatedAt: now() }
    })
    set({ campaigns })
    persist(campaigns)
  },

  addTrack: (campaignId, climateId, track) => {
    const newTrack: Track = {
      ...track,
      id: crypto.randomUUID(),
      order: 0, // will be set below
    }

    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId
        ? {
            ...c,
            climates: c.climates.map((cl) => {
              if (cl.id !== climateId) return cl
              const withTrack = { ...newTrack, order: cl.tracks.length }
              return { ...cl, tracks: [...cl.tracks, withTrack] }
            }),
            updatedAt: now(),
          }
        : c,
    )
    set({ campaigns })
    persist(campaigns)
  },

  removeTrack: (campaignId, climateId, trackId) => {
    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId
        ? {
            ...c,
            climates: c.climates.map((cl) =>
              cl.id === climateId
                ? {
                    ...cl,
                    tracks: cl.tracks
                      .filter((t) => t.id !== trackId)
                      .map((t, i) => ({ ...t, order: i })),
                  }
                : cl,
            ),
            updatedAt: now(),
          }
        : c,
    )
    set({ campaigns })
    persist(campaigns)
  },

  reorderTracks: (campaignId, climateId, trackIds) => {
    const campaigns = get().campaigns.map((c) => {
      if (c.id !== campaignId) return c
      return {
        ...c,
        climates: c.climates.map((cl) => {
          if (cl.id !== climateId) return cl
          const trackMap = new Map(cl.tracks.map((t) => [t.id, t]))
          const reordered = trackIds
            .map((id, i) => {
              const t = trackMap.get(id)
              return t ? { ...t, order: i } : null
            })
            .filter((t): t is Track => t !== null)
          return { ...cl, tracks: reordered }
        }),
        updatedAt: now(),
      }
    })
    set({ campaigns })
    persist(campaigns)
  },

  updateTrackDuration: (campaignId, climateId, trackId, duration) => {
    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId
        ? {
            ...c,
            climates: c.climates.map((cl) =>
              cl.id === climateId
                ? {
                    ...cl,
                    tracks: cl.tracks.map((t) => (t.id === trackId ? { ...t, duration } : t)),
                  }
                : cl,
            ),
          }
        : c,
    )
    set({ campaigns })
    persist(campaigns)
  },

  createAmbientLayer: (campaignId, climateId, name, clips = []) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId)
    const climate = campaign?.climates.find((cl) => cl.id === climateId)
    if (!climate || layersOf(climate).length >= AMBIENT_DEFAULTS.maxLayers) {
      return null
    }

    const layer: AmbientLayer = {
      id: crypto.randomUUID(),
      name,
      // Loop is the right default: a single dropped file is almost always a bed
      // (wind, rain, tavern murmur) rather than a punctuating event.
      mode: 'loop',
      enabled: true,
      volume: AMBIENT_DEFAULTS.volume,
      pitchVariation: AMBIENT_DEFAULTS.pitchVariation,
      clips: clips.map((clip, i) => ({ ...clip, id: crypto.randomUUID(), order: i })),
      clipOrder: 'shuffle',
      minDelaySec: AMBIENT_DEFAULTS.minDelaySec,
      maxDelaySec: AMBIENT_DEFAULTS.maxDelaySec,
      order: layersOf(climate).length,
    }

    const campaigns = mapClimate(get().campaigns, campaignId, climateId, (cl) => ({
      ...cl,
      ambientLayers: [...layersOf(cl), layer],
    }))
    set({ campaigns })
    persist(campaigns)
    return layer
  },

  updateAmbientLayer: (campaignId, climateId, layerId, updates) => {
    const campaigns = mapClimate(get().campaigns, campaignId, climateId, (cl) =>
      mapLayer(cl, layerId, (layer) => {
        const next = { ...layer, ...updates }
        if (updates.pitchVariation !== undefined) {
          next.pitchVariation = clampPitchVariation(updates.pitchVariation)
        }
        // Keep the window valid however the two fields are edited, so scheduling
        // never sees max < min.
        if (updates.minDelaySec !== undefined && next.maxDelaySec < next.minDelaySec) {
          next.maxDelaySec = next.minDelaySec
        }
        if (updates.maxDelaySec !== undefined && next.minDelaySec > next.maxDelaySec) {
          next.minDelaySec = next.maxDelaySec
        }
        return next
      }),
    )
    set({ campaigns })
    persist(campaigns)
  },

  deleteAmbientLayer: (campaignId, climateId, layerId) => {
    const campaigns = mapClimate(get().campaigns, campaignId, climateId, (cl) => ({
      ...cl,
      ambientLayers: layersOf(cl)
        .filter((l) => l.id !== layerId)
        .map((l, i) => ({ ...l, order: i })),
    }))
    set({ campaigns })
    persist(campaigns)
  },

  reorderAmbientLayers: (campaignId, climateId, layerIds) => {
    const campaigns = mapClimate(get().campaigns, campaignId, climateId, (cl) => {
      const byId = new Map(layersOf(cl).map((l) => [l.id, l]))
      const reordered = layerIds
        .map((id, i) => {
          const layer = byId.get(id)
          return layer ? { ...layer, order: i } : null
        })
        .filter((l): l is AmbientLayer => l !== null)
      return { ...cl, ambientLayers: reordered }
    })
    set({ campaigns })
    persist(campaigns)
  },

  addAmbientClips: (campaignId, climateId, layerId, clips) => {
    if (clips.length === 0) return
    const campaigns = mapClimate(get().campaigns, campaignId, climateId, (cl) =>
      mapLayer(cl, layerId, (layer) => ({
        ...layer,
        clips: [
          ...layer.clips,
          ...clips.map((clip, i) => ({
            ...clip,
            id: crypto.randomUUID(),
            order: layer.clips.length + i,
          })),
        ],
      })),
    )
    set({ campaigns })
    persist(campaigns)
  },

  removeAmbientClip: (campaignId, climateId, layerId, clipId) => {
    const campaigns = mapClimate(get().campaigns, campaignId, climateId, (cl) =>
      mapLayer(cl, layerId, (layer) => ({
        ...layer,
        clips: layer.clips.filter((c) => c.id !== clipId).map((c, i) => ({ ...c, order: i })),
      })),
    )
    set({ campaigns })
    persist(campaigns)
  },

  copyAmbientLayer: (campaignId, fromClimateId, layerId, toClimateId) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId)
    const source = campaign?.climates.find((cl) => cl.id === fromClimateId)
    const layer = source && layersOf(source).find((l) => l.id === layerId)
    if (!layer) return

    const target = campaign?.climates.find((cl) => cl.id === toClimateId)
    if (!target || layersOf(target).length >= AMBIENT_DEFAULTS.maxLayers) return

    const campaigns = mapClimate(get().campaigns, campaignId, toClimateId, (cl) => ({
      ...cl,
      ambientLayers: [...layersOf(cl), cloneLayer(layer, layersOf(cl).length)],
    }))
    set({ campaigns })
    persist(campaigns)
  },

  fillAmbientClipDurations: (localFilePath, duration) => {
    if (!Number.isFinite(duration) || duration <= 0) return

    let changed = false
    const campaigns = get().campaigns.map((c) => ({
      ...c,
      climates: c.climates.map((cl) => {
        if (!cl.ambientLayers) return cl
        return {
          ...cl,
          ambientLayers: cl.ambientLayers.map((layer) => ({
            ...layer,
            clips: layer.clips.map((clip) => {
              if (clip.localFilePath !== localFilePath || clip.duration !== undefined) return clip
              changed = true
              return { ...clip, duration }
            }),
          })),
        }
      }),
    }))

    // Every decode would otherwise rewrite the whole campaign list and republish
    // it to the phone, even when nothing was missing.
    if (!changed) return
    set({ campaigns })
    persist(campaigns)
  },

  addSoundboardSound: (campaignId, sound) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId)
    if (!campaign) return null
    const current = campaign.soundboard ?? []
    const created: SoundboardSound = {
      ...sound,
      id: crypto.randomUUID(),
      order: current.length,
    }
    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId ? { ...c, soundboard: [...current, created], updatedAt: now() } : c,
    )
    set({ campaigns })
    persist(campaigns)
    return created
  },

  updateSoundboardSound: (campaignId, soundId, updates) => {
    const safeUpdates =
      updates.pitchVariation === undefined
        ? updates
        : { ...updates, pitchVariation: clampPitchVariation(updates.pitchVariation) }
    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId
        ? {
            ...c,
            soundboard: (c.soundboard ?? []).map((sound) =>
              sound.id === soundId ? { ...sound, ...safeUpdates } : sound,
            ),
            updatedAt: now(),
          }
        : c,
    )
    set({ campaigns })
    persist(campaigns)
  },

  relinkSoundboardSound: (campaignId, soundId, localFilePath, duration) => {
    const campaigns = get().campaigns.map((campaign) =>
      campaign.id === campaignId
        ? {
            ...campaign,
            soundboard: (campaign.soundboard ?? []).map((sound) =>
              sound.id === soundId
                ? {
                    ...sound,
                    localFilePath,
                    ...(duration === undefined ? {} : { duration }),
                  }
                : sound,
            ),
            updatedAt: now(),
          }
        : campaign,
    )
    set({ campaigns })
    persist(campaigns)
  },

  deleteSoundboardSound: (campaignId, soundId) => {
    const campaigns = get().campaigns.map((c) =>
      c.id === campaignId
        ? {
            ...c,
            soundboard: (c.soundboard ?? [])
              .filter((sound) => sound.id !== soundId)
              .map((sound, order) => ({ ...sound, order })),
            updatedAt: now(),
          }
        : c,
    )
    set({ campaigns })
    persist(campaigns)
  },

  getActiveCampaign: () => {
    const { campaigns, activeCampaignId } = get()
    return campaigns.find((c) => c.id === activeCampaignId)
  },

  getCampaign: (id) => {
    return get().campaigns.find((c) => c.id === id)
  },
}))
