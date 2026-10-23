type DebugValue = string | number | boolean | null | undefined

export type DebugFields = Record<string, DebugValue>

export interface DebugRecord {
  timestamp: string
  rendererTimeMs: number
  event: string
  fields: DebugFields
}

const BUFFER_CAP = 500
const buffer: DebugRecord[] = []

/**
 * Session diagnostics for tracing UI latency. Entries are kept in memory for
 * DevTools and forwarded to the main process for the persistent debug log.
 */
export function debugLog(event: string, fields: DebugFields = {}): void {
  // Debug tracing is intentionally a development-only facility. Production
  // keeps just this cheap branch: it does not allocate records, cross the IPC
  // boundary, or write a log file during normal play.
  if (!import.meta.env.DEV) return

  const record: DebugRecord = {
    timestamp: new Date().toISOString(),
    rendererTimeMs: performance.now(),
    event,
    fields,
  }
  buffer.push(record)
  if (buffer.length > BUFFER_CAP) buffer.shift()
  const details = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
  console.info(`[ambora-debug] ${event}${details ? ` ${details}` : ''}`, record)
  // Unit-test mocks and older preloads may not expose this development-only
  // bridge. Logging must never affect application behavior.
  window.api?.debugLog?.(record)
}

interface DebugLogConsole {
  dump: () => DebugRecord[]
  clear: () => void
}

if (typeof window !== 'undefined') {
  const handle: DebugLogConsole = {
    dump: () => [...buffer],
    clear: () => {
      buffer.length = 0
    },
  }
  ;(window as unknown as { __amboraDebugLog?: DebugLogConsole }).__amboraDebugLog = handle
}
