import { useState } from 'react'
import { GripVertical, Youtube, Music, Trash2, Play, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDuration } from '@/lib/utils'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import type { DropPosition } from '@/lib/reorderItems'
import type { Track } from '@/lib/types'

interface TrackListItemProps {
  track: Track
  gripRef: React.Ref<HTMLButtonElement>
  onDelete: (trackId: string) => void
  climateColor?: string
  onPlay?: (trackId: string) => void
  isDragging: boolean
  dropPosition: DropPosition | null
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function TrackListItem({
  track,
  gripRef,
  onDelete,
  climateColor,
  onPlay,
  isDragging,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMoveUp,
  onMoveDown,
}: TrackListItemProps): React.JSX.Element {
  const [isRemoving, setIsRemoving] = useState(false)
  const diagnostic = useDiagnosticsStore((s) => s.unplayable[track.id])

  function handleDelete(): void {
    setIsRemoving(true)
    setTimeout(() => onDelete(track.id), 200)
  }

  return (
    <div
      data-track-row
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex h-12 min-w-0 items-center gap-2 rounded-md px-2 hover:bg-surface-2 ${isDragging ? 'opacity-40' : ''}`}
      style={{
        animation: isRemoving
          ? 'track-fade-out 200ms ease-out forwards'
          : 'track-fade-in 200ms ease-out',
        boxShadow:
          dropPosition === 'before'
            ? 'inset 0 2px 0 var(--color-accent)'
            : dropPosition === 'after'
              ? 'inset 0 -2px 0 var(--color-accent)'
              : undefined,
      }}
    >
      <button
        ref={gripRef}
        type="button"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
        aria-label={`Reorder ${track.title}. Use up and down arrow keys to move it.`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            onMoveUp()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            onMoveDown()
          }
        }}
      >
        <GripVertical className="size-3.5" />
      </button>
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
      {diagnostic && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle
                className="size-3.5 shrink-0 text-warning"
                aria-label={`Unplayable: ${diagnostic.reason}`}
              />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className="max-w-[280px]">
              <p className="font-medium">This track can&rsquo;t be played</p>
              <p className="text-text-secondary">{diagnostic.reason}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
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
