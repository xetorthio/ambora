/**
 * v2 adds `ambientLayers` to each climate. The bump is deliberate even though
 * the field is optional: an older Ambora would import a v2 file and silently
 * drop the ambience, and "please update the app" is a better outcome than
 * quiet data loss.
 */
export const AMBORA_FILE_VERSION = 2

export const AMBORA_FILE_FILTER = {
  name: 'Ambora Campaign',
  extensions: ['ambora'],
}

export interface ExportedTrack {
  title: string
  source: 'youtube' | 'local'
  youtubeVideoId?: string
  youtubeUrl?: string
  duration?: number
  order: number
}

/**
 * Ambient clips are always local files, so — like local tracks — only the title
 * survives an export. The path is machine-specific and would be meaningless on
 * the importing side.
 */
export interface ExportedAmbientClip {
  title: string
  duration?: number
  order: number
}

export interface ExportedAmbientLayer {
  name: string
  mode: 'loop' | 'random' | 'oneshot'
  enabled: boolean
  volume: number
  clipOrder: 'shuffle' | 'random' | 'sequential'
  minDelaySec: number
  maxDelaySec: number
  order: number
  clips: ExportedAmbientClip[]
}

export interface ExportedClimate {
  name: string
  color: string
  icon: string
  order: number
  crossfadeDuration: number
  tracks: ExportedTrack[]
  ambientLayers?: ExportedAmbientLayer[]
}

export interface ExportedCampaign {
  name: string
  description?: string
  climates: ExportedClimate[]
}

export interface AmboraExportFile {
  ambora: {
    version: number
    exportedAt: string
    appVersion: string
  }
  campaign: ExportedCampaign
}
