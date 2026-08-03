import { describe, it, expect } from 'vitest'
import {
  nextDelaySec,
  sortedClips,
  AmbientClipSelector,
} from '../../src/renderer/src/audio/ambientScheduling'
import type { AmbientClip, AmbientLayer } from '../../src/shared/types'

function clip(id: string, order: number): AmbientClip {
  return { id, title: id, localFilePath: `/clips/${id}.wav`, order }
}

function layer(overrides: Partial<AmbientLayer> = {}): AmbientLayer {
  return {
    id: 'layer-1',
    name: 'Birds',
    mode: 'random',
    enabled: true,
    volume: 60,
    clips: [],
    clipOrder: 'shuffle',
    minDelaySec: 8,
    maxDelaySec: 20,
    order: 0,
    ...overrides,
  }
}

/** Deterministic stand-in for Math.random, cycling through fixed draws. */
function seededRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('nextDelaySec', () => {
  it('draws the first delay from [0, min] so a scene sounds alive immediately', () => {
    const l = layer({ minDelaySec: 30, maxDelaySec: 90 })
    expect(nextDelaySec(l, true, () => 0)).toBe(0)
    expect(nextDelaySec(l, true, () => 1)).toBe(30)
    expect(nextDelaySec(l, true, () => 0.5)).toBe(15)
  })

  it('draws subsequent delays from the configured window', () => {
    const l = layer({ minDelaySec: 8, maxDelaySec: 20 })
    expect(nextDelaySec(l, false, () => 0)).toBe(8)
    expect(nextDelaySec(l, false, () => 1)).toBe(20)
    expect(nextDelaySec(l, false, () => 0.5)).toBe(14)
  })

  it('stays within bounds across many draws', () => {
    const l = layer({ minDelaySec: 8, maxDelaySec: 20 })
    for (let i = 0; i < 200; i++) {
      const delay = nextDelaySec(l, false)
      expect(delay).toBeGreaterThanOrEqual(8)
      expect(delay).toBeLessThanOrEqual(20)
    }
  })

  it('tolerates max below min (a half-finished edit) instead of going negative', () => {
    const l = layer({ minDelaySec: 30, maxDelaySec: 5 })
    for (let i = 0; i < 50; i++) {
      expect(nextDelaySec(l, false)).toBe(30)
    }
  })

  it('treats a negative min as zero', () => {
    const l = layer({ minDelaySec: -10, maxDelaySec: 10 })
    expect(nextDelaySec(l, false, () => 0)).toBe(0)
  })
})

describe('sortedClips', () => {
  it('orders by the stored order field, not array position', () => {
    const l = layer({ clips: [clip('c', 2), clip('a', 0), clip('b', 1)] })
    expect(sortedClips(l).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('AmbientClipSelector', () => {
  const clips = [clip('a', 0), clip('b', 1), clip('c', 2)]

  it('returns 0 for an empty clip list', () => {
    expect(new AmbientClipSelector().next([], 'shuffle')).toBe(0)
  })

  it('always returns the only clip when there is one', () => {
    const selector = new AmbientClipSelector()
    const one = [clip('a', 0)]
    expect(selector.next(one, 'shuffle')).toBe(0)
    expect(selector.next(one, 'random')).toBe(0)
    expect(selector.next(one, 'sequential')).toBe(0)
  })

  it('walks the list in order and wraps in sequential mode', () => {
    const selector = new AmbientClipSelector()
    const picks = Array.from({ length: 7 }, () => selector.next(clips, 'sequential'))
    expect(picks).toEqual([0, 1, 2, 0, 1, 2, 0])
  })

  it('plays every clip once per cycle in shuffle mode', () => {
    const selector = new AmbientClipSelector()
    const first = [
      selector.next(clips, 'shuffle'),
      selector.next(clips, 'shuffle'),
      selector.next(clips, 'shuffle'),
    ]
    expect([...first].sort()).toEqual([0, 1, 2])

    const second = [
      selector.next(clips, 'shuffle'),
      selector.next(clips, 'shuffle'),
      selector.next(clips, 'shuffle'),
    ]
    expect([...second].sort()).toEqual([0, 1, 2])
  })

  it('never repeats the same clip back to back in shuffle mode', () => {
    const selector = new AmbientClipSelector()
    let previous = -1
    for (let i = 0; i < 300; i++) {
      const idx = selector.next(clips, 'shuffle')
      expect(idx).not.toBe(previous)
      previous = idx
    }
  })

  it('starts a fresh cycle when the clip set changes', () => {
    const selector = new AmbientClipSelector()
    selector.next(clips, 'shuffle')

    const grown = [...clips, clip('d', 3)]
    const picks = new Set<number>()
    for (let i = 0; i < 4; i++) picks.add(selector.next(grown, 'shuffle'))
    expect(picks.size).toBe(4)
  })

  it('stays within range in random mode', () => {
    const selector = new AmbientClipSelector(seededRng([0, 0.4, 0.99, 0.7]))
    for (let i = 0; i < 20; i++) {
      const idx = selector.next(clips, 'random')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(clips.length)
    }
  })

  it('resets back to the start of the sequence', () => {
    const selector = new AmbientClipSelector()
    expect(selector.next(clips, 'sequential')).toBe(0)
    expect(selector.next(clips, 'sequential')).toBe(1)
    selector.reset()
    expect(selector.next(clips, 'sequential')).toBe(0)
  })
})
