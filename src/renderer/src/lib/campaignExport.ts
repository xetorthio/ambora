import type { AmbientClip, AmbientLayer, Campaign, Climate, Track } from '@/lib/types'
import type {
  AmboraExportFile,
  ExportedAmbientClip,
  ExportedAmbientLayer,
  ExportedCampaign,
  ExportedClimate,
  ExportedTrack,
} from '../../../shared/exportTypes'
import { AMBORA_FILE_VERSION } from '../../../shared/exportTypes'
import { AMBIENT_DEFAULTS } from '@/lib/constants'

function exportTrack(track: Track): ExportedTrack {
  const exported: ExportedTrack = {
    title: track.title,
    source: track.source,
    order: track.order,
  }
  if (track.youtubeVideoId) exported.youtubeVideoId = track.youtubeVideoId
  if (track.youtubeUrl) exported.youtubeUrl = track.youtubeUrl
  if (track.duration !== undefined) exported.duration = track.duration
  return exported
}

function exportAmbientLayer(layer: AmbientLayer): ExportedAmbientLayer {
  return {
    name: layer.name,
    mode: layer.mode,
    enabled: layer.enabled,
    volume: layer.volume,
    clipOrder: layer.clipOrder,
    minDelaySec: layer.minDelaySec,
    maxDelaySec: layer.maxDelaySec,
    order: layer.order,
    // Titles only — the paths are machine-specific. The importing GM re-points
    // each clip at their own copy of the file.
    clips: layer.clips.map((clip) => {
      const exported: ExportedAmbientClip = { title: clip.title, order: clip.order }
      if (clip.duration !== undefined) exported.duration = clip.duration
      return exported
    }),
  }
}

function exportClimate(climate: Climate): ExportedClimate {
  const exported: ExportedClimate = {
    name: climate.name,
    color: climate.color,
    icon: climate.icon,
    order: climate.order,
    crossfadeDuration: climate.crossfadeDuration,
    tracks: climate.tracks.map(exportTrack),
  }
  const layers = climate.ambientLayers ?? []
  if (layers.length > 0) {
    exported.ambientLayers = layers.map(exportAmbientLayer)
  }
  return exported
}

function exportCampaign(campaign: Campaign): ExportedCampaign {
  const exported: ExportedCampaign = {
    name: campaign.name,
    climates: campaign.climates.map(exportClimate),
  }
  if (campaign.description) exported.description = campaign.description
  return exported
}

export function serializeCampaignForExport(campaign: Campaign, appVersion: string): string {
  const file: AmboraExportFile = {
    ambora: {
      version: AMBORA_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion,
    },
    campaign: exportCampaign(campaign),
  }
  return JSON.stringify(file, null, 2)
}

interface ImportSuccess {
  success: true
  campaign: Campaign
  warnings: string[]
}

interface ImportFailure {
  success: false
  error: string
}

export type ImportResult = ImportSuccess | ImportFailure

export function deserializeCampaignFromImport(raw: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { success: false, error: 'Invalid JSON file' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { success: false, error: 'Invalid file format' }
  }

  const file = parsed as Record<string, unknown>

  // Validate envelope
  if (typeof file.ambora !== 'object' || file.ambora === null) {
    return { success: false, error: 'Not an Ambora export file (missing envelope)' }
  }

  const envelope = file.ambora as Record<string, unknown>
  if (typeof envelope.version !== 'number') {
    return { success: false, error: 'Not an Ambora export file (missing version)' }
  }

  if (envelope.version > AMBORA_FILE_VERSION) {
    return {
      success: false,
      error: `This file was created with a newer version of Ambora (v${String(envelope.version)}). Please update the app to import it.`,
    }
  }

  // Validate campaign data
  if (typeof file.campaign !== 'object' || file.campaign === null) {
    return { success: false, error: 'Invalid file: missing campaign data' }
  }

  const exported = file.campaign as Record<string, unknown>
  if (typeof exported.name !== 'string' || !exported.name.trim()) {
    return { success: false, error: 'Invalid file: campaign has no name' }
  }

  const warnings: string[] = []
  const timestamp = new Date().toISOString()
  const climates: Climate[] = []

  if (Array.isArray(exported.climates)) {
    for (const rawClimate of exported.climates) {
      const cl = rawClimate as Record<string, unknown>
      let localTrackCount = 0
      const tracks: Track[] = []

      if (Array.isArray(cl.tracks)) {
        for (const rawTrack of cl.tracks) {
          const t = rawTrack as Record<string, unknown>
          const track: Track = {
            id: crypto.randomUUID(),
            title: typeof t.title === 'string' ? t.title : 'Untitled Track',
            source: t.source === 'youtube' ? 'youtube' : 'local',
            order: typeof t.order === 'number' ? t.order : tracks.length,
          }
          if (t.youtubeVideoId) track.youtubeVideoId = String(t.youtubeVideoId)
          if (t.youtubeUrl) track.youtubeUrl = String(t.youtubeUrl)
          if (typeof t.duration === 'number') track.duration = t.duration

          if (track.source === 'local') localTrackCount++

          tracks.push(track)
        }
      }

      if (localTrackCount > 0) {
        warnings.push(
          `Climate "${String(cl.name)}" has ${String(localTrackCount)} local track${localTrackCount > 1 ? 's' : ''} that cannot be imported (file paths are not portable)`,
        )
      }

      const ambientLayers: AmbientLayer[] = []
      let ambientClipCount = 0

      if (Array.isArray(cl.ambientLayers)) {
        for (const rawLayer of cl.ambientLayers) {
          const l = rawLayer as Record<string, unknown>
          const clips: AmbientClip[] = []

          if (Array.isArray(l.clips)) {
            for (const rawClip of l.clips) {
              const c = rawClip as Record<string, unknown>
              const clip: AmbientClip = {
                id: crypto.randomUUID(),
                title: typeof c.title === 'string' ? c.title : 'Untitled Clip',
                // Placeholder: the file lives on the exporting machine. The clip
                // is kept so the layer's shape survives and the UI can show the
                // GM exactly which files to re-point.
                localFilePath: '',
                order: typeof c.order === 'number' ? c.order : clips.length,
              }
              if (typeof c.duration === 'number') clip.duration = c.duration
              clips.push(clip)
            }
          }
          ambientClipCount += clips.length

          ambientLayers.push({
            id: crypto.randomUUID(),
            name: typeof l.name === 'string' ? l.name : 'Untitled Layer',
            mode: l.mode === 'random' || l.mode === 'oneshot' ? l.mode : 'loop',
            enabled: typeof l.enabled === 'boolean' ? l.enabled : true,
            volume: typeof l.volume === 'number' ? l.volume : AMBIENT_DEFAULTS.volume,
            clips,
            clipOrder:
              l.clipOrder === 'random' || l.clipOrder === 'sequential' ? l.clipOrder : 'shuffle',
            minDelaySec:
              typeof l.minDelaySec === 'number' ? l.minDelaySec : AMBIENT_DEFAULTS.minDelaySec,
            maxDelaySec:
              typeof l.maxDelaySec === 'number' ? l.maxDelaySec : AMBIENT_DEFAULTS.maxDelaySec,
            order: typeof l.order === 'number' ? l.order : ambientLayers.length,
          })
        }
      }

      if (ambientClipCount > 0) {
        warnings.push(
          `Climate "${String(cl.name)}" has ${String(ambientClipCount)} ambient clip${ambientClipCount > 1 ? 's' : ''} whose audio files must be re-added (file paths are not portable)`,
        )
      }

      climates.push({
        id: crypto.randomUUID(),
        name: typeof cl.name === 'string' ? cl.name : 'Untitled Climate',
        color: typeof cl.color === 'string' ? cl.color : '#7B93F5',
        icon: typeof cl.icon === 'string' ? cl.icon : 'Swords',
        order: typeof cl.order === 'number' ? cl.order : climates.length,
        crossfadeDuration: typeof cl.crossfadeDuration === 'number' ? cl.crossfadeDuration : 4,
        tracks,
        ...(ambientLayers.length > 0 ? { ambientLayers } : {}),
      })
    }
  }

  const campaign: Campaign = {
    id: crypto.randomUUID(),
    name: exported.name as string,
    description:
      typeof exported.description === 'string' && exported.description.trim()
        ? exported.description
        : undefined,
    climates,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  return { success: true, campaign, warnings }
}
