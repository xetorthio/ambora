import { Music } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TrackListItem } from '@/components/TrackListItem'
import type { Track } from '@/lib/types'

interface TrackListProps {
  tracks: Track[]
  onDeleteTrack: (trackId: string) => void
  climateColor?: string
  onPlayTrack?: (trackId: string) => void
}

export function TrackList({
  tracks,
  onDeleteTrack,
  climateColor,
  onPlayTrack,
}: TrackListProps): React.JSX.Element {
  const sorted = [...tracks].sort((a, b) => a.order - b.order)

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-text-tertiary">
        <Music className="size-8" />
        <p className="text-[13px]">No tracks yet</p>
      </div>
    )
  }

  return (
    <ScrollArea>
      <div className="flex flex-col gap-0.5">
        {sorted.map((track) => (
          <TrackListItem
            key={track.id}
            track={track}
            onDelete={onDeleteTrack}
            climateColor={climateColor}
            onPlay={onPlayTrack}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
