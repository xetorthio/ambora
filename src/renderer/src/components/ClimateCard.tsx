import { useState } from 'react'
import { Play, Square, AlertTriangle, Copy, Plus } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { ICON_MAP, type ClimateIconName } from '@/lib/iconMap'
import { ACCEPTED_AUDIO_EXTENSIONS } from '@/lib/constants'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import { useAudioStore } from '@/store/audioStore'
import { useCampaignStore } from '@/store/campaignStore'
import { AmbientEngine } from '@/audio/AmbientEngine'
import { climateAudioIssues } from '@/lib/climateAudioIssues'
import type { Climate } from '@/lib/types'
import type { FadeAnimation } from '@/store/audioStore'

interface ClimateCardProps {
  campaignId: string
  climate: Climate
  isActive: boolean
  isSelected: boolean
  fadeAnimation?: FadeAnimation
  onClick: () => void
  onPlay: () => void
  onDuplicate: () => void
  onDropFiles: (climateId: string, files: File[]) => void | Promise<void>
  isReordering: boolean
  isReorderTarget: boolean
  onReorderDragStart: (climateId: string) => void
  onReorderDragEnter: (climateId: string) => void
  onReorderDrop: (climateId: string) => void
  onReorderDragEnd: () => void
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
  campaignId,
  climate,
  isActive,
  isSelected,
  fadeAnimation,
  onClick,
  onPlay,
  onDuplicate,
  onDropFiles,
  isReordering,
  isReorderTarget,
  onReorderDragStart,
  onReorderDragEnter,
  onReorderDrop,
  onReorderDragEnd,
}: ClimateCardProps): React.JSX.Element {
  const Icon = ICON_MAP[climate.icon as ClimateIconName]
  const showGlow = isActive || fadeAnimation?.direction === 'out'
  const unplayable = useDiagnosticsStore((s) => s.unplayable)
  const [isDragOver, setIsDragOver] = useState(false)
  const [ambientExpanded, setAmbientExpanded] = useState(false)
  const updateAmbientLayer = useCampaignStore((s) => s.updateAmbientLayer)
  const ambientRuntime = useAudioStore((s) => s.ambientRuntime)
  const ambientLayerCount = (climate.ambientLayers ?? []).length
  const ambientLayers = [...(climate.ambientLayers ?? [])].sort((a, b) => a.order - b.order)
  const issues = climateAudioIssues(climate, unplayable)
  // A climate can be ambience only — wind and birds with no score.
  const canPlay = climate.tracks.length > 0 || ambientLayerCount > 0

  function handleAmbientToggle(layerId: string, enabled: boolean): void {
    updateAmbientLayer(campaignId, climate.id, layerId, { enabled })
    if (isActive) AmbientEngine.getInstance().setLayerEnabled(layerId, enabled)
  }

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (isReordering) {
      e.dataTransfer.dropEffect = 'move'
      return
    }
    if (hasAudioFiles(e.dataTransfer)) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }

  function handleDragEnter(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (isReordering) {
      onReorderDragEnter(climate.id)
      return
    }
    if (!hasAudioFiles(e.dataTransfer)) return
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

    if (isReordering) {
      onReorderDrop(climate.id)
      return
    }

    const files = Array.from(e.dataTransfer.files).filter((f) => {
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase()
      return ACCEPTED_AUDIO_EXTENSIONS.includes(ext)
    })

    if (files.length > 0) {
      onDropFiles(climate.id, files)
    }
  }

  return (
    <article
      draggable
      className={`group relative flex min-h-[120px] min-w-[200px] flex-col justify-between overflow-hidden rounded-md bg-surface-2 p-4 text-left transition-colors duration-150 hover:bg-surface-3 ${isReordering ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{
        borderLeft: `3px solid ${climate.color}B3`,
        outline: isReorderTarget
          ? `2px dashed ${climate.color}`
          : isSelected
            ? `2px solid ${climate.color}`
            : undefined,
        outlineOffset: isReorderTarget || isSelected ? '-2px' : undefined,
      }}
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest('[data-no-climate-drag]')) {
          event.preventDefault()
          return
        }
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-ambora-climate', climate.id)
        onReorderDragStart(climate.id)
      }}
      onDragEnd={() => {
        setIsDragOver(false)
        onReorderDragEnd()
      }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        type="button"
        data-no-climate-drag
        className="absolute inset-0 z-0 rounded-md"
        aria-label={`${climate.name}, ${climate.tracks.length} ${climate.tracks.length === 1 ? 'track' : 'tracks'}${isActive ? ', playing' : ''}`}
        onClick={onClick}
      />
      <button
        type="button"
        data-no-climate-drag
        className="absolute top-2 right-2 z-20 flex size-7 items-center justify-center rounded text-text-tertiary opacity-0 transition-opacity hover:bg-surface-1 hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Duplicate ${climate.name}`}
        title="Duplicate climate"
        onClick={(event) => {
          event.stopPropagation()
          onDuplicate()
        }}
      >
        <Copy className="size-3.5" />
      </button>
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

      <div className="pointer-events-none relative z-10 flex flex-col gap-1.5">
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
        <div className={`flex items-center gap-2 ${issues.total > 0 ? '' : 'pl-8'}`}>
          {issues.total > 0 && (
            <span
              className="pointer-events-auto shrink-0 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
              title={issues.summary}
            >
              <span className="flex items-center gap-1">
                <AlertTriangle className="size-3" />
                {issues.total}
              </span>
            </span>
          )}
          <span className="text-[11px] text-text-tertiary">
            {climate.tracks.length} {climate.tracks.length === 1 ? 'track' : 'tracks'}
            {ambientLayerCount > 0 && ` · ${ambientLayerCount} ambient`}
          </span>
        </div>
      </div>
      <div className="relative z-10 flex items-center justify-between">
        {ambientLayerCount > 0 ? (
          <PopoverPrimitive.Root open={ambientExpanded} onOpenChange={setAmbientExpanded}>
            <PopoverPrimitive.Trigger asChild>
              <button
                type="button"
                data-no-climate-drag
                className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-surface-1"
                style={{ backgroundColor: ambientExpanded ? `${climate.color}33` : undefined }}
                aria-label={`${ambientExpanded ? 'Hide' : 'Show'} ambient controls for ${climate.name}`}
                title="Ambient controls"
                onClick={(event) => event.stopPropagation()}
              >
                <Plus
                  className={`size-4 transition-transform ${ambientExpanded ? 'rotate-45' : ''}`}
                  style={{ color: climate.color }}
                />
              </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                side="top"
                align="start"
                sideOffset={8}
                collisionPadding={12}
                data-no-climate-drag
                className="z-50 flex w-56 flex-col gap-1 rounded-md border bg-surface-2 p-2 shadow-lg outline-none"
                style={{ borderColor: climate.color }}
                onClick={(event) => event.stopPropagation()}
              >
                {ambientLayers.map((layer) => {
                  const isTriggered = layer.mode === 'oneshot'
                  const enabled = isActive
                    ? (ambientRuntime[layer.id]?.enabled ?? layer.enabled)
                    : layer.enabled
                  const sounding = ambientRuntime[layer.id]?.sounding ?? false
                  return (
                    <div
                      key={layer.id}
                      className="flex min-h-8 items-center gap-2 rounded px-1.5 text-[12px] text-text-secondary hover:bg-surface-3"
                    >
                      {isTriggered ? (
                        <button
                          type="button"
                          data-no-climate-drag
                          disabled={!isActive || layer.clips.length === 0}
                          className="flex size-6 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary focus-visible:bg-surface-3 focus-visible:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`${sounding ? 'Stop' : 'Play'} ${layer.name}`}
                          title={`${sounding ? 'Stop' : 'Play'} ${layer.name}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (sounding) AmbientEngine.getInstance().stopTriggeredLayer(layer.id)
                            else AmbientEngine.getInstance().triggerLayer(layer.id)
                          }}
                        >
                          {sounding ? (
                            <Square
                              className="size-3 fill-current"
                              style={{ color: climate.color }}
                            />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          data-no-climate-drag
                          aria-checked={enabled}
                          aria-label={`${enabled ? 'Disable' : 'Enable'} ${layer.name}`}
                          className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-surface-1"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleAmbientToggle(layer.id, !enabled)
                          }}
                        >
                          <span
                            className={`size-3 rounded-full border-2 ${enabled ? 'border-transparent' : 'border-text-tertiary'}`}
                            style={enabled ? { backgroundColor: climate.color } : undefined}
                          />
                        </button>
                      )}
                      <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                    </div>
                  )
                })}
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          </PopoverPrimitive.Root>
        ) : (
          <span />
        )}
        {canPlay && (
          <button
            type="button"
            data-no-climate-drag
            className="flex size-9 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
            aria-label={`${isActive ? 'Stop' : 'Play'} ${climate.name}`}
            title={`${isActive ? 'Stop' : 'Play'} climate`}
            style={{ backgroundColor: `${climate.color}33` }}
            onClick={(event) => {
              event.stopPropagation()
              onPlay()
            }}
          >
            {isActive ? (
              <Square className="size-3.5 fill-current" style={{ color: climate.color }} />
            ) : (
              <Play className="size-4" style={{ color: climate.color }} />
            )}
          </button>
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
    </article>
  )
}
