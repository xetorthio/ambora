import type { Track } from '@/lib/types'

/**
 * Structured, source-attributed audio logging for diagnosing playback and
 * transition issues.
 *
 * Records are ALWAYS buffered in memory (capped) so a session can be inspected
 * after the fact — reproduce an issue, then run `window.__amboraAudioLog.dump()`
 * in the devtools console. Console output is opt-in: enable it with
 * `window.__amboraAudioLog.enable()` (persists via localStorage) to watch events
 * live. Filter the console by `[ambora-audio` to isolate them.
 *
 * The `source` field is the key to triage: `playback` = real track load/runtime
 * failures (these actually skip tracks); `lufs` = background loudness-analysis
 * decode failures (harmless to playback — do not confuse with `playback`);
 * `select` = shuffle/advance selection events; `ambient` = ambient-layer clip
 * decoding and scene lifecycle.
 */

const DEBUG_FLAG = 'AMBORA_DEBUG_AUDIO'
const BUFFER_CAP = 500

export type AudioLogSource = 'playback' | 'lufs' | 'select' | 'ambient'

export interface AudioLogRecord {
  t: number
  source: AudioLogSource
  event: string
  trackId?: string
  title?: string
  trackSource?: Track['source']
  localFilePath?: string
  ext?: string
  outcome?: string
  detail?: string
  index?: number
  trackCount?: number
  failedCount?: number
}

export type AudioLogFields = Omit<AudioLogRecord, 't' | 'source' | 'event'>

const buffer: AudioLogRecord[] = []

function consoleEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_FLAG) === '1'
  } catch {
    return false
  }
}

export function audioLog(source: AudioLogSource, event: string, fields: AudioLogFields = {}): void {
  const record: AudioLogRecord = { t: Date.now(), source, event, ...fields }
  buffer.push(record)
  if (buffer.length > BUFFER_CAP) buffer.shift()
  if (consoleEnabled()) {
    console.info(`[ambora-audio:${source}] ${event}`, fields)
  }
}

/** Lowercased file extension (including the dot) for logging/attribution. */
export function extOf(path: string | undefined): string | undefined {
  if (!path) return undefined
  const dot = path.lastIndexOf('.')
  return dot === -1 ? undefined : path.slice(dot).toLowerCase()
}

export function dumpAudioLog(): AudioLogRecord[] {
  return [...buffer]
}

export function clearAudioLog(): void {
  buffer.length = 0
}

interface AudioLogConsole {
  dump: () => AudioLogRecord[]
  clear: () => void
  enable: () => void
  disable: () => void
}

// Expose a small handle for inspecting/toggling logs from the devtools console
// while debugging a real session.
if (typeof window !== 'undefined') {
  const handle: AudioLogConsole = {
    dump: dumpAudioLog,
    clear: clearAudioLog,
    enable: () => {
      try {
        localStorage.setItem(DEBUG_FLAG, '1')
      } catch {
        // localStorage unavailable — ignore
      }
    },
    disable: () => {
      try {
        localStorage.removeItem(DEBUG_FLAG)
      } catch {
        // localStorage unavailable — ignore
      }
    },
  }
  ;(window as unknown as { __amboraAudioLog?: AudioLogConsole }).__amboraAudioLog = handle
}
