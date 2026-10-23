import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { ClimateCard } from '@/components/ClimateCard'
import { ClimateDetail } from '@/components/ClimateDetail'
import { ACCEPTED_AUDIO_EXTENSIONS } from '@/lib/constants'
import { useCampaignStore } from '@/store/campaignStore'
import { useAudioStore } from '@/store/audioStore'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import type { Campaign } from '@/lib/types'
import { toast } from 'sonner'
import { validateLocalAudioFile } from '@/lib/validateLocalAudio'
import { probeLocalTrack } from '@/audio/probeTrack'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import { debugLog } from '@/lib/debugLog'

interface ClimateGridProps {
  campaign: Campaign
}

export function ClimateGrid({ campaign }: ClimateGridProps): React.JSX.Element {
  const { createClimate, duplicateClimate, addTrack, reorderClimates } = useCampaignStore()
  const { activeClimateId, isPlaying, fadeAnimations, clearAllFadeAnimations } = useAudioStore()
  const audioEngine = useAudioEngine()
  const [selectedClimateId, setSelectedClimateId] = useState<string | null>(null)
  const [draggedClimateId, setDraggedClimateId] = useState<string | null>(null)
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sorted = [...campaign.climates].sort((a, b) => a.order - b.order)
  const selectedClimate = sorted.find((c) => c.id === selectedClimateId)

  // Safety timer: clear fade animations if they overshoot
  useEffect(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = null
    }
    if (fadeAnimations.length === 0) return
    const maxDuration = Math.max(...fadeAnimations.map((fa) => fa.durationMs))
    safetyTimerRef.current = setTimeout(() => {
      clearAllFadeAnimations()
    }, maxDuration + 500)
    return () => {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current)
      }
    }
  }, [fadeAnimations, clearAllFadeAnimations])

  // Check all local assets while the grid is open, including ambient clips.
  useEffect(() => {
    const assets = campaign.climates.flatMap((climate) => [
      ...climate.tracks
        .filter((track) => track.source === 'local')
        .map((track) => ({ id: track.id, localFilePath: track.localFilePath ?? '' })),
      ...(climate.ambientLayers ?? []).flatMap((layer) =>
        layer.clips.map((clip) => ({ id: clip.id, localFilePath: clip.localFilePath })),
      ),
    ])
    const unprobed = assets.filter((asset) => !useDiagnosticsStore.getState().hasProbed(asset.id))
    debugLog('campaign-grid-ready', {
      campaignId: campaign.id,
      climateCount: campaign.climates.length,
      localAssetCount: assets.length,
      assetsToProbe: unprobed.length,
    })
    if (unprobed.length === 0) {
      let hideTimer: ReturnType<typeof setTimeout> | null = null
      const completeProgress = setTimeout(() => {
        useDiagnosticsStore.getState().setProbeProgress({
          campaignId: campaign.id,
          completed: 1,
          total: 1,
        })
        hideTimer = setTimeout(() => useDiagnosticsStore.getState().setProbeProgress(null), 350)
      }, 0)
      return () => {
        clearTimeout(completeProgress)
        if (hideTimer) clearTimeout(hideTimer)
      }
    }

    if (import.meta.env.DEV) {
      console.info(
        `[campaigns] probing ${String(unprobed.length)} local asset(s) for “${campaign.name}”`,
      )
    }

    let cancelled = false
    let finishTimer: ReturnType<typeof setTimeout> | null = null
    const showProgress = setTimeout(
      () =>
        useDiagnosticsStore.getState().setProbeProgress({
          campaignId: campaign.id,
          completed: 0,
          total: unprobed.length,
        }),
      0,
    )

    void (async () => {
      let completed = 0
      for (const asset of unprobed) {
        // React Strict Mode runs effects twice in development. Finish the one
        // in-flight probe, but do not continue scanning the cancelled pass.
        if (cancelled) break
        const diagnostics = useDiagnosticsStore.getState()
        if (diagnostics.hasProbed(asset.id)) continue
        diagnostics.markProbed(asset.id)
        const { ok, reason } = await probeLocalTrack(asset.localFilePath)
        if (import.meta.env.DEV) {
          console.info(
            `[campaigns] probe ${asset.id}: ${ok ? 'ok' : `failed (${reason ?? 'unknown reason'})`}`,
          )
        }
        if (!ok) {
          diagnostics.setUnplayable(asset.id, {
            source: 'probe',
            reason: reason ?? 'File could not be opened',
          })
        } else if (diagnostics.unplayable[asset.id]?.source === 'probe') {
          diagnostics.clearUnplayable(asset.id)
        }
        completed++
        if (!cancelled) {
          useDiagnosticsStore.getState().setProbeProgress({
            campaignId: campaign.id,
            completed,
            total: unprobed.length,
          })
        }
      }
      if (!cancelled) {
        // Leave the completed state on screen long enough for the result to be legible.
        finishTimer = setTimeout(() => {
          if (!cancelled) useDiagnosticsStore.getState().setProbeProgress(null)
        }, 350)
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(showProgress)
      if (finishTimer) clearTimeout(finishTimer)
    }
  }, [campaign.climates, campaign.id, campaign.name])

  function handleAddClimate(): void {
    const climate = createClimate(campaign.id, 'New Climate')
    if (climate) setSelectedClimateId(climate.id)
  }

  function handleDuplicateClimate(climateId: string): void {
    const duplicate = duplicateClimate(campaign.id, climateId)
    if (!duplicate) return
    toast.success('Climate duplicated')
  }

  async function handleDropFiles(climateId: string, files: File[]): Promise<void> {
    const audioFiles = files.filter((f) => {
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase()
      return ACCEPTED_AUDIO_EXTENSIONS.includes(ext)
    })
    let added = 0
    for (const file of audioFiles) {
      const validated = await validateLocalAudioFile(file)
      if (!validated) continue
      addTrack(campaign.id, climateId, {
        source: 'local',
        title: validated.title,
        localFilePath: validated.localFilePath,
        duration: validated.duration,
      })
      added++
    }
    if (added > 0) {
      toast.success(`${added} track${added > 1 ? 's' : ''} added`)
    }
  }

  function handleReorderDrop(targetClimateId: string): void {
    if (!draggedClimateId || draggedClimateId === targetClimateId) {
      setDraggedClimateId(null)
      setReorderTargetId(null)
      return
    }
    const ids = sorted.map((climate) => climate.id)
    const sourceIndex = ids.indexOf(draggedClimateId)
    const targetIndex = ids.indexOf(targetClimateId)
    if (sourceIndex < 0 || targetIndex < 0) return
    ids.splice(sourceIndex, 1)
    ids.splice(targetIndex, 0, draggedClimateId)
    reorderClimates(campaign.id, ids)
    setDraggedClimateId(null)
    setReorderTargetId(null)
  }

  if (selectedClimate) {
    return (
      <ClimateDetail
        climate={selectedClimate}
        campaign={campaign}
        onClose={() => setSelectedClimateId(null)}
      />
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 px-8 pb-8">
      {sorted.map((climate) => (
        <ClimateCard
          key={climate.id}
          campaignId={campaign.id}
          climate={climate}
          isActive={climate.id === activeClimateId && isPlaying}
          isSelected={false}
          fadeAnimation={fadeAnimations.find((fa) => fa.climateId === climate.id)}
          onClick={() => setSelectedClimateId(climate.id)}
          onPlay={() => {
            if (climate.id === activeClimateId) {
              if (isPlaying) audioEngine.fadeToSilence()
              else audioEngine.resume()
              return
            }
            void audioEngine.activateClimate(climate)
          }}
          onDuplicate={() => handleDuplicateClimate(climate.id)}
          onDropFiles={handleDropFiles}
          isReordering={draggedClimateId !== null}
          isReorderTarget={reorderTargetId === climate.id && draggedClimateId !== climate.id}
          onReorderDragStart={setDraggedClimateId}
          onReorderDragEnter={setReorderTargetId}
          onReorderDrop={handleReorderDrop}
          onReorderDragEnd={() => {
            setDraggedClimateId(null)
            setReorderTargetId(null)
          }}
        />
      ))}
      <button
        type="button"
        className="flex min-h-[120px] min-w-[200px] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border text-text-tertiary transition-colors duration-150 hover:border-text-tertiary hover:text-text-secondary"
        onClick={handleAddClimate}
      >
        <Plus className="size-6" />
        <span className="text-[13px]">Add Climate</span>
      </button>
    </div>
  )
}
