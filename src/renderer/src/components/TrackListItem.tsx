import { useState } from 'react'
import { GripVertical, Youtube, Music, Trash2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/utils'
import type { Track } from '@/lib/types'

interface TrackListItemProps {
  track: Track
  onDelete: (trackId: string) => void
  climateColor?: string
  onPlay?: (trackId: string) => void
}

export function TrackListItem({
  track,
  onDelete,
  climateColor,
  onPlay,
}: TrackListItemProps): React.JSX.Element {
  const [isRemoving, setIsRemoving] = useState(false)

  function handleDelete(): void {
    setIsRemoving(true)
    setTimeout(() => onDelete(track.id), 200)
  }

  return (
    <div
      className="group flex h-12 min-w-0 items-center gap-2 rounded-md px-2 hover:bg-surface-2"
      style={{
        animation: isRemoving
          ? 'track-fade-out 200ms ease-out forwards'
          : 'track-fade-in 200ms ease-out',
      }}
    >
      <GripVertical className="size-3.5 shrink-0 text-text-tertiary" />
      {onPlay && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          style={{ color: climateColor }}
          onClick={() => onPlay(track.id)}
          aria-label={`Play ${track.title}`}
        >
          <Play className="size-3.5" />
        </Button>
      )}
      {track.source === 'youtube' ? (
        <Youtube className="size-4 shrink-0 text-text-secondary" />
      ) : (
        <Music className="size-4 shrink-0 text-text-secondary" />
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">{track.title}</span>
      <span className="shrink-0 text-[13px] text-text-tertiary">
        {formatDuration(track.duration)}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-text-tertiary hover:text-danger"
        onClick={handleDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
