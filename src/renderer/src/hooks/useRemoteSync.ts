import { useEffect } from 'react'
import { useAudioStore } from '@/store/audioStore'
import { useCampaignStore } from '@/store/campaignStore'
import { useConnectionStore } from '@/store/connectionStore'
import { AudioEngine } from '@/audio/AudioEngine'
import { AmbientEngine } from '@/audio/AmbientEngine'
import { toast } from 'sonner'
import type { PlaybackState, RemoteFullState } from '@/lib/types'

function getPlaybackState(): PlaybackState {
  const audio = useAudioStore.getState()
  const { activeCampaignId } = useCampaignStore.getState()
  return {
    activeCampaignId,
    activeClimateId: audio.activeClimateId,
    activeTrackId: audio.activeTrackId,
    isPlaying: audio.isPlaying,
    volume: audio.volume,
    isFadingToSilence: audio.isFadingToSilence,
    isShuffled: audio.isShuffled,
    fadeAnimations: audio.fadeAnimations,
    ambientRuntime: audio.ambientRuntime,
  }
}

function getFullState(): RemoteFullState {
  const { campaigns, activeCampaignId } = useCampaignStore.getState()
  return {
    campaigns,
    activeCampaignId,
    playback: getPlaybackState(),
  }
}

export function useRemoteSync(): void {
  useEffect(() => {
    // Fetch server info and set URL in connection store
    window.api.getServerInfo().then(({ port, localIP }) => {
      useConnectionStore.getState().setServerUrl(`http://${localIP}:${port}`)
    })

    // Subscribe to connection status updates
    let prevClients = useConnectionStore.getState().connectedClients
    const unsubConnection = window.api.onConnectionStatus((status) => {
      const wasZero = prevClients === 0
      useConnectionStore.getState().setConnectedClients(status.connectedClients)
      if (wasZero && status.connectedClients > 0) {
        toast.success('Phone connected')
      }
      prevClients = status.connectedClients
    })

    // Push initial full state to main process
    const fullState = getFullState()
    window.api.sendFullState(fullState)

    // Subscribe to audio store changes → push playback updates
    const unsubAudio = useAudioStore.subscribe((state, prev) => {
      const changed =
        state.isPlaying !== prev.isPlaying ||
        state.activeClimateId !== prev.activeClimateId ||
        state.activeTrackId !== prev.activeTrackId ||
        state.volume !== prev.volume ||
        state.isFadingToSilence !== prev.isFadingToSilence ||
        state.isShuffled !== prev.isShuffled ||
        state.fadeAnimations !== prev.fadeAnimations ||
        state.ambientRuntime !== prev.ambientRuntime

      if (changed) {
        const playback = getPlaybackState()
        window.api.sendStateUpdate({ type: 'playback-update', payload: playback })
        window.api.sendFullState(getFullState())
      }
    })

    // Subscribe to campaign store changes → push campaign updates
    const unsubCampaigns = useCampaignStore.subscribe((state, prev) => {
      if (state.campaigns !== prev.campaigns || state.activeCampaignId !== prev.activeCampaignId) {
        window.api.sendStateUpdate({
          type: 'campaigns-update',
          payload: { campaigns: state.campaigns },
        })
        window.api.sendFullState(getFullState())
      }
    })

    // Listen for remote commands from phone
    const unsubCommands = window.api.onRemoteCommand((command) => {
      const engine = AudioEngine.getInstance()
      const campaignStore = useCampaignStore.getState()
      const audioStore = useAudioStore.getState()

      switch (command.type) {
        case 'activate-climate': {
          const campaign = campaignStore.campaigns.find(
            (c) => c.id === campaignStore.activeCampaignId,
          )
          const climate = campaign?.climates.find((cl) => cl.id === command.payload.climateId)
          if (climate) {
            engine.activateClimate(climate)
          }
          break
        }
        case 'play-pause': {
          if (audioStore.isPlaying) {
            engine.fadeToSilence()
          } else {
            engine.resume()
          }
          break
        }
        case 'skip-track': {
          engine.nextTrack()
          break
        }
        case 'set-volume': {
          const volume = Math.max(0, Math.min(100, command.payload.volume))
          audioStore.setVolume(volume)
          engine.setVolume(volume)
          break
        }
        case 'toggle-shuffle': {
          audioStore.toggleShuffle()
          break
        }
        case 'set-layer-enabled': {
          AmbientEngine.getInstance().setLayerEnabled(
            command.payload.layerId,
            command.payload.enabled,
          )
          break
        }
        case 'set-layer-volume': {
          AmbientEngine.getInstance().setLayerVolume(
            command.payload.layerId,
            command.payload.volume,
          )
          break
        }
        case 'trigger-layer': {
          AmbientEngine.getInstance().triggerLayer(command.payload.layerId)
          break
        }
      }
    })

    return () => {
      unsubAudio()
      unsubCampaigns()
      unsubCommands()
      unsubConnection()
    }
  }, [])
}
