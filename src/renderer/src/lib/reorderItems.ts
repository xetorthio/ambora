export type DropPosition = 'before' | 'after'

export const TRACK_DRAG_TYPE = 'application/x-ambora-track'

export function reorderItemIds(
  ids: string[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
): string[] {
  if (draggedId === targetId || !ids.includes(draggedId) || !ids.includes(targetId)) return ids

  const reordered = ids.filter((id) => id !== draggedId)
  const targetIndex = reordered.indexOf(targetId)
  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
  reordered.splice(insertIndex, 0, draggedId)
  return reordered
}

export function moveItemId(ids: string[], itemId: string, offset: -1 | 1): string[] {
  const fromIndex = ids.indexOf(itemId)
  const toIndex = fromIndex + offset
  if (fromIndex === -1 || toIndex < 0 || toIndex >= ids.length) return ids

  const reordered = [...ids]
  const [item] = reordered.splice(fromIndex, 1)
  reordered.splice(toIndex, 0, item)
  return reordered
}
