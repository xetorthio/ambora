import { useRef } from 'react'
import { Pause, Play, Shuffle, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useAudioStore } from '@/store/audioStore'
import { useCampaignStore } from '@/store/campaignStore'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import { NormalizationIndicator } from '@/components/NormalizationIndicator'
import { DEFAULTS } from '@/lib/constants'

export function NowPlayingBar(): React.JSX.Element {
  const {
    volume,
    setVolume,
    isPlaying,
    activeClimateId,
    activeTrackId,
    isShuffled,
    toggleShuffle,
  } = useAudioStore()
  const previousVolumeRef = useRef<number>(DEFAULTS.volume)
  const { campaigns } = useCampaignStore()
  const audioEngine = useAudioEngine()

  let climateName: string | null = null
  let climateColor: string | null = null
  let trackTitle: string | null = null
  let hasTracks = false

  if (activeClimateId) {
    for (const campaign of campaigns) {
      const climate = campaign.climates.find((c) => c.id === activeClimateId)
      if (climate) {
        climateName = climate.name
        climateColor = climate.color
        hasTracks = climate.tracks.length > 0
        if (activeTrackId) {
          const track = climate.tracks.find((t) => t.id === activeTrackId)
          if (track) trackTitle = track.title
        }
        break
      }
    }
  }

  const isIdle = !climateName

  function handlePlayPause(): void {
    if (isPlaying) {
      audioEngine.fadeToSilence()
    } else {
      audioEngine.resume()
    }
  }

  function handleSkip(): void {
    audioEngine.nextTrack()
  }

  function handleMuteToggle(): void {
    if (volume > 0) {
      previousVolumeRef.current = volume
      setVolume(0)
    } else {
      setVolume(previousVolumeRef.current || DEFAULTS.volume)
    }
  }

  const VolumeIcon = volume === 0 ? VolumeX : volume <= 50 ? Volume1 : Volume2

  return (
    <div className="flex h-16 shrink-0 items-center border-t border-border-subtle bg-surface-1 px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {climateColor && (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: climateColor }}
          />
        )}
        {isIdle ? (
          <span className="text-[13px] text-text-tertiary">No track playing</span>
        ) : (
          <div
            key={`${activeClimateId}-${activeTrackId}`}
            className="flex min-w-0 items-center gap-3"
            style={{ animation: 'text-fade-in 300ms ease-out' }}
          >
            <span className="shrink-0 text-[13px] font-medium text-text-primary">
              {climateName}
            </span>
            {trackTitle ? (
              <>
                <span className="text-[13px] text-text-tertiary">&middot;</span>
                <span className="min-w-0 truncate text-[13px] text-text-secondary">
                  {trackTitle}
                </span>
              </>
            ) : (
              !hasTracks && (
                <>
                  <span className="text-[13px] text-text-tertiary">&middot;</span>
                  <span className="text-[13px] text-text-secondary">Ambience only</span>
                </>
              )
            )}
          </div>
        )}
      </div>

      <NormalizationIndicator />

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" disabled={isIdle} onClick={handlePlayPause}>
          {isPlaying ? <Pause className="size-[18px]" /> : <Play className="size-[18px]" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isIdle || !isPlaying || !hasTracks}
          onClick={handleSkip}
        >
          <SkipForward className="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={toggleShuffle}>
          <Shuffle
            className={`size-[18px] ${isShuffled ? 'text-accent' : 'text-text-secondary'}`}
          />
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={handleMuteToggle}>
            <VolumeIcon className="size-4 text-text-secondary" />
          </Button>
          <Slider
            value={[volume]}
            min={0}
            max={100}
            step={1}
            onValueChange={([val]) => setVolume(val)}
            className="w-[120px]"
          />
        </div>
      </div>
    </div>
  )
}
