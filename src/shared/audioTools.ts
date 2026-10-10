/**
 * Shared types for main↔renderer audio tooling (FFmpeg LUFS + import probe).
 */

/** First N seconds analyzed for integrated loudness (matches prior PCM window). */
export const LUFS_ANALYSIS_SECONDS = 5 * 60

export type LufsAnalyzeOk = { ok: true; integratedLufs: number; cached?: boolean }
export type LufsAnalyzeFail = { ok: false; reason: string; cancelled?: boolean }
export type LufsAnalyzeResult = LufsAnalyzeOk | LufsAnalyzeFail

export type AudioProbeOk = {
  ok: true
  codec: string
  sampleFmt?: string
  channels?: number
  durationSec?: number
}
export type AudioProbeFail = { ok: false; reason: string }
export type AudioProbeResult = AudioProbeOk | AudioProbeFail
