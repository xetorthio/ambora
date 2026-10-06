import { loadLufsCache, saveLufsCache } from './data'
import { analyzeLufs, cancelLufs } from './lufsAnalyze'
import { fingerprintAudioFile } from './lufsFingerprint'
import type { LufsAnalyzeResult } from '../shared/audioTools'

const SAVE_DEBOUNCE_MS = 2000
const pathFingerprintCache = new Map<string, string>()
const cancelledRequestIds = new Set<string>()
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
  const existing = pathFingerprintCache.get(filePath)
  if (existing) return existing

  const fingerprint = await fingerprintAudioFile(filePath)
  pathFingerprintCache.set(filePath, fingerprint)
  return fingerprint
}

/**
 * Looks up or measures loudness entirely in the main process. This keeps file
 * access and the persistent, content-addressed cache in the same owner.
 */
export async function getLufs(filePath: string, requestId: string): Promise<LufsAnalyzeResult> {
  try {
    const fingerprint = await fingerprintForPath(filePath)
    if (cancelledRequestIds.has(requestId)) {
      return { ok: false, reason: 'cancelled', cancelled: true }
    }

    const cached = getCache().get(fingerprint)
    if (cached !== undefined) return { ok: true, integratedLufs: cached }

    const result = await analyzeLufs(filePath, requestId)
    if (result.ok && !cancelledRequestIds.has(requestId)) {
      getCache().set(fingerprint, result.integratedLufs)
      dirty = true
      scheduleSave()
    }
    return result
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not fingerprint audio file',
    }
  } finally {
    cancelledRequestIds.delete(requestId)
  }
}

export function cancelLufsRequest(requestId: string): void {
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
}
