import { useEffect, useState } from 'react'
import { ArrowLeft, Settings, Plus, Upload } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { ColorPicker } from '@/components/ColorPicker'
import { IconPicker } from '@/components/IconPicker'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TrackList } from '@/components/TrackList'
import { AddTrackDialog } from '@/components/AddTrackDialog'
import { AmbientLayerList } from '@/components/AmbientLayerList'
import { ACCEPTED_AUDIO_EXTENSIONS } from '@/lib/constants'
import { ICON_MAP, type ClimateIconName } from '@/lib/iconMap'
import { DEFAULTS } from '@/lib/constants'
import { useInlineEdit } from '@/hooks/useInlineEdit'
import { useCampaignStore } from '@/store/campaignStore'
import { useAudioStore } from '@/store/audioStore'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import { probeLocalTrack } from '@/audio/probeTrack'
import type { Campaign, Climate, Track } from '@/lib/types'
import { toast } from 'sonner'
import { getLocalFileDuration } from '@/lib/utils'

interface ClimateDetailProps {
  climate: Climate
  campaign: Campaign
  onClose: () => void
}

export function ClimateDetail({
  climate,
  campaign,
  onClose,
}: ClimateDetailProps): React.JSX.Element {
  const campaignId = campaign.id
  const { updateClimate, deleteClimate, addTrack, removeTrack } = useCampaignStore()
  const audioEngine = useAudioEngine()
  const [addTrackOpen, setAddTrackOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const {
    isEditing: nameIsEditing,
    editValue: nameEditValue,
    setEditValue: setNameEditValue,
    startEditing: startNameEditing,
    handleSave: handleNameSave,
    handleKeyDown: handleNameKeyDown,
    inputProps: nameInputProps,
  } = useInlineEdit({
    value: climate.name,
    onSave: (name) => updateClimate(campaignId, climate.id, { name }),
  })

  const Icon = ICON_MAP[climate.icon as ClimateIconName]
  const ambientLayerCount = (climate.ambientLayers ?? []).length

  // Proactively probe local files for decodability so unplayable tracks are
  // flagged before playback. Runs on open and whenever the track list changes
  // (adding a file re-runs this and probes just the new one). Sequential to keep
  // it gentle, and deduped via the store's `probed` set.
  useEffect(() => {
    const localTracks = climate.tracks
      .filter((t) => t.source === 'local' && t.localFilePath)
      .map((t) => ({ id: t.id, localFilePath: t.localFilePath! }))
    // Ambient clips are always local files, so they get the same up-front check.
    const ambientClips = (climate.ambientLayers ?? []).flatMap((layer) =>
      layer.clips.map((c) => ({ id: c.id, localFilePath: c.localFilePath })),
    )
    const toProbe = [...localTracks, ...ambientClips].filter(
      (t) => !useDiagnosticsStore.getState().hasProbed(t.id),
    )
    if (toProbe.length === 0) return

    let cancelled = false
    void (async () => {
      for (const track of toProbe) {
        if (cancelled) return
        const store = useDiagnosticsStore.getState()
        store.markProbed(track.id)
        const { ok, reason } = await probeLocalTrack(track.localFilePath)
        if (cancelled) return
        if (!ok) {
          store.setUnplayable(track.id, {
            source: 'probe',
            reason: reason ?? 'File could not be opened',
          })
        } else if (store.unplayable[track.id]?.source === 'probe') {
          // File now loads — clear a stale probe flag. Leave playback-sourced
          // flags (a real runtime failure) in place.
          store.clearUnplayable(track.id)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [climate.id, climate.tracks, climate.ambientLayers])

  function handleDeleteClimate(): void {
    deleteClimate(campaignId, climate.id)
    onClose()
    toast.success('Climate deleted')
  }

  function handleAddTrack(track: Omit<Track, 'id' | 'order'>): void {
    addTrack(campaignId, climate.id, track)
    toast.success('Track added')
  }

  function handleDeleteTrack(trackId: string): void {
    removeTrack(campaignId, climate.id, trackId)
    useDiagnosticsStore.getState().forgetTrack(trackId)
    toast.success('Track removed')
  }

  async function handlePlayTrack(trackId: string): Promise<void> {
    const { activeClimateId, isPlaying, isFadingToSilence } = useAudioStore.getState()
    // Crossfade within the climate only when it's the one actively playing.
    // Otherwise (idle, a different climate, or mid fade-to-silence) (re)activate
    // this climate starting from the chosen track.
    if (activeClimateId === climate.id && isPlaying && !isFadingToSilence) {
      await audioEngine.skipToTrack(trackId)
    } else {
      await audioEngine.activateClimate(climate, trackId)
    }
  }

  async function handleDropFiles(files: File[]): Promise<void> {
    const audioFiles = files.filter((f) => {
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase()
      return ACCEPTED_AUDIO_EXTENSIONS.includes(ext)
    })
    for (const file of audioFiles) {
      const filePath = window.api.getPathForFile(file)
      const duration = await getLocalFileDuration(filePath)
      addTrack(campaignId, climate.id, {
        source: 'local',
        title: file.name,
        localFilePath: filePath,
        duration,
      })
    }
    if (audioFiles.length > 0) {
      toast.success(`${audioFiles.length} track${audioFiles.length > 1 ? 's' : ''} added`)
    }
  }

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent): void {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    setIsDragOver(false)
    handleDropFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <>
      <div className="min-w-0 px-8 pb-8">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <ArrowLeft className="size-4" />
          </Button>
          {Icon && <Icon className="size-5" style={{ color: climate.color }} />}
          {nameIsEditing ? (
            <Input
              {...nameInputProps}
              value={nameEditValue}
              onChange={(e) => setNameEditValue(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
              className="h-8 max-w-[300px] text-[17px] font-semibold"
            />
          ) : (
            <h2
              className="cursor-pointer text-[17px] font-semibold text-text-primary hover:text-accent"
              onClick={startNameEditing}
            >
              {climate.name}
            </h2>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className={settingsOpen ? 'text-accent' : 'text-text-tertiary'}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <Settings className="size-4" />
          </Button>
          <div className="flex-1" />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger">
                Delete Climate
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &ldquo;{climate.name}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this climate and all its tracks.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDeleteClimate}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Collapsible settings */}
        {settingsOpen && (
          <>
            <Separator className="my-4 bg-border-subtle" />
            <div className="flex flex-wrap gap-8">
              <div className="min-w-[200px]">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  Color
                </p>
                <ColorPicker
                  selectedColor={climate.color}
                  onSelectColor={(color) => updateClimate(campaignId, climate.id, { color })}
                />
              </div>
              <div className="min-w-[200px]">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  Icon
                </p>
                <IconPicker
                  selectedIcon={climate.icon}
                  onSelectIcon={(icon) => updateClimate(campaignId, climate.id, { icon })}
                />
              </div>
              <div className="min-w-[200px] max-w-[300px] flex-1">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  Crossfade Duration
                </p>
                <div className="flex items-center gap-3">
                  <Slider
                    value={[climate.crossfadeDuration]}
                    min={DEFAULTS.minCrossfade}
                    max={DEFAULTS.maxCrossfade}
                    step={1}
                    onValueChange={([val]) =>
                      updateClimate(campaignId, climate.id, { crossfadeDuration: val })
                    }
                    className="flex-1"
                  />
                  <span className="w-8 text-right text-[13px] text-text-secondary">
                    {climate.crossfadeDuration}s
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        <Separator className="my-4 bg-border-subtle" />

        {/* Music and ambient are separate tabs so a climate with many tracks and
            many layers stays readable. */}
        <Tabs defaultValue="music">
          <TabsList>
            <TabsTrigger value="music">Music ({climate.tracks.length})</TabsTrigger>
            <TabsTrigger value="ambient">Ambient ({ambientLayerCount})</TabsTrigger>
          </TabsList>

          <TabsContent value="music" className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                Tracks ({climate.tracks.length})
              </p>
              <Button variant="ghost" size="xs" onClick={() => setAddTrackOpen(true)}>
                <Plus className="size-3" />
                Add Track
              </Button>
            </div>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className="relative"
            >
              {isDragOver && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-accent-muted/20">
                  <div className="flex flex-col items-center gap-1">
                    <Upload className="size-5 text-accent" />
                    <span className="text-[12px] font-medium text-accent">
                      Drop audio files to add tracks
                    </span>
                  </div>
                </div>
              )}
              <TrackList
                tracks={climate.tracks}
                onDeleteTrack={handleDeleteTrack}
                climateColor={climate.color}
                onPlayTrack={handlePlayTrack}
              />
            </div>
          </TabsContent>

          <TabsContent value="ambient" className="mt-4">
            <AmbientLayerList campaign={campaign} climate={climate} />
          </TabsContent>
        </Tabs>
      </div>

      <AddTrackDialog
        open={addTrackOpen}
        onOpenChange={setAddTrackOpen}
        onAddTrack={handleAddTrack}
      />
    </>
  )
}
