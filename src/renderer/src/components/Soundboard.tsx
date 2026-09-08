import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  FolderPlus,
  Grid3X3,
  Maximize2,
  Play,
  Plus,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { SoundboardEngine, type SoundboardActivity } from '@/audio/SoundboardEngine'
import { probeSoundboardTrack } from '@/audio/probeTrack'
import { SoundKey } from '@/components/SoundKey'
import { SoundIconPicker } from '@/components/SoundIconPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ACCEPTED_AUDIO, ACCEPTED_AUDIO_EXTENSIONS, SOUNDBOARD_DEFAULTS } from '@/lib/constants'
import { validateLocalAudioFile } from '@/lib/validateLocalAudio'
import { SOUND_ICON_MAP, type SoundboardIconName } from '@/lib/soundIconMap'
import { useCampaignStore } from '@/store/campaignStore'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import type { Campaign, SoundboardPlaybackMode, SoundboardSound } from '@/lib/types'

interface SoundboardProps {
  campaign: Campaign
}

type PanelMode = 'expanded' | 'compact' | 'hidden'

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || 'Audio file unavailable'
}

function iconFor(
  name: string | undefined,
): (typeof SOUND_ICON_MAP)[SoundboardIconName] | undefined {
  return name ? SOUND_ICON_MAP[name as SoundboardIconName] : undefined
}

function isLetter(key: string): boolean {
  return /^\p{L}$/u.test(key)
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  )
}

function RelinkSoundWarning({
  sound,
  reason,
  onRelink,
}: {
  sound: SoundboardSound
  reason: string
  onRelink: (file: File) => void | Promise<void>
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_AUDIO}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onRelink(file)
          event.target.value = ''
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded text-warning hover:bg-warning/10"
            onClick={() => inputRef.current?.click()}
            aria-label={`Relocate ${sound.name}: ${reason}`}
          >
            <TriangleAlert className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="max-w-[280px]">
          <p className="font-medium">This sound can&rsquo;t be played</p>
          <p className="text-text-secondary">{reason}</p>
          <p className="text-accent">Click to locate the file</p>
        </TooltipContent>
      </Tooltip>
    </>
  )
}

export function Soundboard({ campaign }: SoundboardProps): React.JSX.Element {
  const {
    addSoundboardSound,
    updateSoundboardSound,
    relinkSoundboardSound,
    deleteSoundboardSound,
  } = useCampaignStore()
  const sounds = useMemo(
    () => [...(campaign.soundboard ?? [])].sort((a, b) => a.order - b.order),
    [campaign.soundboard],
  )
  const [panelMode, setPanelMode] = useState<PanelMode>(() => {
    const saved = localStorage.getItem('ambora:soundboard-mode')
    return saved === 'compact' || saved === 'hidden' ? saved : 'expanded'
  })
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [activityById, setActivityById] = useState<Record<string, SoundboardActivity>>({})
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const unplayable = useDiagnosticsStore((state) => state.unplayable)
  const assignedSounds = sounds.filter((sound) => sound.shortcutKey)
  const unavailableCount = sounds.reduce(
    (count, sound) => count + (unplayable[sound.id] ? 1 : 0),
    0,
  )

  useEffect(() => {
    localStorage.setItem('ambora:soundboard-mode', panelMode)
  }, [panelMode])

  const play = useCallback(async (sound: SoundboardSound, fullVolume = false): Promise<void> => {
    try {
      const diagnostics = useDiagnosticsStore.getState()
      if (diagnostics.unplayable[sound.id]) {
        const probe = await probeSoundboardTrack(sound.localFilePath)
        if (!probe.ok) {
          const reason = probe.reason ?? 'Audio file could not be read — locate it to play'
          diagnostics.setUnplayable(sound.id, { source: 'probe', reason })
          toast.error(reason)
          return
        }
        diagnostics.clearUnplayable(sound.id)
      }
      await SoundboardEngine.getInstance().trigger(sound, fullVolume)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not play ${sound.name}`)
    }
  }, [])

  useEffect(
    () =>
      SoundboardEngine.getInstance().subscribe((soundId, activity) => {
        setActivityById((current) => ({ ...current, [soundId]: activity }))
      }),
    [],
  )

  useEffect(() => {
    const engine = SoundboardEngine.getInstance()
    return () => engine.stopAll()
  }, [campaign.id])

  useEffect(() => {
    const toProbe = sounds.filter((sound) => !useDiagnosticsStore.getState().hasProbed(sound.id))
    if (toProbe.length === 0) return

    let cancelled = false
    void (async () => {
      for (const sound of toProbe) {
        if (cancelled) return
        const diagnostics = useDiagnosticsStore.getState()
        if (diagnostics.hasProbed(sound.id)) continue
        const { ok, reason } = await probeSoundboardTrack(sound.localFilePath)
        if (cancelled) return
        diagnostics.markProbed(sound.id)
        if (!ok) {
          diagnostics.setUnplayable(sound.id, {
            source: 'probe',
            reason: reason ?? 'Audio file could not be read — locate it to play',
          })
          continue
        }
        // Re-read rather than reusing the snapshot taken before the await: a
        // pad pressed mid-probe can record a 'playback' diagnostic in the
        // meantime, and clearing on the stale value would discard it.
        const current = useDiagnosticsStore.getState().unplayable[sound.id]
        if (current?.source === 'probe') {
          diagnostics.clearUnplayable(sound.id)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sounds])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
      if (isEditableTarget(event.target)) return

      if (assigningId) {
        event.preventDefault()
        if (event.key === 'Escape') {
          setAssigningId(null)
          return
        }
        const key = event.key.toLocaleLowerCase()
        if (!isLetter(key)) {
          toast.error('Use a letter for sound shortcuts')
          return
        }
        const conflict = sounds.find(
          (sound) => sound.id !== assigningId && sound.shortcutKey === key,
        )
        if (conflict) {
          toast.error(`${key.toLocaleUpperCase()} is already assigned to ${conflict.name}`)
          return
        }
        updateSoundboardSound(campaign.id, assigningId, { shortcutKey: key })
        setAssigningId(null)
        return
      }

      const key = event.key.toLocaleLowerCase()
      if (!isLetter(key)) return
      const sound = sounds.find((item) => item.shortcutKey === key)
      if (!sound) return
      event.preventDefault()
      void play(sound, event.shiftKey)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [assigningId, campaign.id, play, sounds, updateSoundboardSound])

  async function addFiles(files: FileList | File[] | null): Promise<void> {
    if (!files) return
    const audioFiles = Array.from(files).filter((file) => {
      const extension = file.name.substring(file.name.lastIndexOf('.')).toLocaleLowerCase()
      return ACCEPTED_AUDIO_EXTENSIONS.includes(extension)
    })
    const createdIds: string[] = []
    for (const file of audioFiles) {
      const validated = await validateLocalAudioFile(file)
      if (!validated) continue
      const created = addSoundboardSound(campaign.id, {
        name: validated.title.replace(/\.[^.]+$/, ''),
        localFilePath: validated.localFilePath,
        duration: validated.duration,
        volume: SOUNDBOARD_DEFAULTS.volume,
        playbackMode: 'restart',
        pitchVariation: SOUNDBOARD_DEFAULTS.pitchVariation,
      })
      if (created) createdIds.push(created.id)
    }
    if (createdIds.length === 1) setAssigningId(createdIds[0])
    if (createdIds.length > 0) {
      toast.success(`${String(createdIds.length)} sound${createdIds.length === 1 ? '' : 's'} added`)
    } else if (audioFiles.length === 0 && files.length > 0) {
      toast.error('No supported audio files found')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  async function relinkSound(soundId: string, file: File): Promise<void> {
    const validated = await validateLocalAudioFile(file)
    if (!validated) return
    SoundboardEngine.getInstance().stop(soundId)
    relinkSoundboardSound(campaign.id, soundId, validated.localFilePath, validated.duration)
    const diagnostics = useDiagnosticsStore.getState()
    diagnostics.forgetTrack(soundId)
    diagnostics.markProbed(soundId)
    toast.success('Sound file relocated')
  }

  return (
    <section
      className="shrink-0 border-t border-border bg-surface-1"
      onDragEnter={(event) => {
        event.preventDefault()
        setIsDragOver(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setIsDragOver(false)
        void addFiles(event.dataTransfer.files)
      }}
    >
      <TooltipProvider delayDuration={500}>
        <div
          className={`overflow-hidden transition-colors ${isDragOver ? 'bg-accent-muted ring-1 ring-inset ring-accent' : ''}`}
        >
          <div className="flex min-h-10 items-center gap-3 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">
                Soundboard ({String(sounds.length)})
              </span>
              {panelMode === 'hidden' && unavailableCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="flex size-5 items-center justify-center text-warning"
                      aria-label={`${String(unavailableCount)} unavailable sound${unavailableCount === 1 ? '' : 's'}`}
                      tabIndex={0}
                    >
                      <TriangleAlert className="size-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {String(unavailableCount)} sound{unavailableCount === 1 ? '' : 's'} cannot be
                    played
                  </TooltipContent>
                </Tooltip>
              )}
              {panelMode !== 'hidden' && (
                <span className="truncate text-[11px] text-text-tertiary">
                  Letter plays · Shift + letter plays at 100%
                </span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_AUDIO}
              multiple
              className="hidden"
              onChange={(event) => void addFiles(event.target.files)}
            />
            <input
              ref={(node) => {
                folderInputRef.current = node
                node?.setAttribute('webkitdirectory', '')
              }}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void addFiles(event.target.files)}
            />
            {panelMode !== 'hidden' && (
              <>
                <Button variant="ghost" size="sm" onClick={() => folderInputRef.current?.click()}>
                  <FolderPlus className="size-4" /> Add folder
                </Button>
                <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Plus className="size-4" /> Add sound
                </Button>
              </>
            )}
            {panelMode === 'expanded' && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Compact soundboard"
                onClick={() => setPanelMode('compact')}
              >
                <Grid3X3 className="size-4" />
              </Button>
            )}
            {panelMode === 'compact' && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open soundboard"
                onClick={() => setPanelMode('expanded')}
              >
                <Maximize2 className="size-4" />
              </Button>
            )}
            {panelMode === 'hidden' && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open compact soundboard"
                  onClick={() => setPanelMode('compact')}
                >
                  <Grid3X3 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open full soundboard"
                  onClick={() => setPanelMode('expanded')}
                >
                  <Maximize2 className="size-4" />
                </Button>
              </>
            )}
            {panelMode !== 'hidden' && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Hide soundboard"
                onClick={() => setPanelMode('hidden')}
              >
                <ChevronDown className="size-4" />
              </Button>
            )}
          </div>

          {panelMode === 'expanded' && (
            <div className="max-h-[38vh] overflow-y-auto border-t border-border-subtle">
              {sounds.length === 0 ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-center py-8 text-[13px] text-text-tertiary hover:text-text-secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Add local one-shot sounds to this campaign
                </button>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,680px),1fr))] gap-px bg-border-subtle">
                  {sounds.map((sound) => (
                    <div
                      key={sound.id}
                      className={`grid min-h-14 grid-cols-[48px_minmax(80px,1fr)_32px_92px_minmax(80px,140px)_132px_32px_24px] items-center gap-2 px-3 ${unplayable[sound.id] ? 'bg-warning/5' : 'bg-surface-1'}`}
                    >
                      <SoundKey
                        letter={
                          assigningId === sound.id
                            ? '…'
                            : (sound.shortcutKey?.toLocaleUpperCase() ?? 'Set')
                        }
                        activity={activityById[sound.id]}
                        icon={iconFor(sound.icon)}
                        iconColor={sound.iconColor}
                        onClick={() => setAssigningId(sound.id)}
                        aria-label={`Assign letter to ${sound.name}`}
                      />
                      <div className="flex min-w-0 items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Input
                              value={sound.name}
                              className="h-8 min-w-0 border-transparent bg-transparent px-2 text-[13px] hover:border-border focus:border-border"
                              onChange={(event) =>
                                updateSoundboardSound(campaign.id, sound.id, {
                                  name: event.target.value,
                                })
                              }
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {fileName(sound.localFilePath)}
                          </TooltipContent>
                        </Tooltip>
                        {unplayable[sound.id] ? (
                          <RelinkSoundWarning
                            sound={sound}
                            reason={unplayable[sound.id].reason}
                            onRelink={(file) => relinkSound(sound.id, file)}
                          />
                        ) : !sound.icon && !sound.shortcutKey ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="flex size-6 shrink-0 items-center justify-center text-text-tertiary"
                                aria-label={`${sound.name} is hidden from the phone remote`}
                                tabIndex={0}
                              >
                                <TriangleAlert className="size-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              Assign an icon or letter to show this sound on the phone
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                      <SoundIconPicker
                        selectedIcon={sound.icon}
                        selectedColor={sound.iconColor}
                        onSelectIcon={(icon) =>
                          updateSoundboardSound(campaign.id, sound.id, { icon })
                        }
                        onSelectColor={(iconColor) =>
                          updateSoundboardSound(campaign.id, sound.id, { iconColor })
                        }
                      />
                      <select
                        value={sound.playbackMode ?? 'restart'}
                        className="h-8 rounded-sm border border-border bg-surface-2 px-2 text-[11px] text-text-secondary"
                        aria-label={`${sound.name} repeat behavior`}
                        onChange={(event) =>
                          updateSoundboardSound(campaign.id, sound.id, {
                            playbackMode: event.target.value as SoundboardPlaybackMode,
                          })
                        }
                      >
                        <option value="ignore">Ignore</option>
                        <option value="stop">Stop</option>
                        <option value="restart">Restart</option>
                        <option value="multiple">Multiple</option>
                        <option value="loop">Loop</option>
                      </select>
                      <div className="flex items-center gap-2">
                        <Slider
                          value={[sound.volume]}
                          onValueChange={([volume]) =>
                            updateSoundboardSound(campaign.id, sound.id, { volume })
                          }
                          aria-label={`${sound.name} volume`}
                        />
                        <span className="w-8 text-right text-[11px] tabular-nums text-text-tertiary">
                          {sound.volume}%
                        </span>
                      </div>
                      <label className="flex items-center gap-2 text-[10px] text-text-tertiary">
                        <Slider
                          min={0}
                          max={20}
                          step={1}
                          value={[sound.pitchVariation ?? 0]}
                          className="w-14 shrink-0"
                          aria-label={`${sound.name} pitch variation percent`}
                          onValueChange={([pitchVariation]) =>
                            updateSoundboardSound(campaign.id, sound.id, { pitchVariation })
                          }
                        />
                        <span className="w-16 whitespace-nowrap text-right tabular-nums">
                          Pitch ±{sound.pitchVariation ?? 0}%
                        </span>
                      </label>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={
                          sound.playbackMode === 'loop' && activityById[sound.id]?.playing
                            ? `Stop ${sound.name}`
                            : `Play ${sound.name}`
                        }
                        onClick={() => void play(sound)}
                      >
                        {sound.playbackMode === 'loop' && activityById[sound.id]?.playing ? (
                          <Square className="size-3.5 fill-current" />
                        ) : (
                          <Play className="size-4 fill-current" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-text-tertiary hover:text-danger"
                        aria-label={`Delete ${sound.name}`}
                        onClick={() => {
                          SoundboardEngine.getInstance().stop(sound.id)
                          deleteSoundboardSound(campaign.id, sound.id)
                          useDiagnosticsStore.getState().forgetTrack(sound.id)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {panelMode === 'compact' && (
            <div className="border-t border-border-subtle p-3">
              {assignedSounds.length > 0 ? (
                <div className="grid w-fit max-w-full grid-cols-[repeat(6,44px)] gap-2">
                  {assignedSounds.map((sound) => (
                    <div key={sound.id} className="relative">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SoundKey
                            letter={sound.shortcutKey?.toLocaleUpperCase() ?? ''}
                            activity={activityById[sound.id]}
                            icon={iconFor(sound.icon)}
                            iconColor={sound.iconColor}
                            className={unplayable[sound.id] ? 'opacity-50' : undefined}
                            size="large"
                            onClick={(event) => void play(sound, event.shiftKey)}
                            aria-label={
                              unplayable[sound.id]
                                ? `${sound.name}: ${unplayable[sound.id].reason}. Click to retry`
                                : `Play ${sound.name}`
                            }
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {sound.name} ·{' '}
                          {unplayable[sound.id]?.reason ?? fileName(sound.localFilePath)}
                        </TooltipContent>
                      </Tooltip>
                      {unplayable[sound.id] && (
                        <TriangleAlert
                          className="pointer-events-none absolute -top-1 -right-1 z-30 size-4 rounded-full bg-surface-1 text-warning"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[12px] text-text-tertiary">No letters assigned yet</span>
              )}
            </div>
          )}
        </div>
      </TooltipProvider>
    </section>
  )
}
