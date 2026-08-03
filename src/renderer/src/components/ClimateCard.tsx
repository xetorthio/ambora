import { useState } from 'react'
import { Play, AlertTriangle } from 'lucide-react'
import { ICON_MAP, type ClimateIconName } from '@/lib/iconMap'
import { ACCEPTED_AUDIO_EXTENSIONS } from '@/lib/constants'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import type { Climate } from '@/lib/types'
import type { FadeAnimation } from '@/store/audioStore'

interface ClimateCardProps {
  climate: Climate
  isActive: boolean
  isSelected: boolean
  fadeAnimation?: FadeAnimation
  onClick: () => void
  onPlay: () => void
  onDropFiles: (climateId: string, files: File[]) => void
}

function hasAudioFiles(dt: DataTransfer): boolean {
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file') {
      const ext = '.' + (item.type.split('/')[1] || '').toLowerCase()
      // Also check by common mime subtypes
      if (
        ACCEPTED_AUDIO_EXTENSIONS.some((ae) => ext === ae || item.type === `audio/${ae.slice(1)}`)
      ) {
        return true
      }
      // Fallback: allow any file during dragover, filter on drop
      return true
    }
  }
  return false
}

export function ClimateCard({
  climate,
  isActive,
  isSelected,
  fadeAnimation,
  onClick,
  onPlay,
  onDropFiles,
}: ClimateCardProps): React.JSX.Element {
  const Icon = ICON_MAP[climate.icon as ClimateIconName]
  const showGlow = isActive || fadeAnimation?.direction === 'out'
  const unplayableCount = useDiagnosticsStore(
    (s) => climate.tracks.filter((t) => s.unplayable[t.id]).length,
  )
  const [isDragOver, setIsDragOver] = useState(false)
  const ambientLayerCount = (climate.ambientLayers ?? []).length
  // A climate can be ambience only — wind and birds with no score.
  const canPlay = climate.tracks.length > 0 || ambientLayerCount > 0

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (hasAudioFiles(e.dataTransfer)) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }

  function handleDragEnter(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    // Only leave if we're leaving the card entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files).filter((f) => {
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase()
      return ACCEPTED_AUDIO_EXTENSIONS.includes(ext)
    })

    if (files.length > 0) {
      onDropFiles(climate.id, files)
    }
  }

  return (
    <button
      type="button"
      aria-label={`${climate.name}, ${climate.tracks.length} ${climate.tracks.length === 1 ? 'track' : 'tracks'}${isActive ? ', playing' : ''}`}
      className="group relative flex min-h-[120px] min-w-[200px] flex-col justify-between overflow-hidden rounded-md bg-surface-2 p-4 text-left transition-colors duration-150 hover:bg-surface-3"
      style={{
        borderLeft: `3px solid ${climate.color}B3`,
        outline: isSelected ? `2px solid ${climate.color}` : undefined,
        outlineOffset: isSelected ? '-2px' : undefined,
      }}
      onClick={onClick}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Glow overlay — always rendered, opacity transitions via CSS */}
      <span
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{
          boxShadow: `inset 0 0 0 1px ${climate.color}80`,
          opacity: showGlow ? 1 : 0,
          transition: 'opacity 400ms ease-out',
        }}
      />

      {/* Drag-over overlay */}
      {isDragOver && (
        <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-accent-muted/30">
          <span className="text-[12px] font-medium text-accent">Drop to add tracks</span>
        </span>
      )}

      <div className="flex items-center gap-2">
        {Icon && <Icon className="size-6" style={{ color: climate.color }} />}
        <span className="text-[14px] font-semibold text-text-primary">{climate.name}</span>
        {/* Pulse dot — always rendered, opacity transitions */}
        <span
          className={`size-2 shrink-0 rounded-full ${isActive ? 'animate-pulse' : ''}`}
          style={{
            backgroundColor: climate.color,
            opacity: isActive ? 1 : 0,
            transition: 'opacity 400ms ease-out',
          }}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-tertiary">
            {climate.tracks.length} {climate.tracks.length === 1 ? 'track' : 'tracks'}
            {ambientLayerCount > 0 && ` · ${ambientLayerCount} ambient`}
          </span>
          {unplayableCount > 0 && (
            <span
              className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
              title={`${unplayableCount} track${unplayableCount === 1 ? '' : 's'} can't be played`}
            >
              <AlertTriangle className="size-3" />
              {unplayableCount}
            </span>
          )}
        </div>
        {canPlay && (
          <span
            role="button"
            tabIndex={0}
            className="flex size-8 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 hover:brightness-125 group-hover:opacity-100"
            style={{ backgroundColor: `${climate.color}33` }}
            onClick={(e) => {
              e.stopPropagation()
              onPlay()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                e.preventDefault()
                onPlay()
              }
            }}
          >
            <Play className="size-4" style={{ color: climate.color }} />
          </span>
        )}
      </div>

      {/* Crossfade progress bar */}
      {fadeAnimation && (
        <span
          key={fadeAnimation.startedAt}
          className="pointer-events-none absolute bottom-0 left-0 h-[3px]"
          style={{
            backgroundColor: `${climate.color}CC`,
            boxShadow: `0 0 6px ${climate.color}80`,
            animation: `${fadeAnimation.direction === 'in' ? 'bar-fill' : 'bar-drain'} ${fadeAnimation.durationMs}ms linear forwards`,
          }}
        />
      )}
    </button>
  )
}
