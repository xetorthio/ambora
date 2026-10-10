import { loadLufsCache, saveLufsCache } from './data'
import { analyzeLufs, cancelLufs } from './lufsAnalyze'
import { fingerprintAudioFile } from './lufsFingerprint'
import type { LufsAnalyzeResult } from '../shared/audioTools'
import { stat } from 'node:fs/promises'

const SAVE_DEBOUNCE_MS = 2000
interface PathFingerprint {
  fingerprint: string
  size: number
  mtimeMs: number
  dev: number
  ino: number
}

const pathFingerprintCache = new Map<string, PathFingerprint>()
const cancelledRequestIds = new Set<string>()
const inFlightRequestIds = new Set<string>()
const inFlightAnalyses = new Map<string, Promise<LufsAnalyzeResult>>()
let cache: Map<string, number> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false

function getCache(): Map<string, number> {
  if (cache) return cache

  const persisted = loadLufsCache()
  const entries = Object.entries(persisted).filter(
    ([key, value]) => key.startsWith('v1:') && typeof value === 'number' && Number.isFinite(value),
  )
  cache = new Map(entries)
  // Path-keyed entries from older versions are intentionally not migrated.
  // Rewrite once so the next launch no longer has to parse dead cache data.
  if (entries.length !== Object.keys(persisted).length) {
    dirty = true
    scheduleSave()
  }
  return cache
}

function persist(): void {
  if (!cache || !dirty) return
  saveLufsCache(Object.fromEntries(cache))
  dirty = false
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persist()
  }, SAVE_DEBOUNCE_MS)
}

async function fingerprintForPath(filePath: string): Promise<string> {
  const fileStat = await stat(filePath)
  const existing = pathFingerprintCache.get(filePath)
  if (
    existing &&
    existing.size === fileStat.size &&
    existing.mtimeMs === fileStat.mtimeMs &&
    existing.dev === fileStat.dev &&
    existing.ino === fileStat.ino
  ) {
    return existing.fingerprint
  }

  const fingerprint = await fingerprintAudioFile(filePath)
  pathFingerprintCache.set(filePath, {
    fingerprint,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    dev: fileStat.dev,
    ino: fileStat.ino,
  })
  return fingerprint
}

/**
 * Looks up or measures loudness entirely in the main process. This keeps file
 * access and the persistent, content-addressed cache in the same owner.
 */
export async function getLufs(filePath: string, requestId: string): Promise<LufsAnalyzeResult> {
  inFlightRequestIds.add(requestId)
  try {
    const fingerprint = await fingerprintForPath(filePath)
    if (cancelledRequestIds.has(requestId)) {
      return { ok: false, reason: 'cancelled', cancelled: true }
    }

    const cached = getCache().get(fingerprint)
    if (cached !== undefined) return { ok: true, integratedLufs: cached, cached: true }

    let analysis = inFlightAnalyses.get(fingerprint)
    if (!analysis) {
      analysis = analyzeLufs(filePath, requestId)
      inFlightAnalyses.set(fingerprint, analysis)
      void analysis.finally(() => {
        // A test reset or a later analysis may have installed a new promise for
        // this fingerprint before this one settles.
        if (inFlightAnalyses.get(fingerprint) === analysis) {
          inFlightAnalyses.delete(fingerprint)
        }
      })
    }
    const result = await analysis
    if (cancelledRequestIds.has(requestId)) {
      return { ok: false, reason: 'cancelled', cancelled: true }
    }
    if (result.ok && !cancelledRequestIds.has(requestId)) {
      getCache().set(fingerprint, result.integratedLufs)
      dirty = true
      scheduleSave()
    }
    return result
  } catch (error) {
    if (cancelledRequestIds.has(requestId)) {
      return { ok: false, reason: 'cancelled', cancelled: true }
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not fingerprint audio file',
    }
  } finally {
    cancelledRequestIds.delete(requestId)
    inFlightRequestIds.delete(requestId)
  }
}

export function cancelLufsRequest(requestId: string): void {
  if (!inFlightRequestIds.has(requestId)) return
  cancelledRequestIds.add(requestId)
  cancelLufs(requestId)
}

export function flushLufsCache(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persist()
}

/** Test helper to avoid retaining session state across isolated tests. */
export function __resetLufsCacheForTests(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  cache = null
  dirty = false
  pathFingerprintCache.clear()
  cancelledRequestIds.clear()
  inFlightRequestIds.clear()
  inFlightAnalyses.clear()
}
