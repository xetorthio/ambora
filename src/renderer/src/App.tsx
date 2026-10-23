import '@fontsource-variable/inter'
import { Profiler, useEffect } from 'react'
import { Loader2, Map } from 'lucide-react'
import { toast } from 'sonner'
import { Sidebar } from '@/components/Sidebar'
import { CampaignView } from '@/components/CampaignView'
import { NowPlayingBar } from '@/components/NowPlayingBar'
import { EmptyState } from '@/components/EmptyState'
import { Soundboard } from '@/components/Soundboard'
import { useCampaignStore } from '@/store/campaignStore'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import { useRemoteSync } from '@/hooks/useRemoteSync'
import { useAmbientSync } from '@/hooks/useAmbientSync'
import { debugLog } from '@/lib/debugLog'

function logCampaignViewRender(
  _id: string,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  baseDuration: number,
  _startTime: number,
  commitTime: number,
): void {
  debugLog('campaign-view-render', {
    phase,
    actualDurationMs: Number(actualDuration.toFixed(1)),
    baseDurationMs: Number(baseDuration.toFixed(1)),
    commitTimeMs: Number(commitTime.toFixed(1)),
  })
}

function App(): React.JSX.Element {
  const { isLoaded, loadCampaigns, getActiveCampaign } = useCampaignStore()
  const campaignLoadingId = useDiagnosticsStore((state) => state.campaignLoadingId)
  const activeCampaign = getActiveCampaign()

  useEffect(() => {
    void loadCampaigns().then((result) => {
      if (result?.error) {
        toast.error(result.error)
      } else if (result?.warning) {
        toast.warning(result.warning)
      }
    })
  }, [loadCampaigns])

  // Warm the YouTube IFrame API in the background so the first YT track isn't
  // blocked on a cold 10s script download during play.
  useEffect(() => {
    void import('@/audio/youtube-api').then(({ loadYouTubeAPI }) => {
      void loadYouTubeAPI().catch(() => {
        // Offline / blocked — playback will retry and surface the error.
      })
    })
  }, [])

  useRemoteSync()
  useAmbientSync()

  if (!isLoaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-text-tertiary" />
      </div>
    )
  }

  const campaignContent = activeCampaign ? (
    <CampaignView key={activeCampaign.id} campaign={activeCampaign} />
  ) : (
    <EmptyState
      icon={Map}
      title="No campaign selected"
      description="Select a campaign from the sidebar or create a new one."
    />
  )

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="relative flex min-h-0 flex-1 overflow-y-auto">
            {activeCampaign && import.meta.env.DEV ? (
              <Profiler id="campaign-view" onRender={logCampaignViewRender}>
                {campaignContent}
              </Profiler>
            ) : (
              campaignContent
            )}
            {campaignLoadingId && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background text-text-tertiary">
                <Loader2 className="size-6 animate-spin text-accent" />
                <span className="text-[13px]">Loading campaign…</span>
              </div>
            )}
          </main>
          {activeCampaign && <Soundboard campaign={activeCampaign} />}
        </div>
      </div>
      <NowPlayingBar />
    </div>
  )
}

export default App
