/**
 * Pure scheduling helpers for ambient layers. Dependency-free (no DOM, no
 * AudioContext) so the delay and clip-selection rules can be unit-tested without
 * standing up an audio graph.
 */

import { ShuffleBag } from './trackSelection'
import type { AmbientClip, AmbientClipOrder, AmbientLayer } from '@/lib/types'

const NO_FAILURES: ReadonlySet<string> = new Set()

/**
 * Delay before a random-interval layer fires again, in seconds.
 *
 * The first delay after a climate activates is drawn from `[0, min]` rather than
 * `[min, max]`: a scene with a 30–90s layer would otherwise sound dead for its
 * first half minute, which reads as broken. Every delay after that uses the
 * configured window, measured from when the previous clip *finished* so clips
 * within one layer never overlap themselves.
 */
export function nextDelaySec(
  layer: Pick<AmbientLayer, 'minDelaySec' | 'maxDelaySec'>,
  isFirst: boolean,
  rng: () => number = Math.random,
): number {
  const min = Math.max(0, layer.minDelaySec)
  // Tolerate a max below min (mid-edit state in the UI) rather than producing a
  // negative-width window that would collapse to a fixed delay.
  const max = Math.max(min, layer.maxDelaySec)
  const lo = isFirst ? 0 : min
  const hi = isFirst ? min : max
  return lo + rng() * (hi - lo)
}

/** Clips in play order. Shared by the engine and the UI so both agree on index. */
export function sortedClips(layer: AmbientLayer): AmbientClip[] {
  return [...layer.clips].sort((a, b) => a.order - b.order)
}

function fingerprintOf(clips: readonly AmbientClip[]): string {
  return clips
    .map((c) => c.id)
    .sort()
    .join(',')
}

/**
 * Picks the next clip index for a layer according to its `clipOrder`.
 *
 * `shuffle` delegates to the engine's existing {@link ShuffleBag}: every clip
 * plays once per cycle before any repeats, and a cycle never opens with the clip
 * that just played. That covers the RFC's "don't repeat the same file twice in a
 * row" and additionally stops a clip from being starved, which a stateless
 * random draw allows.
 */
export class AmbientClipSelector {
  private bag: ShuffleBag
  private lastIndex = -1

  constructor(private rng: () => number = Math.random) {
    this.bag = new ShuffleBag(rng)
  }

  reset(): void {
    this.bag.reset()
    this.lastIndex = -1
  }

  next(clips: readonly AmbientClip[], order: AmbientClipOrder): number {
    if (clips.length === 0) return 0
    if (clips.length === 1) {
      this.lastIndex = 0
      return 0
    }

    let idx: number
    switch (order) {
      case 'sequential':
        idx = (this.lastIndex + 1) % clips.length
        break
      case 'random':
        idx = Math.floor(this.rng() * clips.length)
        break
      case 'shuffle':
      default:
        idx = this.bag.next(
          clips.map((c) => c.id),
          NO_FAILURES,
          this.lastIndex,
          fingerprintOf(clips),
        )
        break
    }

    this.lastIndex = idx
    return idx
  }
}
