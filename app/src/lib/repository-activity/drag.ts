import { WorkingGroup, Ungrouped } from './organization'

export interface IRepositoryDragRow {
  readonly top: number
  readonly bottom: number
  readonly group: string
  readonly repositoryId?: number
}

export interface IRepositoryDropSlot {
  readonly y: number
  readonly group: string
  readonly repositoryId?: number
  readonly position: 'before' | 'after'
}

/** Resolve custom group insertion slots against the unshifted list geometry. */
export function findRepositoryDropSlot(
  rows: ReadonlyArray<IRepositoryDragRow>,
  y: number,
  draggingGroup: string | null,
  draggingRepository: number | null
): IRepositoryDropSlot | null {
  // Repository drags assign a group only when dropped on a row or group
  // heading. They never create a list-wide insertion slot.
  if (draggingRepository !== null || draggingGroup === null) {
    return null
  }

  // Working is a derived section, so neither repositories nor groups can be
  // dropped anywhere inside its visible header or rows.
  if (
    rows.some(
      row => row.group === WorkingGroup && y >= row.top && y < row.bottom
    )
  ) {
    return null
  }

  const slots: IRepositoryDropSlot[] = []
  const sections = new Map<string, { top: number; bottom: number }>()
  for (const row of rows) {
    const section = sections.get(row.group)
    sections.set(row.group, {
      top: Math.min(section?.top ?? row.top, row.top),
      bottom: Math.max(section?.bottom ?? row.bottom, row.bottom),
    })
  }
  for (const [group, bounds] of sections) {
    if (group === WorkingGroup || group === draggingGroup) {
      continue
    }
    slots.push({ group, y: bounds.top, position: 'before' })
    if (group !== Ungrouped) {
      slots.push({ group, y: bounds.bottom, position: 'after' })
    }
  }
  return slots.reduce<IRepositoryDropSlot | null>(
    (best, slot) =>
      best === null || Math.abs(slot.y - y) < Math.abs(best.y - y)
        ? slot
        : best,
    null
  )
}
