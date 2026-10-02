import { describe, expect, it } from 'vitest'
import { moveItemId, reorderItemIds } from '../../src/renderer/src/lib/reorderItems'

describe('reorderItemIds', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moves an item before the drop target', () => {
    expect(reorderItemIds(ids, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves an item after the drop target', () => {
    expect(reorderItemIds(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd'])
  })

  it('leaves the order unchanged for an invalid or identical target', () => {
    expect(reorderItemIds(ids, 'b', 'b', 'before')).toBe(ids)
    expect(reorderItemIds(ids, 'missing', 'b', 'before')).toBe(ids)
  })
})

describe('moveItemId', () => {
  const ids = ['a', 'b', 'c']

  it('moves an item by one position for keyboard reordering', () => {
    expect(moveItemId(ids, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveItemId(ids, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('does not move beyond the list boundaries', () => {
    expect(moveItemId(ids, 'a', -1)).toBe(ids)
    expect(moveItemId(ids, 'c', 1)).toBe(ids)
  })
})
