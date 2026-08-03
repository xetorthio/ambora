import '@fontsource-variable/inter'
import { useEffect } from 'react'
import { Loader2, Map } from 'lucide-react'
import { Sidebar } from '@/components/Sidebar'
import { CampaignView } from '@/components/CampaignView'
import { NowPlayingBar } from '@/components/NowPlayingBar'
import { EmptyState } from '@/components/EmptyState'
import { useCampaignStore } from '@/store/campaignStore'
import { useRemoteSync } from '@/hooks/useRemoteSync'
import { useAmbientSync } from '@/hooks/useAmbientSync'

function App(): React.JSX.Element {
  const { isLoaded, loadCampaigns, getActiveCampaign } = useCampaignStore()
  const activeCampaign = getActiveCampaign()

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  useRemoteSync()
  useAmbientSync()

  if (!isLoaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-text-tertiary" />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 overflow-y-auto">
          {activeCampaign ? (
            <CampaignView campaign={activeCampaign} />
          ) : (
            <EmptyState
              icon={Map}
              title="No campaign selected"
              description="Select a campaign from the sidebar or create a new one."
            />
          )}
        </main>
      </div>
      <NowPlayingBar />
    </div>
  )
}

export default App
