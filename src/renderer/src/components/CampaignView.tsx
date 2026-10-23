import { useEffect, useState } from 'react'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
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
import { ClimateGrid } from '@/components/ClimateGrid'
import { useInlineEdit } from '@/hooks/useInlineEdit'
import { debugLog } from '@/lib/debugLog'
import { useCampaignStore } from '@/store/campaignStore'
import { useDiagnosticsStore } from '@/store/diagnosticsStore'
import type { Campaign } from '@/lib/types'
import { toast } from 'sonner'

interface CampaignViewProps {
  campaign: Campaign
}

export function CampaignView({ campaign }: CampaignViewProps): React.JSX.Element {
  const { updateCampaign, deleteCampaign } = useCampaignStore()
  const [isGridReady, setIsGridReady] = useState(false)

  useEffect(() => {
    debugLog('campaign-view-mounted', {
      campaignId: campaign.id,
      climateCount: campaign.climates.length,
    })
  }, [campaign.climates.length, campaign.id])

  useEffect(() => {
    debugLog('campaign-grid-loading-shown', { campaignId: campaign.id })
    // Give the centered loading state one complete paint before mounting a
    // potentially large card grid. This makes selection feel responsive even
    // when rendering the destination campaign takes noticeable time.
    let secondFrame: number | null = null
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        debugLog('campaign-grid-loading-finished', { campaignId: campaign.id })
        setIsGridReady(true)
        useDiagnosticsStore.getState().setCampaignLoading(null)
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) cancelAnimationFrame(secondFrame)
    }
  }, [campaign.id])

  const {
    isEditing: nameIsEditing,
    editValue: nameEditValue,
    setEditValue: setNameEditValue,
    startEditing: startNameEditing,
    handleSave: handleNameSave,
    handleKeyDown: handleNameKeyDown,
    inputProps: nameInputProps,
  } = useInlineEdit({
    value: campaign.name,
    onSave: (name) => updateCampaign(campaign.id, { name }),
  })

  const {
    isEditing: descIsEditing,
    editValue: descEditValue,
    setEditValue: setDescEditValue,
    startEditing: startDescEditing,
    handleSave: handleDescSave,
    handleKeyDown: handleDescKeyDown,
    inputProps: descInputProps,
  } = useInlineEdit({
    value: campaign.description ?? '',
    onSave: (description) => updateCampaign(campaign.id, { description: description || undefined }),
  })

  function handleDelete(): void {
    deleteCampaign(campaign.id)
    toast.success('Campaign deleted')
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-start justify-between px-8 pt-8 pb-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="relative flex items-center gap-2">
            {nameIsEditing ? (
              <Input
                {...nameInputProps}
                value={nameEditValue}
                onChange={(e) => setNameEditValue(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={handleNameKeyDown}
                className="h-9 text-[22px] font-semibold tracking-[-0.02em]"
              />
            ) : (
              <>
                <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary">
                  {campaign.name}
                </h1>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-text-tertiary hover:text-text-secondary"
                  onClick={startNameEditing}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </>
            )}
          </div>
          {descIsEditing ? (
            <Input
              {...descInputProps}
              value={descEditValue}
              onChange={(e) => setDescEditValue(e.target.value)}
              onBlur={handleDescSave}
              onKeyDown={handleDescKeyDown}
              placeholder="Add a description..."
              className="h-7 text-[13px]"
            />
          ) : (
            <p
              className="cursor-pointer text-[13px] text-text-secondary hover:text-text-primary"
              onClick={startDescEditing}
            >
              {campaign.description || 'Add a description...'}
            </p>
          )}
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-text-tertiary hover:text-danger"
            >
              <Trash2 className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{campaign.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this campaign, all its climates, and all tracks.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="px-8 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Climates
        </p>
      </div>

      {isGridReady ? (
        <ClimateGrid campaign={campaign} />
      ) : (
        <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-3 text-text-tertiary">
          <Loader2 className="size-6 animate-spin text-accent" />
          <span className="text-[13px]">Loading climates…</span>
        </div>
      )}
    </div>
  )
}
