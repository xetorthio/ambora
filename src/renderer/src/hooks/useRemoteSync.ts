import { useEffect } from 'react'
import { useAudioStore } from '@/store/audioStore'
import { useCampaignStore } from '@/store/campaignStore'
import { useConnectionStore } from '@/store/connectionStore'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import { AudioEngine } from '@/audio/AudioEngine'
import { AmbientEngine } from '@/audio/AmbientEngine'
import { SoundboardEngine } from '@/audio/SoundboardEngine'
import { probeSoundboardTrack } from '@/audio/probeTrack'
import { toast } from 'sonner'
import { toRemoteCampaigns, toRemoteFullState } from '../../../shared/remoteDto'
import type { PlaybackState, RemoteFullState } from '@/lib/types'
import { debugLog } from '@/lib/debugLog'

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
  const unavailableIds = new Set(Object.keys(useDiagnosticsStore.getState().unplayable))
  return toRemoteFullState({
    campaigns,
    activeCampaignId,
    playback: getPlaybackState(),
    unavailableIds,
  })
}

function getRemoteCampaigns(): RemoteFullState['campaigns'] {
  const unavailableIds = new Set(Object.keys(useDiagnosticsStore.getState().unplayable))
  return toRemoteCampaigns(useCampaignStore.getState().campaigns, unavailableIds)
}

function soundboardDiagnosticsChanged(
  current: ReturnType<typeof useDiagnosticsStore.getState>['unplayable'],
  previous: ReturnType<typeof useDiagnosticsStore.getState>['unplayable'],
): boolean {
  const soundIds = useCampaignStore
    .getState()
    .campaigns.flatMap((campaign) => campaign.soundboard?.map((sound) => sound.id) ?? [])
  return soundIds.some((soundId) => !!current[soundId] !== !!previous[soundId])
}

export function useRemoteSync(): void {
  useEffect(() => {
    let campaignSyncTimer: ReturnType<typeof setTimeout> | null = null
    let pendingCampaignDataUpdate = false
    let pendingActiveCampaignUpdate = false

    function flushCampaignSync(): void {
      campaignSyncTimer = null
      const startedAt = performance.now()
      const fullState = getFullState()
      if (pendingCampaignDataUpdate) {
        window.api.sendStateUpdate({
          type: 'campaigns-update',
          payload: { campaigns: fullState.campaigns },
        })
      }
      // The full state always refreshes the main-process cache. On a selection
      // change it is also the one authoritative message the phone needs; a
      // separate campaigns-update would duplicate the entire campaign payload.
      window.api.sendFullState(fullState, pendingActiveCampaignUpdate)
      debugLog('remote-campaign-sync-flushed', {
        campaignDataChanged: pendingCampaignDataUpdate,
        activeCampaignChanged: pendingActiveCampaignUpdate,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
      })
      pendingCampaignDataUpdate = false
      pendingActiveCampaignUpdate = false
    }

    function scheduleCampaignSync(
      campaignDataChanged: boolean,
      activeCampaignChanged: boolean,
    ): void {
      pendingCampaignDataUpdate ||= campaignDataChanged
      pendingActiveCampaignUpdate ||= activeCampaignChanged
      if (campaignSyncTimer) return
      debugLog('remote-campaign-sync-scheduled', { campaignDataChanged, activeCampaignChanged })
      campaignSyncTimer = setTimeout(flushCampaignSync, 0)
    }

    // Fetch server info and set URL in connection store
    window.api.getServerInfo().then(({ port, localIP, clients }) => {
      useConnectionStore.getState().setServerUrl(`http://${localIP}:${port}`)
      useConnectionStore.getState().setConnectedClients(clients.length, clients)
    })

    // Subscribe to connection status updates
    let prevClients = useConnectionStore.getState().connectedClients
    const unsubConnection = window.api.onConnectionStatus((status) => {
      const wasZero = prevClients === 0
      useConnectionStore.getState().setConnectedClients(status.connectedClients, status.clients)
      if (wasZero && status.connectedClients > 0) {
        toast.success('Phone connected')
      }
      prevClients = status.connectedClients
    })

    // Refresh the cache and update phones that survived a renderer reload.
    const fullState = getFullState()
    window.api.sendFullState(fullState, true)

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
        // Keep the connection cache current without duplicating the incremental
        // playback update to every connected phone.
        window.api.sendFullState(getFullState())
      }
    })

    // Subscribe to campaign store changes → push campaign updates
    const unsubCampaigns = useCampaignStore.subscribe((state, prev) => {
      const campaignDataChanged = state.campaigns !== prev.campaigns
      const activeCampaignChanged = state.activeCampaignId !== prev.activeCampaignId
      if (campaignDataChanged || activeCampaignChanged) {
        scheduleCampaignSync(campaignDataChanged, activeCampaignChanged)
      }
    })

    const unsubDiagnostics = useDiagnosticsStore.subscribe((state, prev) => {
      if (
        state.unplayable === prev.unplayable ||
        !soundboardDiagnosticsChanged(state.unplayable, prev.unplayable)
      ) {
        return
      }
      window.api.sendStateUpdate({
        type: 'campaigns-update',
        payload: { campaigns: getRemoteCampaigns() },
      })
      window.api.sendFullState(getFullState())
    })

    // Soundboard playback lives outside Zustand because it is short-lived audio
    // runtime. Forward its authoritative start/end events to every phone so the
    // pad remains lit for the real duration (including desktop/keyboard plays).
    const unsubSoundboard = SoundboardEngine.getInstance().subscribe((soundId, activity) => {
      window.api.sendStateUpdate({
        type: 'soundboard-activity',
        payload: { soundId, ...activity },
      })
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
        case 'trigger-soundboard': {
          const campaign = campaignStore.campaigns.find(
            (item) => item.id === campaignStore.activeCampaignId,
          )
          const sound = campaign?.soundboard?.find((item) => item.id === command.payload.soundId)
          if (sound) {
            void (async () => {
              const diagnostics = useDiagnosticsStore.getState()
              if (diagnostics.unplayable[sound.id]) {
                const probe = await probeSoundboardTrack(sound.localFilePath)
                if (!probe.ok) {
                  const reason = probe.reason ?? 'Audio file could not be read — locate it to play'
                  diagnostics.setUnplayable(sound.id, { source: 'probe', reason })
                  // A repeated failure deliberately does not re-broadcast to the
                  // phone, so without this the GM taps a flagged pad and nothing
                  // happens anywhere. The desktop is where the file lives and
                  // where the relink flow is, so that is where it is reported —
                  // the same toast the desktop click path shows.
                  toast.error(reason)
                  return
                }
                diagnostics.clearUnplayable(sound.id)
              }
              await SoundboardEngine.getInstance().trigger(sound)
            })().catch((error: unknown) => {
              toast.error(error instanceof Error ? error.message : `Could not play ${sound.name}`)
            })
          }
          break
        }
      }
    })

    return () => {
      unsubAudio()
      unsubCampaigns()
      unsubSoundboard()
      unsubDiagnostics()
      unsubCommands()
      unsubConnection()
      if (campaignSyncTimer) clearTimeout(campaignSyncTimer)
      SoundboardEngine.getInstance().stopAll()
    }
  }, [])
}
