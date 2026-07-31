/**
 * Pure track-selection helpers for the audio engine. Dependency-free (no DOM, no
 * AudioContext) so the shuffle and fallback logic can be unit-tested directly.
 *
 * Indices returned by these helpers are positions in the engine's play-ordered
 * track list (sorted by `order`).
 */

/**
 * Indices of tracks eligible to play: those whose id is NOT in `failed`. If every
 * track has failed, returns all indices so playback can still attempt something
 * rather than selecting nothing.
 */
export function eligibleIndices(ids: readonly string[], failed: ReadonlySet<string>): number[] {
  const eligible: number[] = []
  for (let i = 0; i < ids.length; i++) {
    if (!failed.has(ids[i])) eligible.push(i)
  }
  return eligible.length > 0 ? eligible : ids.map((_, i) => i)
}

/**
 * Next index after `current` in play order, skipping failed tracks and wrapping.
 * Falls back to the immediate next index when every track has failed.
 */
export function nextSequentialIndex(
  current: number,
  ids: readonly string[],
  failed: ReadonlySet<string>,
): number {
  const n = ids.length
  if (n === 0) return 0
  for (let step = 1; step <= n; step++) {
    const idx = (current + step) % n
    if (!failed.has(ids[idx])) return idx
  }
  return (current + 1) % n
}

/**
 * A shuffle "bag": draws each eligible track once per cycle (as a shuffled queue)
 * before repeating, guaranteeing full coverage — unlike a stateless random pick,
 * which can starve some tracks indefinitely. Refills automatically, resets when
 * the track set changes (tracked by `fingerprint`), and avoids immediately
 * repeating the just-played track across refills.
 */
export class ShuffleBag {
  private queue: number[] = []
  private fingerprint: string | null = null

  constructor(private rng: () => number = Math.random) {}

  reset(): void {
    this.queue = []
    this.fingerprint = null
  }

  next(
    ids: readonly string[],
    failed: ReadonlySet<string>,
    currentIndex: number,
    fingerprint: string,
  ): number {
    if (ids.length === 0) return 0
    if (this.fingerprint !== fingerprint) {
      this.queue = []
      this.fingerprint = fingerprint
    }
    if (this.queue.length === 0) {
      this.queue = this.shuffle(eligibleIndices(ids, failed))
      const last = this.queue.length - 1
      if (this.queue.length > 1 && this.queue[last] === currentIndex) {
        const j = Math.floor(this.rng() * last)
        ;[this.queue[j], this.queue[last]] = [this.queue[last], this.queue[j]]
      }
    }
    const idx = this.queue.pop()
    return idx ?? 0
  }

  private shuffle(arr: number[]): number[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
}
