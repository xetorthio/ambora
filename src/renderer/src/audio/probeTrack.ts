/**
 * Proactive decodability probe for local audio files via main-process FFmpeg
 * (same allowlist as import). Avoids spinning up HTMLAudioElements on climate
 * open, which contended with playback on the shared local-audio:// token URL.
 *
 * Deeper Chromium-only decode failures are still caught reactively at playback.
 */

export interface ProbeResult {
  ok: boolean
  reason?: string
}

// Kept for unit tests / MediaError mapping used by older HTMLAudio probes.
export interface MediaErrorLike {
  code?: number
  message?: string
}

/**
 * Turn a raw decode or probe failure into something a GM can act on.
 *
 * `canRelink` is the difference between the two callers. A soundboard pad has a
 * locate-the-file flow (`relinkSoundboardSound`), so naming it is a real
 * instruction. An ambient clip has none — the clip lives inside an AmbientLayer
 * rather than on the campaign — and telling someone to locate a file when
 * nothing in the UI lets them is worse than only saying what went wrong. See
 * #45; when ambient clips gain a relink affordance this argument goes away.
 */
export function userFacingAudioFailure(reason: string | undefined, canRelink: boolean): string {
  const locate = canRelink ? ' — locate it to play' : ''

  if (!reason) {
    return canRelink
      ? 'Audio file could not be read — locate or replace it to play'
      : 'Audio file could not be read'
  }
  if (/HTTP 404|no such file or directory/i.test(reason)) {
    return `Audio file is missing${locate}`
  }
  if (/permission denied|EACCES/i.test(reason)) {
    return 'Audio file cannot be accessed — check the drive or file permissions'
  }
  return reason
}

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
  if (!filePath) {
    return { ok: false, reason: 'This clip has no audio file yet — re-add it after importing' }
  }
  const result = await window.api.probeAudioFile(filePath)
  if (result.ok) return { ok: true }
  return { ok: false, reason: result.reason }
}

export async function probeSoundboardTrack(filePath: string): Promise<ProbeResult> {
  const result = await probeLocalTrack(filePath)
  if (result.ok) return result
  return { ok: false, reason: userFacingAudioFailure(result.reason, true) }
}
