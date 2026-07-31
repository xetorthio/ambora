import { describe, it, expect } from 'vitest'
import {
  eligibleIndices,
  nextSequentialIndex,
  ShuffleBag,
} from '../../src/renderer/src/audio/trackSelection'

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${i}`)

// Deterministic rng cycling through a fixed sequence, for reproducible shuffles.
const seeded = (seq: number[]): (() => number) => {
  let i = 0
  return () => seq[i++ % seq.length]
}

describe('eligibleIndices', () => {
  it('returns all indices when nothing has failed', () => {
    expect(eligibleIndices(ids(3), new Set())).toEqual([0, 1, 2])
  })

  it('excludes failed ids', () => {
    expect(eligibleIndices(ids(3), new Set(['t1']))).toEqual([0, 2])
  })

  it('falls back to all indices when every track failed', () => {
    expect(eligibleIndices(ids(3), new Set(['t0', 't1', 't2']))).toEqual([0, 1, 2])
  })
})

describe('nextSequentialIndex', () => {
  it('advances and wraps', () => {
    expect(nextSequentialIndex(0, ids(3), new Set())).toBe(1)
    expect(nextSequentialIndex(2, ids(3), new Set())).toBe(0)
  })

  it('skips failed tracks', () => {
    expect(nextSequentialIndex(0, ids(4), new Set(['t1', 't2']))).toBe(3)
  })

  it('falls back to the next index when all failed', () => {
    expect(nextSequentialIndex(0, ids(3), new Set(['t0', 't1', 't2']))).toBe(1)
  })
})

describe('ShuffleBag', () => {
  it('draws every track exactly once per cycle (full coverage, no repeats)', () => {
    const bag = new ShuffleBag(seeded([0.1, 0.5, 0.9, 0.3, 0.7]))
    const n = 5
    const seen = new Set<number>()
    let current = -1
    for (let k = 0; k < n; k++) {
      const idx = bag.next(ids(n), new Set(), current, 'fp')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(n)
      expect(seen.has(idx)).toBe(false)
      seen.add(idx)
      current = idx
    }
    expect(seen.size).toBe(n)
  })

  it('excludes failed tracks from the cycle', () => {
    const bag = new ShuffleBag(seeded([0.2, 0.8, 0.4]))
    const failed = new Set(['t1', 't3'])
    const drawn = new Set<number>()
    for (let k = 0; k < 3; k++) {
      drawn.add(bag.next(ids(5), failed, -1, 'fp'))
    }
    expect(drawn.has(1)).toBe(false)
    expect(drawn.has(3)).toBe(false)
    expect(drawn.size).toBe(3) // the 3 eligible tracks: 0, 2, 4
  })

  it('refills with a valid index when the fingerprint changes', () => {
    const bag = new ShuffleBag(seeded([0.5]))
    bag.next(ids(3), new Set(), -1, 'fp-a')
    const idx = bag.next(ids(2), new Set(), -1, 'fp-b')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(2)
  })
})
