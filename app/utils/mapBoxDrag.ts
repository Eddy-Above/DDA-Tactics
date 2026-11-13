import type { MapTool, Vec3 } from '~/types'

export const BOX_DRAW_TOOLS: readonly MapTool[] = [
  'add-ground', 'add-space', 'paint-element', 'voxel', 'ramp', 'stairs', 'ceiling', 'spawn', 'delete',
]
export const supportsVerticalDrag = (tool: MapTool, drawMode: string) => tool==='area-select'||drawMode==='cube'&&BOX_DRAW_TOOLS.includes(tool)

export interface BoxPointer { clientX: number; clientY: number; ctrlKey?: boolean }

/** Keep the horizontal footprint while Ctrl changes the end cell's Y coordinate. */
export function createMapBoxDrag(pixelsPerLevel = 24) {
  let state: {
    end: Vec3
    pointer: BoxPointer
    vertical: { screenY: number; level: number } | null
    fixedY: number | null
    offset: { x: number; z: number }
    resume: { pointer: BoxPointer; end: Vec3 } | null
  } | null = null

  function setControl(held: boolean) {
    if (!state || held === !!state.vertical) return
    if (held) state.vertical = { screenY: state.pointer.clientY, level: state.end.y }
    else {
      state.vertical = null
      state.fixedY = state.end.y
      state.resume = { pointer: { ...state.pointer }, end: { ...state.end } }
    }
  }

  return {
    get active() { return state !== null },
    get vertical() { return !!state?.vertical },
    get heightAdjusted() { return !!state && (state.fixedY!==null || !!state.vertical) },
    get pointer() { return state ? { ...state.pointer } : null },
    get end() { return state ? { ...state.end } : null },
    start(cell: Vec3, pointer: BoxPointer) {
      // Native MouseEvent coordinates are prototype getters, not enumerable
      // properties. Copy them explicitly so the first Ctrl anchor is valid.
      state = { end: { ...cell }, pointer: { clientX: pointer.clientX, clientY: pointer.clientY, ctrlKey: pointer.ctrlKey },
        vertical: null, fixedY: null, offset: { x: 0, z: 0 }, resume: null }
      setControl(!!pointer.ctrlKey)
    },
    setControl,
    update(pointer: BoxPointer, pick: (pointer: BoxPointer) => Vec3 | null): Vec3 | null {
      if (!state) return null
      if (pointer.ctrlKey !== undefined) setControl(pointer.ctrlKey)
      if (state.vertical) {
        const level = state.vertical.level + Math.round((state.vertical.screenY - pointer.clientY) / pixelsPerLevel)
        if (Number.isSafeInteger(level)) state.end.y = level
      } else {
        // Rebase the horizontal ray at the point where Ctrl was released. This
        // avoids an X/Z jump caused by the mouse travel used to change height.
        if (state.resume) {
          const anchor = pick(state.resume.pointer)
          if (anchor) {
            state.offset = { x: state.resume.end.x - anchor.x, z: state.resume.end.z - anchor.z }
            state.resume = null
          }
        }
        const cell = pick(pointer)
        if (cell && !state.resume) {
          const end = { x: cell.x + state.offset.x, y: state.fixedY ?? cell.y, z: cell.z + state.offset.z }
          if (Object.values(end).every(Number.isSafeInteger)) state.end = end
        }
      }
      state.pointer = { clientX: pointer.clientX, clientY: pointer.clientY, ctrlKey: pointer.ctrlKey }
      return { ...state.end }
    },
    reset() { state = null },
  }
}
