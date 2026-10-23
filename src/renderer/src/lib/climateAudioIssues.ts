import type { Climate } from '@/lib/types'
import type { TrackDiagnostic } from '@/store/diagnosticsStore'

export interface ClimateAudioIssues {
  trackCount: number
  clipCount: number
  total: number
  summary: string
}

/** Summarizes all audio assets on a climate which cannot currently be played. */
export function climateAudioIssues(
  climate: Climate,
  unplayable: Readonly<Record<string, TrackDiagnostic>>,
): ClimateAudioIssues {
  const trackCount = climate.tracks.filter(
    (track) => unplayable[track.id] || (track.source === 'local' && !track.localFilePath?.trim()),
  ).length
  const clipCount = (climate.ambientLayers ?? [])
    .flatMap((layer) => layer.clips)
    .filter((clip) => unplayable[clip.id] || !clip.localFilePath.trim()).length
  const total = trackCount + clipCount
  const summary = [
    trackCount > 0 ? `${String(trackCount)} unplayable track${trackCount === 1 ? '' : 's'}` : '',
    clipCount > 0
      ? `${String(clipCount)} missing or unplayable ambient clip${clipCount === 1 ? '' : 's'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return { trackCount, clipCount, total, summary }
}
