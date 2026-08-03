import { useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Play,
  Plus,
  Square,
  Trash2,
  Waves,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AmbientActivity } from '@/components/AmbientActivity'
import { AmbientEngine } from '@/audio/AmbientEngine'
import { useAudioStore } from '@/store/audioStore'
import { useCampaignStore } from '@/store/campaignStore'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import { useInlineEdit } from '@/hooks/useInlineEdit'
import { ACCEPTED_AUDIO, AMBIENT_DEFAULTS } from '@/lib/constants'
import { cn, formatDuration, getLocalFileDuration } from '@/lib/utils'
import type { AmbientClip, AmbientClipOrder, AmbientLayer, AmbientMode } from '@/lib/types'

const MODES: { value: AmbientMode; label: string }[] = [
  { value: 'loop', label: 'Loop' },
  { value: 'random', label: 'Random' },
  { value: 'oneshot', label: 'One-shot' },
]

const CLIP_ORDERS: { value: AmbientClipOrder; label: string; hint: string }[] = [
  { value: 'shuffle', label: 'Shuffle', hint: 'Every clip plays once before any repeats' },
  { value: 'random', label: 'Random', hint: 'Independent draw each time — may repeat' },
  { value: 'sequential', label: 'In order', hint: 'Clips play in list order' },
]

function modeSummary(layer: AmbientLayer): string {
  switch (layer.mode) {
    case 'loop':
      return 'Loop'
    case 'random':
      return `Random ${String(layer.minDelaySec)}–${String(layer.maxDelaySec)}s`
    case 'oneshot':
      return 'One-shot'
  }
}

interface AmbientLayerRowProps {
  layer: AmbientLayer
  campaignId: string
  climateId: string
  climateColor: string
  /** Other climates in this campaign, for the "Copy to…" action. */
  copyTargets: { id: string; name: string }[]
}

export function AmbientLayerRow({
  layer,
  campaignId,
  climateId,
  climateColor,
  copyTargets,
}: AmbientLayerRowProps): React.JSX.Element {
  const { updateAmbientLayer, deleteAmbientLayer, addAmbientClips, removeAmbientClip } =
    useCampaignStore()
  const copyAmbientLayer = useCampaignStore((s) => s.copyAmbientLayer)
  const auditioningLayerId = useAudioStore((s) => s.auditioningLayerId)
  const activeClimateId = useAudioStore((s) => s.activeClimateId)
  const isPlaying = useAudioStore((s) => s.isPlaying)
  const runtime = useAudioStore((s) => s.ambientRuntime[layer.id])
  const unplayable = useDiagnosticsStore((s) => s.unplayable)

  const [expanded, setExpanded] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isAuditioning = auditioningLayerId === layer.id
  // The editor authors defaults; when this climate happens to be the live one,
  // edits are also pushed to the running stack so the GM hears them immediately.
  const isLive = activeClimateId === climateId
  // Runtime state wins for the meter: the phone may have toggled this layer off
  // for the session without touching the stored default shown by the row.
  const isScenePlaying = isLive && isPlaying
  // What the row shows. Runtime state wins whenever there is any — that's the
  // live scene, and it's what the phone edits. Falls back to the stored default
  // for climates that aren't playing (which have no runtime entry at all), so a
  // toggle made on the phone is reflected here instead of the row silently
  // disagreeing with the remote.
  const runtimeEnabled = runtime?.enabled ?? layer.enabled
  const displayVolume = runtime?.volume ?? layer.volume
  const clips = [...layer.clips].sort((a, b) => a.order - b.order)
  const brokenClips = clips.filter((c) => unplayable[c.id])

  const {
    isEditing: nameIsEditing,
    editValue: nameEditValue,
    setEditValue: setNameEditValue,
    startEditing: startNameEditing,
    handleSave: handleNameSave,
    handleKeyDown: handleNameKeyDown,
    inputProps: nameInputProps,
  } = useInlineEdit({
    value: layer.name,
    onSave: (name) => updateAmbientLayer(campaignId, climateId, layer.id, { name }),
  })

  function handleToggleEnabled(): void {
    const enabled = !runtimeEnabled
    updateAmbientLayer(campaignId, climateId, layer.id, { enabled })
    if (isLive) AmbientEngine.getInstance().setLayerEnabled(layer.id, enabled)
  }

  function handleVolumeChange(volume: number): void {
    updateAmbientLayer(campaignId, climateId, layer.id, { volume })
    if (isLive) AmbientEngine.getInstance().setLayerVolume(layer.id, volume)
  }

  function handleAudition(): void {
    const engine = AmbientEngine.getInstance()
    if (isAuditioning) {
      engine.stopAudition()
    } else {
      void engine.auditionLayer(layer)
    }
  }

  function handleDelete(): void {
    if (isAuditioning) AmbientEngine.getInstance().stopAudition()
    deleteAmbientLayer(campaignId, climateId, layer.id)
  }

  async function handleFiles(files: FileList | File[] | null): Promise<void> {
    if (!files) return
    const added: Omit<AmbientClip, 'id' | 'order'>[] = []
    for (const file of Array.from(files)) {
      const localFilePath = window.api.getPathForFile(file)
      const duration = await getLocalFileDuration(localFilePath)
      added.push({ title: file.name, localFilePath, duration })
    }
    addAmbientClips(campaignId, climateId, layer.id, added)
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    void handleFiles(e.dataTransfer.files)
  }

  const delayInput = (field: 'minDelaySec' | 'maxDelaySec', label: string): React.JSX.Element => (
    <label className="flex items-center gap-2">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <Input
        type="number"
        min={AMBIENT_DEFAULTS.minDelayBound}
        max={AMBIENT_DEFAULTS.maxDelayBound}
        value={layer[field]}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          if (!Number.isFinite(parsed)) return
          const clamped = Math.min(
            AMBIENT_DEFAULTS.maxDelayBound,
            Math.max(AMBIENT_DEFAULTS.minDelayBound, Math.round(parsed)),
          )
          updateAmbientLayer(campaignId, climateId, layer.id, { [field]: clamped })
        }}
        className="h-7 w-[72px] text-[13px]"
      />
    </label>
  )

  return (
    <div className="rounded-md border border-border-subtle bg-surface-1">
      {/* Collapsed row — everything needed to judge a layer at a glance */}
      <div className="flex h-12 min-w-0 items-center gap-2 px-2">
        <GripVertical className="size-3.5 shrink-0 text-text-tertiary" />

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="switch"
                aria-checked={runtimeEnabled}
                aria-label={`${runtimeEnabled ? 'Disable' : 'Enable'} ${layer.name}`}
                onClick={handleToggleEnabled}
                className="flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-3"
              >
                <span
                  className={cn(
                    'size-3 rounded-full border-2 transition-all',
                    runtimeEnabled ? 'border-transparent' : 'border-text-tertiary',
                  )}
                  style={runtimeEnabled ? { backgroundColor: climateColor } : undefined}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              <p>{runtimeEnabled ? 'Included in this scene' : 'Not part of this scene'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {nameIsEditing ? (
          <Input
            {...nameInputProps}
            value={nameEditValue}
            onChange={(e) => setNameEditValue(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={handleNameKeyDown}
            className="h-7 max-w-[200px] text-[13px]"
          />
        ) : (
          <button
            type="button"
            onClick={startNameEditing}
            className={cn(
              'min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent',
              runtimeEnabled ? 'text-text-primary' : 'text-text-tertiary',
            )}
          >
            {layer.name}
          </button>
        )}

        <AmbientActivity
          isLive={isScenePlaying}
          enabled={runtimeEnabled}
          sounding={runtime?.sounding ?? false}
          color={climateColor}
        />

        <span className="shrink-0 text-[11px] text-text-tertiary">{modeSummary(layer)}</span>

        {clips.length === 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <p>This layer has no clips and won&rsquo;t play</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : brokenClips.length > 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8} className="max-w-[280px]">
                <p className="font-medium">
                  {brokenClips.length} of {clips.length} clips can&rsquo;t be played
                </p>
                <p className="text-text-secondary">{unplayable[brokenClips[0].id]?.reason}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}

        <Slider
          value={[displayVolume]}
          min={0}
          max={100}
          step={1}
          onValueChange={([val]) => handleVolumeChange(val)}
          aria-label={`${layer.name} volume`}
          className="w-[90px] shrink-0"
        />
        <span className="w-9 shrink-0 text-right text-[11px] text-text-tertiary">
          {displayVolume}%
        </span>

        {/* Preview only — it auditions the layer whatever is playing, and says
            nothing about scene state. That's the meter's job, so it stays
            neutral until it's actually previewing. */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn(
                  'shrink-0',
                  isAuditioning ? 'text-accent' : 'text-text-tertiary hover:text-text-primary',
                )}
                disabled={clips.length === 0}
                onClick={handleAudition}
                aria-label={
                  isAuditioning ? `Stop previewing ${layer.name}` : `Preview ${layer.name}`
                }
              >
                {isAuditioning ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              <p>{isAuditioning ? 'Stop preview' : 'Preview this layer'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-text-tertiary"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse layer settings' : 'Expand layer settings'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-text-tertiary"
              aria-label={`More actions for ${layer.name}`}
            >
              <Copy className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {copyTargets.length === 0 ? (
              <DropdownMenuItem disabled>No other climates</DropdownMenuItem>
            ) : (
              copyTargets.map((target) => (
                <DropdownMenuItem
                  key={target.id}
                  onClick={() => copyAmbientLayer(campaignId, climateId, layer.id, target.id)}
                >
                  Copy to &ldquo;{target.name}&rdquo;
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-text-tertiary hover:text-danger"
          onClick={handleDelete}
          aria-label={`Delete ${layer.name}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Expanded settings */}
      {expanded && (
        <div className="flex flex-col gap-4 border-t border-border-subtle px-4 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                Mode
              </span>
              <div className="flex gap-1 rounded-md bg-surface-2 p-0.5">
                {MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() =>
                      updateAmbientLayer(campaignId, climateId, layer.id, { mode: mode.value })
                    }
                    className={cn(
                      'rounded px-2 py-1 text-[12px] transition-colors',
                      layer.mode === mode.value
                        ? 'bg-surface-3 text-text-primary'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {layer.mode === 'random' && (
              <div className="flex items-center gap-3">
                {delayInput('minDelaySec', 'Every')}
                {delayInput('maxDelaySec', 'to')}
                <span className="text-[11px] text-text-tertiary">
                  seconds, measured after the clip ends
                </span>
              </div>
            )}
          </div>

          {clips.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                Pick
              </span>
              <div className="flex gap-1 rounded-md bg-surface-2 p-0.5">
                {CLIP_ORDERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.hint}
                    onClick={() =>
                      updateAmbientLayer(campaignId, climateId, layer.id, {
                        clipOrder: option.value,
                      })
                    }
                    className={cn(
                      'rounded px-2 py-1 text-[12px] transition-colors',
                      layer.clipOrder === option.value
                        ? 'bg-surface-3 text-text-primary'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                Clips ({clips.length})
              </span>
              <Button variant="ghost" size="xs" onClick={() => fileInputRef.current?.click()}>
                <Plus className="size-3" />
                Add Clips
              </Button>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'copy'
                setIsDragOver(true)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false)
              }}
              onDrop={handleDrop}
              className={cn(
                'rounded-md border-2 border-dashed transition-colors',
                isDragOver ? 'border-accent bg-accent-muted' : 'border-transparent',
              )}
            >
              {clips.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-text-tertiary">
                  Drop audio files here to add clips
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {clips.map((clip) => {
                    const diagnostic = unplayable[clip.id]
                    return (
                      <div
                        key={clip.id}
                        className="group flex h-8 min-w-0 items-center gap-2 rounded px-2 hover:bg-surface-2"
                      >
                        <Waves className="size-3.5 shrink-0 text-text-tertiary" />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">
                          {clip.title}
                        </span>
                        {diagnostic && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="size-3 shrink-0 text-amber-400" />
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={8} className="max-w-[280px]">
                                <p className="font-medium">This clip can&rsquo;t be played</p>
                                <p className="text-text-secondary">{diagnostic.reason}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <span className="shrink-0 text-[11px] text-text-tertiary">
                          {formatDuration(clip.duration)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-text-tertiary hover:text-danger"
                          onClick={() =>
                            removeAmbientClip(campaignId, climateId, layer.id, clip.id)
                          }
                          aria-label={`Remove ${clip.title}`}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_AUDIO}
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
