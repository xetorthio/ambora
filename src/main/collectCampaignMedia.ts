import { app } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  Campaign,
  CampaignMediaType,
  CollectCampaignMediaResult,
  CollectMediaProgress,
} from '../shared/types'

interface MediaReference {
  mediaType: CampaignMediaType
  localFilePath: string
}

interface CopyTask extends MediaReference {
  size: number
  typeDir: string
}

function mediaReferences(campaign: Campaign): MediaReference[] {
  return [
    ...campaign.climates.flatMap((climate) => [
      ...climate.tracks
        .filter(
          (track): track is typeof track & { localFilePath: string } =>
            track.source === 'local' && Boolean(track.localFilePath),
        )
        .map((track) => ({
          mediaType: 'music' as const,
          localFilePath: track.localFilePath,
        })),
      ...(climate.ambientLayers ?? []).flatMap((layer) =>
        layer.clips.map((clip) => ({
          mediaType: 'ambient' as const,
          localFilePath: clip.localFilePath,
        })),
      ),
    ]),
    ...(campaign.soundboard ?? []).map((sound) => ({
      mediaType: 'sfx' as const,
      localFilePath: sound.localFilePath,
    })),
  ]
}

function isInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function numberedName(filePath: string, index: number): string {
  const extension = extname(filePath)
  const stem = basename(filePath, extension)
  return `${stem}-${index}${extension}`
}

function failureReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code
  switch (code) {
    case 'ENOENT':
      return 'File not found'
    case 'EACCES':
    case 'EPERM':
      return 'Permission denied'
    case 'ENOSPC':
      return 'Not enough disk space'
    case 'EISDIR':
      return 'Source is not a file'
    default:
      return error instanceof Error ? error.message : 'Could not copy file'
  }
}

async function availableDestination(mediaDir: string, sourcePath: string): Promise<string> {
  let candidate = join(mediaDir, basename(sourcePath))
  let index = 2

  while (true) {
    try {
      await stat(candidate)
      candidate = join(mediaDir, numberedName(sourcePath, index))
      index += 1
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return candidate
      throw error
    }
  }
}

async function copyWithProgress(
  sourcePath: string,
  destination: string,
  onChunk: (bytes: number) => void,
): Promise<void> {
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onChunk(chunk.length)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      createReadStream(sourcePath),
      meter,
      createWriteStream(destination, { flags: 'wx' }),
    )
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function collectCampaignMedia(
  campaign: Campaign,
  onProgress?: (progress: CollectMediaProgress) => void,
): Promise<CollectCampaignMediaResult> {
  const campaignsDir = resolve(app.getPath('userData'), 'ambora-data', 'campaigns')
  const campaignDir = resolve(campaignsDir, campaign.id)
  if (!isInside(campaignsDir, campaignDir) || campaignDir === campaignsDir) {
    throw new Error('Invalid campaign id')
  }

  const mediaDir = join(campaignDir, 'media')
  const result: Omit<CollectCampaignMediaResult, 'finalProgress'> = {
    copiedFiles: 0,
    skippedFiles: 0,
    copiedBytes: 0,
    failures: [],
    pathUpdates: [],
  }

  const uniqueReferences = [
    ...new Map(
      mediaReferences(campaign).map((reference) => [
        `${reference.mediaType}\0${reference.localFilePath}`,
        reference,
      ]),
    ).values(),
  ]
  const createdDirs = new Set<string>()
  let completedFiles = 0
  let completedBytes = 0
  let copiedBytes = 0
  onProgress?.({
    completedFiles,
    totalFiles: uniqueReferences.length,
    copiedFiles: result.copiedFiles,
    skippedFiles: result.skippedFiles,
    failedFiles: result.failures.length,
    completedBytes,
    copiedBytes,
    totalBytes: 0,
    failures: [...result.failures],
  })

  const copyTasks: CopyTask[] = []

  for (const { mediaType, localFilePath } of uniqueReferences) {
    try {
      const typeDir = join(mediaDir, mediaType)
      const sourceStats = await stat(localFilePath)
      if (!sourceStats.isFile()) {
        result.failures.push({ sourcePath: localFilePath, reason: 'Source is not a file' })
        completedFiles += 1
        continue
      }

      if (isInside(typeDir, resolve(localFilePath))) {
        result.skippedFiles += 1
        completedFiles += 1
        continue
      }

      copyTasks.push({
        mediaType,
        localFilePath,
        size: sourceStats.size,
        typeDir,
      })
    } catch (error) {
      result.failures.push({
        sourcePath: localFilePath,
        reason: failureReason(error),
      })
      completedFiles += 1
    }
  }

  const totalBytes = copyTasks.reduce((total, task) => total + task.size, 0)
  let lastReportedBytes = 0
  const reportProgress = (): void => {
    onProgress?.({
      completedFiles,
      totalFiles: uniqueReferences.length,
      copiedFiles: result.copiedFiles,
      skippedFiles: result.skippedFiles,
      failedFiles: result.failures.length,
      completedBytes,
      copiedBytes,
      totalBytes,
      failures: [...result.failures],
    })
    lastReportedBytes = completedBytes
  }
  reportProgress()

  for (const task of copyTasks) {
    let taskBytes = 0
    let destination = ''
    try {
      if (!createdDirs.has(task.typeDir)) {
        await mkdir(task.typeDir, { recursive: true })
        createdDirs.add(task.typeDir)
      }
      destination = await availableDestination(task.typeDir, task.localFilePath)
      await copyWithProgress(task.localFilePath, destination, (bytes) => {
        taskBytes += bytes
        completedBytes += bytes
        copiedBytes += bytes
        if (completedBytes - lastReportedBytes >= 1024 * 1024) reportProgress()
      })
      result.copiedFiles += 1
      result.copiedBytes += task.size
      result.pathUpdates.push({
        mediaType: task.mediaType,
        sourcePath: task.localFilePath,
        collectedPath: destination,
      })
    } catch (error) {
      result.failures.push({ sourcePath: task.localFilePath, reason: failureReason(error) })
      completedBytes += task.size - taskBytes
      copiedBytes -= taskBytes
    } finally {
      completedFiles += 1
      reportProgress()
    }
  }

  return {
    ...result,
    finalProgress: {
      completedFiles,
      totalFiles: uniqueReferences.length,
      copiedFiles: result.copiedFiles,
      skippedFiles: result.skippedFiles,
      failedFiles: result.failures.length,
      completedBytes,
      copiedBytes,
      totalBytes,
      failures: [...result.failures],
    },
  }
}
