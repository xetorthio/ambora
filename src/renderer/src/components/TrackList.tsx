import { useLayoutEffect, useRef, useState } from 'react'
import { Music } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TrackListItem } from '@/components/TrackListItem'
import { moveItemId, reorderItemIds, TRACK_DRAG_TYPE, type DropPosition } from '@/lib/reorderItems'
import type { Track } from '@/lib/types'

interface TrackListProps {
  tracks: Track[]
  onDeleteTrack: (trackId: string) => void
  climateColor?: string
  onPlayTrack?: (trackId: string) => void
  onReorderTracks: (trackIds: string[]) => void
}

export function TrackList({
  tracks,
  onDeleteTrack,
  climateColor,
  onPlayTrack,
  onReorderTracks,
}: TrackListProps): React.JSX.Element {
  const sorted = [...tracks].sort((a, b) => a.order - b.order)
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    trackId: string
    position: DropPosition
  } | null>(null)
  const pendingKeyboardFocusRef = useRef<{
    trackId: string
    orderFingerprint: string
  } | null>(null)
  const gripRefs = useRef(new Map<string, HTMLButtonElement>())

  useLayoutEffect(() => {
    const pendingKeyboardFocus = pendingKeyboardFocusRef.current
    if (!pendingKeyboardFocus) return
    const orderFingerprint = sorted.map((track) => track.id).join(',')
    if (orderFingerprint !== pendingKeyboardFocus.orderFingerprint) return
    gripRefs.current.get(pendingKeyboardFocus.trackId)?.focus({ preventScroll: true })
    pendingKeyboardFocusRef.current = null
  }, [sorted])

  function clearDragState(): void {
    setDraggedTrackId(null)
    setDropTarget(null)
  }

  function handleDrop(trackId: string, position: DropPosition): void {
    if (!draggedTrackId) {
      clearDragState()
      return
    }

    const currentIds = sorted.map((track) => track.id)
    const reorderedIds = reorderItemIds(currentIds, draggedTrackId, trackId, position)
    clearDragState()
    if (reorderedIds.some((id, index) => id !== currentIds[index])) {
      onReorderTracks(reorderedIds)
    }
  }

  function handleKeyboardMove(trackId: string, offset: -1 | 1): void {
    const currentIds = sorted.map((track) => track.id)
    const reorderedIds = moveItemId(currentIds, trackId, offset)
    if (reorderedIds.some((id, index) => id !== currentIds[index])) {
      pendingKeyboardFocusRef.current = { trackId, orderFingerprint: reorderedIds.join(',') }
      onReorderTracks(reorderedIds)
    }
  }

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
      <div
        className="flex flex-col gap-0.5"
        onDragLeave={(event) => {
          if (!event.dataTransfer.types.includes(TRACK_DRAG_TYPE)) return
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTarget(null)
          }
        }}
      >
        {sorted.map((track) => (
          <TrackListItem
            key={track.id}
            track={track}
            gripRef={(element) => {
              if (element) gripRefs.current.set(track.id, element)
              else gripRefs.current.delete(track.id)
            }}
            onDelete={onDeleteTrack}
            climateColor={climateColor}
            onPlay={onPlayTrack}
            isDragging={draggedTrackId === track.id}
            dropPosition={dropTarget?.trackId === track.id ? dropTarget.position : null}
            onDragStart={(event) => {
              event.stopPropagation()
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(TRACK_DRAG_TYPE, track.id)
              const row = event.currentTarget.closest('[data-track-row]')
              if (row) {
                event.dataTransfer.setDragImage(row, 20, row.getBoundingClientRect().height / 2)
              }
              setDraggedTrackId(track.id)
            }}
            onDragEnd={clearDragState}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(TRACK_DRAG_TYPE)) return
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'move'
              const bounds = event.currentTarget.getBoundingClientRect()
              const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
              setDropTarget({ trackId: track.id, position })
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(TRACK_DRAG_TYPE)) return
              event.preventDefault()
              event.stopPropagation()
              const bounds = event.currentTarget.getBoundingClientRect()
              const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
              handleDrop(track.id, position)
            }}
            onMoveUp={() => handleKeyboardMove(track.id, -1)}
            onMoveDown={() => handleKeyboardMove(track.id, 1)}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
