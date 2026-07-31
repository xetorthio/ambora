/**
 * Proactive decodability probe for local audio files. Loads the file into a
 * throwaway HTMLAudioElement (via the same `local-audio://` protocol playback
 * uses) and reports whether Chromium can open it — so the UI can flag unplayable
 * local tracks before they are ever played.
 *
 * Uses metadata-level detection (`loadedmetadata` vs `error`): cheap enough to run
 * across a climate's tracks on open, and it catches the common failures
 * (unsupported/absent codec, corrupt header, missing file). Deeper decode-only
 * failures are still caught reactively at playback time — LocalPlayer waits on the
 * stronger `canplaythrough` and pushes failures into the diagnostics store.
 *
 * Mirrors the load mechanics of `getLocalFileDuration` (lib/utils.ts) and
 * `LocalPlayer.load` (audio/LocalPlayer.ts).
 */

export interface ProbeResult {
  ok: boolean
  reason?: string
}

// Minimal structural shape of the fields we read off HTMLMediaElement.error — a
// real MediaError is assignable to this, and it keeps resultForOutcome free of DOM
// lib types so it's unit-testable in the node env.
export interface MediaErrorLike {
  code?: number
  message?: string
}

const PROBE_TIMEOUT_MS = 15_000

/**
 * Pure mapping from a load outcome to a ProbeResult, split out from the DOM so it
 * is unit-testable. A timeout is treated as inconclusive (ok) so a slow disk never
 * produces a false "unplayable".
 */
export function resultForOutcome(
  outcome: 'loadedmetadata' | 'error' | 'timeout',
  error?: MediaErrorLike | null,
): ProbeResult {
  if (outcome !== 'error') return { ok: true }
  const message = error?.message?.trim()
  const reason =
    message && message.length > 0 ? message : `Audio error (code ${error?.code ?? '?'})`
  return { ok: false, reason }
}

export async function probeLocalTrack(filePath: string): Promise<ProbeResult> {
  const token = await window.api.registerAudioPath(filePath)
  const audio = new Audio()
  audio.preload = 'metadata'
  audio.src = `local-audio:///${token}`

  return new Promise<ProbeResult>((resolve) => {
    let settled = false
    const finish = (result: ProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('error', onError)
      // Release the media resource.
      audio.removeAttribute('src')
      audio.load()
      resolve(result)
    }
    const onMeta = (): void => finish(resultForOutcome('loadedmetadata'))
    const onError = (): void => finish(resultForOutcome('error', audio.error))
    const timer = setTimeout(() => finish(resultForOutcome('timeout')), PROBE_TIMEOUT_MS)

    audio.addEventListener('loadedmetadata', onMeta, { once: true })
    audio.addEventListener('error', onError, { once: true })
    audio.load()
  })
}
