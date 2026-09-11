import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, MoreVertical, Plus } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCampaignStore } from '@/store/campaignStore'
import { useInlineEdit } from '@/hooks/useInlineEdit'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { serializeCampaignForExport, deserializeCampaignFromImport } from '@/lib/campaignExport'
import type { Campaign, CollectCampaignMediaResult, CollectMediaProgress } from '@/lib/types'
import { AmboraLogo } from './AmboraLogo'
import { QRCodePanel } from './QRCodePanel'

function CampaignItem({
  campaign,
  isActive,
  onSelect,
}: {
  campaign: Campaign
  isActive: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { id, name } = campaign
  const { updateCampaign, deleteCampaign, collectCampaignMedia } = useCampaignStore()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [collectOpen, setCollectOpen] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collectResult, setCollectResult] = useState<CollectCampaignMediaResult | null>(null)
  const [collectProgress, setCollectProgress] = useState<CollectMediaProgress>({
    completedFiles: 0,
    totalFiles: 0,
    copiedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    completedBytes: 0,
    copiedBytes: 0,
    totalBytes: 0,
    failures: [],
  })

  const {
    isEditing: renameIsEditing,
    editValue: renameEditValue,
    setEditValue: setRenameEditValue,
    startEditing: startRenameEditing,
    handleSave: handleRenameSave,
    handleKeyDown: handleRenameKeyDown,
    inputProps: renameInputProps,
  } = useInlineEdit({
    value: name,
    onSave: (newName) => updateCampaign(id, { name: newName }),
  })

  async function handleExport(): Promise<void> {
    try {
      const appVersion = await window.api.getAppVersion()
      const json = serializeCampaignForExport(campaign, appVersion)
      const suggestedName = `${campaign.name.replace(/[^a-zA-Z0-9 _-]/g, '')}.ambora`
      const saved = await window.api.exportCampaign(json, suggestedName)
      if (saved) toast.success('Campaign exported')
    } catch {
      toast.error('Failed to export campaign')
    }
  }

  function handleDelete(): void {
    deleteCampaign(id)
    toast.success('Campaign deleted')
  }

  async function handleCollectMedia(): Promise<void> {
    setCollecting(true)
    setCollectProgress(emptyCollectProgress())
    try {
      const result = await collectCampaignMedia(id, setCollectProgress)
      if (!result) {
        toast.error('Campaign no longer exists')
        setCollectOpen(false)
        return
      }
      setCollectResult(result)
    } catch {
      toast.error('Failed to collect campaign media')
    } finally {
      setCollecting(false)
    }
  }

  function openCollectDialog(): void {
    setCollectResult(null)
    setCollectProgress(emptyCollectProgress())
    setCollectOpen(true)
  }

  return (
    <>
      <div
        className={cn(
          'group flex items-center gap-1 overflow-hidden rounded-md px-3 py-2 text-[14px] transition-colors',
          isActive ? 'bg-accent-muted text-text-primary' : 'text-text-secondary hover:bg-surface-3',
        )}
      >
        {renameIsEditing ? (
          <Input
            {...renameInputProps}
            value={renameEditValue}
            onChange={(e) => setRenameEditValue(e.target.value)}
            onBlur={handleRenameSave}
            onKeyDown={handleRenameKeyDown}
            className="h-6 flex-1 text-[14px]"
          />
        ) : (
          <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={onSelect}>
            {name}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-text-tertiary hover:text-text-primary"
            >
              <MoreVertical className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="right">
            <DropdownMenuItem onClick={startRenameEditing}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={openCollectDialog}>Collect Media</DropdownMenuItem>
            <DropdownMenuItem onClick={handleExport}>Export</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this campaign and all its data.
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

      <Dialog
        open={collectOpen}
        onOpenChange={(open) => {
          if (!collecting) setCollectOpen(open)
        }}
      >
        <DialogContent className="max-w-[480px]" showCloseButton={false}>
          {collecting || collectResult ? (
            <>
              <DialogHeader>
                <DialogTitle>Collect media for &ldquo;{name}&rdquo;</DialogTitle>
                <DialogDescription>
                  Local media is copied into this campaign&rsquo;s internal managed media folder.
                  Original files are not moved or deleted.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <CollectionMetrics
                  copiedFiles={collectProgress.copiedFiles}
                  copiedBytes={collectProgress.copiedBytes}
                  skippedFiles={collectProgress.skippedFiles}
                />
                <CollectProgress progress={collectProgress} complete={!collecting} />
                {collectProgress.failures.length > 0 ? (
                  <CollectionFailures failures={collectProgress.failures} />
                ) : (
                  !collecting && (
                    <div className="flex items-center gap-2 text-[13px] text-success">
                      <CheckCircle2 className="size-4" />
                      All referenced local files are available in the campaign folder.
                    </div>
                  )
                )}
              </div>
              <DialogFooter>
                <Button disabled={collecting} onClick={() => setCollectOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Collect media for &ldquo;{name}&rdquo;?</DialogTitle>
                <DialogDescription>
                  Copy all local music, ambient clips, and soundboard sounds into this
                  campaign&rsquo;s internal managed media folder. Original files will not be moved
                  or deleted.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCollectOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void handleCollectMedia()}>Collect Media</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function emptyCollectProgress(): CollectMediaProgress {
  return {
    completedFiles: 0,
    totalFiles: 0,
    copiedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    completedBytes: 0,
    copiedBytes: 0,
    totalBytes: 0,
    failures: [],
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function ResultMetric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-surface-2 p-3">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span className="truncate text-[14px] font-medium text-text-primary">{value}</span>
    </div>
  )
}

function CollectionMetrics({
  copiedFiles,
  copiedBytes,
  skippedFiles,
}: {
  copiedFiles: number
  copiedBytes: number
  skippedFiles: number
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-3">
      <ResultMetric label="Copied" value={String(copiedFiles)} />
      <ResultMetric label="Disk used" value={formatBytes(copiedBytes)} />
      <ResultMetric label="Already there" value={String(skippedFiles)} />
    </div>
  )
}

function CollectionFailures({
  failures,
}: {
  failures: CollectMediaProgress['failures']
}): React.JSX.Element {
  return (
    <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-md border border-warning/30 bg-warning/10 p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-warning">
        <AlertTriangle className="size-4 shrink-0" />
        {failures.length} file{failures.length === 1 ? '' : 's'} could not be collected
      </div>
      <ul className="flex flex-col gap-2">
        {failures.map((failure) => (
          <li key={failure.sourcePath} className="min-w-0 text-[12px] text-warning/80">
            <p className="break-all text-text-secondary">{failure.sourcePath}</p>
            <p>{failure.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CollectProgress({
  progress,
  complete,
}: {
  progress: CollectMediaProgress
  complete: boolean
}): React.JSX.Element {
  const percentage =
    progress.totalBytes > 0
      ? Math.round((progress.completedBytes / progress.totalBytes) * 100)
      : progress.totalFiles > 0 && progress.completedFiles === progress.totalFiles
        ? 100
        : 0

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center justify-between text-[12px] text-text-secondary">
        <span>
          {complete
            ? 'Collection complete'
            : progress.totalFiles === 0
              ? 'Preparing files...'
              : 'Collecting files...'}
        </span>
        {progress.totalFiles > 0 && (
          <span>
            {progress.completedFiles} of {progress.totalFiles}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Collecting campaign media"
        aria-valuemin={0}
        aria-valuemax={progress.totalBytes || 1}
        aria-valuenow={progress.completedBytes}
        className="h-2 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  const { campaigns, activeCampaignId, setActiveCampaign, createCampaign, importCampaign } =
    useCampaignStore()
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [importPreview, setImportPreview] = useState<{
    campaign: Campaign
    warnings: string[]
  } | null>(null)

  function handleCreate(): void {
    const trimmed = newName.trim()
    if (!trimmed) return
    const campaign = createCampaign(trimmed, newDescription.trim() || undefined)
    setActiveCampaign(campaign.id)
    setNewName('')
    setNewDescription('')
    setNewDialogOpen(false)
    toast.success('Campaign created')
  }

  async function handleImportFile(): Promise<void> {
    try {
      const raw = await window.api.importCampaign()
      if (!raw) return
      const result = deserializeCampaignFromImport(raw)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setImportPreview({ campaign: result.campaign, warnings: result.warnings })
    } catch {
      toast.error('Failed to read import file')
    }
  }

  function handleConfirmImport(): void {
    if (!importPreview) return
    importCampaign(importPreview.campaign)
    setActiveCampaign(importPreview.campaign.id)
    toast.success(`Imported "${importPreview.campaign.name}"`)
    setImportPreview(null)
  }

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border-subtle bg-surface-1">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <AmboraLogo size={32} />
        <h1 className="text-[22px] font-light tracking-[0.25em] text-text-primary opacity-95">
          AMBORA
        </h1>
      </div>

      <div className="px-5 pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Campaigns
        </p>
      </div>

      <ScrollArea className="flex-1 px-2 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex flex-col gap-0.5">
          {campaigns.map((c) => (
            <CampaignItem
              key={c.id}
              campaign={c}
              isActive={c.id === activeCampaignId}
              onSelect={() => setActiveCampaign(c.id)}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="flex flex-col gap-0.5 px-3 py-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-text-secondary"
          onClick={() => setNewDialogOpen(true)}
        >
          <Plus className="size-4" />
          New Campaign
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-text-secondary"
          onClick={handleImportFile}
        >
          <Download className="size-4" />
          Import Campaign
        </Button>
      </div>

      <QRCodePanel />

      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>New Campaign</DialogTitle>
            <DialogDescription>Create a new campaign to organize your climates.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="campaign-name">Name</Label>
              <Input
                id="campaign-name"
                placeholder="Campaign name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="campaign-desc">Description (optional)</Label>
              <Input
                id="campaign-desc"
                placeholder="A brief description..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={!newName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importPreview !== null}
        onOpenChange={(open) => !open && setImportPreview(null)}
      >
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Import Campaign</DialogTitle>
            <DialogDescription>Review the campaign before importing.</DialogDescription>
          </DialogHeader>
          {importPreview && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-[14px] font-medium text-text-primary">
                  {importPreview.campaign.name}
                </p>
                {importPreview.campaign.description && (
                  <p className="text-[13px] text-text-secondary">
                    {importPreview.campaign.description}
                  </p>
                )}
                <p className="text-[13px] text-text-secondary">
                  {importPreview.campaign.climates.length} climate
                  {importPreview.campaign.climates.length !== 1 ? 's' : ''}
                  {' / '}
                  {importPreview.campaign.climates.reduce(
                    (sum, cl) => sum + cl.tracks.length,
                    0,
                  )}{' '}
                  track
                  {importPreview.campaign.climates.reduce(
                    (sum, cl) => sum + cl.tracks.length,
                    0,
                  ) !== 1
                    ? 's'
                    : ''}
                </p>
              </div>
              {importPreview.warnings.length > 0 && (
                <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/10 p-3">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-warning">
                    <AlertTriangle className="size-4" />
                    Warnings
                  </div>
                  <ul className="flex flex-col gap-1">
                    {importPreview.warnings.map((w) => (
                      <li key={w} className="text-[12px] text-warning/80">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportPreview(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImport}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
