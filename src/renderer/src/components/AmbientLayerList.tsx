import { useState } from 'react'
import { Plus, Upload, Waves } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AmbientLayerRow } from '@/components/AmbientLayerRow'
import { useCampaignStore } from '@/store/campaignStore'
import { ACCEPTED_AUDIO_EXTENSIONS, AMBIENT_DEFAULTS } from '@/lib/constants'
import { getLocalFileDuration } from '@/lib/utils'
import type { Campaign, Climate } from '@/lib/types'

/** "wind-howling-loop.wav" → "wind-howling-loop" */
function nameFromFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? fileName : fileName.slice(0, dot)
}

interface AmbientLayerListProps {
  campaign: Campaign
  climate: Climate
}

export function AmbientLayerList({ campaign, climate }: AmbientLayerListProps): React.JSX.Element {
  const createAmbientLayer = useCampaignStore((s) => s.createAmbientLayer)
  const [isDragOver, setIsDragOver] = useState(false)

  const layers = [...(climate.ambientLayers ?? [])].sort((a, b) => a.order - b.order)
  const atLimit = layers.length >= AMBIENT_DEFAULTS.maxLayers
  const copyTargets = campaign.climates
    .filter((cl) => cl.id !== climate.id)
    .sort((a, b) => a.order - b.order)
    .map((cl) => ({ id: cl.id, name: cl.name }))

  function handleAddLayer(): void {
    if (!createAmbientLayer(campaign.id, climate.id, 'New Layer')) {
      toast.error(`A climate can have at most ${String(AMBIENT_DEFAULTS.maxLayers)} ambient layers`)
    }
  }

  /**
   * Dropping files here creates one Loop layer per file. A single dropped file is
   * nearly always a bed (wind, rain, murmur); clips that belong together as
   * variations get dropped onto an expanded layer instead.
   */
  async function handleDropFiles(files: File[]): Promise<void> {
    const audioFiles = files.filter((f) => {
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase()
      return ACCEPTED_AUDIO_EXTENSIONS.includes(ext)
    })

    let created = 0
    for (const file of audioFiles) {
      const localFilePath = window.api.getPathForFile(file)
      const duration = await getLocalFileDuration(localFilePath)
      const layer = createAmbientLayer(campaign.id, climate.id, nameFromFile(file.name), [
        { title: file.name, localFilePath, duration },
      ])
      if (!layer) break
      created++
    }

    if (created > 0) {
      toast.success(`${String(created)} ambient layer${created > 1 ? 's' : ''} added`)
    }
    if (created < audioFiles.length) {
      toast.error(`A climate can have at most ${String(AMBIENT_DEFAULTS.maxLayers)} ambient layers`)
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
    void handleDropFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Ambient Layers ({layers.length})
        </p>
        <Button variant="ghost" size="xs" onClick={handleAddLayer} disabled={atLimit}>
          <Plus className="size-3" />
          Add Layer
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
                Drop audio files to add layers
              </span>
            </div>
          </div>
        )}

        {layers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-text-tertiary">
            <Waves className="size-8" />
            <p className="text-[13px]">No ambient layers yet</p>
            <p className="max-w-[380px] text-center text-[12px]">
              Layers play under the music: wind looping, birds every 8&ndash;20 seconds, a raven
              when you tap it. Drop audio files here to start.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {layers.map((layer) => (
              <AmbientLayerRow
                key={layer.id}
                layer={layer}
                campaignId={campaign.id}
                climateId={climate.id}
                climateColor={climate.color}
                copyTargets={copyTargets}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
