import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Give up rather than hang if the media element never reports either way. */
const DURATION_PROBE_TIMEOUT_MS = 10_000

export async function getLocalFileDuration(filePath: string): Promise<number | undefined> {
  const token = await window.api.registerAudioPath(filePath)
  const audio = new Audio()
  audio.preload = 'metadata'
  audio.src = `local-audio:///${token}`

  return new Promise<number | undefined>((resolve) => {
    let settled = false

    const finish = (dur: number | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      audio.removeAttribute('src')
      audio.load()
      resolve(dur !== undefined && Number.isFinite(dur) && dur > 0 ? dur : undefined)
    }

    const timer = setTimeout(() => finish(undefined), DURATION_PROBE_TIMEOUT_MS)

    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(audio.duration)) {
          finish(audio.duration)
          return
        }

        // A VBR MP3 with no Xing/VBRI header reports Infinity here, because the
        // demuxer can't know the length without scanning the whole file. Seeking
        // far past the end forces Chromium to resolve the real duration, which it
        // then reports on the next timeupdate.
        const onTimeUpdate = (): void => {
          audio.removeEventListener('timeupdate', onTimeUpdate)
          finish(audio.duration)
        }
        audio.addEventListener('timeupdate', onTimeUpdate)
        try {
          audio.currentTime = 1e101
        } catch {
          finish(undefined)
        }
      },
      { once: true },
    )

    audio.addEventListener('error', () => finish(undefined), { once: true })

    audio.load()
  })
}
