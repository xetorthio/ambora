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

interface ClimateGridProps {
  campaign: Campaign
}

export function ClimateGrid({ campaign }: ClimateGridProps): React.JSX.Element {
  const { createClimate, addTrack } = useCampaignStore()
  const { activeClimateId, fadeAnimations, clearAllFadeAnimations } = useAudioStore()
  const audioEngine = useAudioEngine()
  const [selectedClimateId, setSelectedClimateId] = useState<string | null>(null)
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

  function handleAddClimate(): void {
    const climate = createClimate(campaign.id, 'New Climate')
    if (climate) setSelectedClimateId(climate.id)
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
          climate={climate}
          isActive={climate.id === activeClimateId}
          isSelected={false}
          fadeAnimation={fadeAnimations.find((fa) => fa.climateId === climate.id)}
          onClick={() => setSelectedClimateId(climate.id)}
          onPlay={() => audioEngine.activateClimate(climate)}
          onDropFiles={handleDropFiles}
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
