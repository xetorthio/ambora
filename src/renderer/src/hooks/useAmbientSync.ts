import { useEffect } from 'react'
import { AmbientEngine } from '@/audio/AmbientEngine'
import { useAudioStore } from '@/store/audioStore'
import { useCampaignStore } from '@/store/campaignStore'

/**
 * Keeps the running ambient stack in step with edits made to the climate that is
 * currently playing, so adding a clip or switching a layer's mode takes effect
 * on the scene the GM is listening to rather than only on the next activation.
 */
export function useAmbientSync(): void {
  const campaigns = useCampaignStore((s) => s.campaigns)
  const activeClimateId = useAudioStore((s) => s.activeClimateId)

  // Registered once; reads the store directly so it can't capture a stale
  // campaign list.
  useEffect(() => {
    AmbientEngine.getInstance().setOnClipDurationAvailable((localFilePath, duration) => {
      useCampaignStore.getState().fillAmbientClipDurations(localFilePath, duration)
    })
  }, [])

  useEffect(() => {
    if (!activeClimateId) return
    for (const campaign of campaigns) {
      const climate = campaign.climates.find((c) => c.id === activeClimateId)
      if (climate) {
        AmbientEngine.getInstance().syncClimate(climate)
        return
      }
    }
  }, [campaigns, activeClimateId])
}
