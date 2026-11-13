import type { GameMap, Vec3, WallFace } from '~/types'
import { ELEMENT_COLORS } from '~/types'
import { MAP_GEOMETRY_COLLECTIONS, type MapGeometryCollection } from './mapEdits'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export type DrawMode = 'line' | 'square' | 'cube' | 'circle' | 'brush'
export type SelectionBox = {
  min: Vec3
  max: Vec3
}
export type MapFragment = {
  [K in MapGeometryCollection]: GameMap[K]
}
export interface MapStamp {
  id: string
  name: string
  content: MapFragment
}
export const MAX_DRAW_CELLS = 100000
export const isGridCell = (value: unknown): value is Vec3 => !!value && typeof value === 'object'
  && ['x', 'y', 'z'].every(axis => Number.isSafeInteger((value as Record<string, unknown>)[axis]))
export const isQuarterTurns = (value: number) => Number.isSafeInteger(value)
export const cellKey = (p: Vec3) => [p.x, p.y, p.z].join(',')
export function selectionBox(a: Vec3, b: Vec3): SelectionBox {
  return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) } }
}
export function drawCells(a: Vec3, b: Vec3, mode: DrawMode, size = 1, roundBrush = false): Vec3[] {
  if (!isGridCell(a) || !isGridCell(b) || !Number.isInteger(size) || size < 1 || size > 32)
    return []
  const result = new Map<string, Vec3>(), box = selectionBox(a, b)
  const append = (cell: Vec3) => {
    if (!isGridCell(cell))
      return false
    result.set(cellKey(cell), cell)
    return result.size <= MAX_DRAW_CELLS
  }
  if (mode === 'brush') {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z), 1)
    const diameter = Math.max(1, Math.min(32, Math.round(size)))
    if (steps * diameter * diameter > MAX_DRAW_CELLS * 8)
      return []
    const low = -Math.floor((diameter - 1) / 2), high = low + diameter - 1
    for (let t = 0; t <= steps; t++)
      for (let dx = low; dx <= high; dx++)
        for (let dz = low; dz <= high; dz++) {
          const centre = (low + high) / 2
          if (roundBrush && Math.hypot(dx - centre, dz - centre) > diameter / 2)
            continue
          if (!append({ x: Math.round(a.x + (b.x - a.x) * t / steps) + dx, y: Math.round(a.y + (b.y - a.y) * t / steps), z: Math.round(a.z + (b.z - a.z) * t / steps) + dz }))
            return []
        }
  }
  else {
    if (mode === 'line') {
      if (Math.abs(b.x - a.x) >= Math.abs(b.z - a.z))
        box.min.z = box.max.z = a.z
      else
        box.min.x = box.max.x = a.x
    }
    if (mode !== 'cube')
      box.min.y = box.max.y = a.y
    if ((box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1) > MAX_DRAW_CELLS)
      return []
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2
    const rx = (box.max.x - box.min.x + 1) / 2, rz = (box.max.z - box.min.z + 1) / 2
    for (let x = box.min.x; x <= box.max.x; x++)
      for (let y = box.min.y; y <= box.max.y; y++)
        for (let z = box.min.z; z <= box.max.z; z++) {
          if (mode === 'circle' && ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 > 1)
            continue
          if (!append({ x, y, z }))
            return []
        }
  }
  return [...result.values()]
}
export function fragmentFromSelection(map: GameMap, box: SelectionBox): MapFragment {
  const inside = (p: Vec3) => p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y && p.z >= box.min.z && p.z <= box.max.z
  const fragment = Object.fromEntries(MAP_GEOMETRY_COLLECTIONS.map(key => [key, []])) as unknown as MapFragment
  for (const key of MAP_GEOMETRY_COLLECTIONS)
    if (key !== 'windows' && key !== 'doors')
      (fragment[key] as unknown[]) = map[key].filter(p => inside(p as Vec3)).map(p => clone(p))
  const walls = new Set(fragment.walls.map(w => w.id))
  fragment.windows = map.windows.filter(p => walls.has(p.wallId)).map(p => clone(p))
  fragment.doors = map.doors.filter(p => walls.has(p.wallId)).map(p => clone(p))
  return fragment
}
export function fragmentBounds(content: Partial<MapFragment>): SelectionBox | null {
  let box: SelectionBox | null = null
  for (const key of MAP_GEOMETRY_COLLECTIONS) {
    if (key === 'windows' || key === 'doors') continue
    for (const cell of content[key] ?? []) {
      const p = cell as Vec3
      if (!box) box = selectionBox(p, p)
      else {
        box.min.x = Math.min(box.min.x, p.x); box.max.x = Math.max(box.max.x, p.x)
        box.min.y = Math.min(box.min.y, p.y); box.max.y = Math.max(box.max.y, p.y)
        box.min.z = Math.min(box.min.z, p.z); box.max.z = Math.max(box.max.z, p.z)
      }
    }
  }
  return box
}
export function transformFragment(content: MapFragment, target: Vec3, turns: number, makeId: (previous?: string) => string): MapFragment {
  if (!isGridCell(target) || !isQuarterTurns(turns))
    throw new Error('Use whole-number coordinates and quarter turns.')
  const box = fragmentBounds(content)
  if (!box)
    return clone(content)
  const n = ((turns % 4) + 4) % 4
  const rotate = (p: Vec3) => {
    let x = p.x - box.min.x, z = p.z - box.min.z
    const width = box.max.x - box.min.x, depth = box.max.z - box.min.z
    if (n === 1)
      [x, z] = [depth - z, x]
    if (n === 2)
      [x, z] = [width - x, depth - z]
    if (n === 3)
      [x, z] = [z, width - x]
    return { x: target.x + x, y: target.y + p.y - box.min.y, z: target.z + z }
  }
  const ids = new Map<string, string>()
  const directions: WallFace[] = ['north', 'east', 'south', 'west']
  const result = Object.fromEntries(MAP_GEOMETRY_COLLECTIONS.map(key => [key, []])) as unknown as MapFragment
  for (const key of MAP_GEOMETRY_COLLECTIONS)
    for (const entry of content[key]) {
      const p = clone(entry) as any
      if ('id' in p) {
        const id = makeId(p.id)
        ids.set(p.id, id)
        p.id = id
      }
      if ('x' in p) {
        const cell = rotate(p)
        if (!isGridCell(cell))
          throw new Error('The transformed coordinates are outside the supported integer range.')
        Object.assign(p, cell)
      }
      if (p.face) {
        // Legacy stair faces encode east/west opposite to visible uphill.
        let face = p.face as WallFace
        if (key === 'stairs')
          face = face === 'east' ? 'west' : face === 'west' ? 'east' : face
        face = directions[(directions.indexOf(face) + n) % 4]!
        p.face = key === 'stairs' ? (face === 'east' ? 'west' : face === 'west' ? 'east' : face) : face
      }
      if (p.rampDirection)
        p.rampDirection = directions[(directions.indexOf(p.rampDirection) + n) % 4];
      (result[key] as unknown[]).push(p)
    }
  for (const key of ['windows', 'doors'] as const)
    for (const item of result[key])
      item.wallId = ids.get(item.wallId)!
  return result
}
/** Reject a damaged library entry as a unit; retain valid metadata on accepted entries. */
export function isMapStamp(value: unknown): value is MapStamp {
  if (!value || typeof value !== 'object')
    return false
  const stamp = value as MapStamp
  if (typeof stamp.id !== 'string' || !stamp.id || stamp.id.length > 200
    || typeof stamp.name !== 'string' || !stamp.name.trim() || stamp.name.length > 80 || !stamp.content)
    return false
  const ids = new Set<string>(), walls = new Set<string>()
  const directions = ['north', 'east', 'south', 'west']
  let count = 0
  for (const key of MAP_GEOMETRY_COLLECTIONS) {
    const rows = stamp.content[key]
    if (!Array.isArray(rows) || (count += rows.length) > MAX_DRAW_CELLS)
      return false
    const cells = new Set<string>()
    for (const entry of rows) {
      if (!entry || typeof entry !== 'object')
        return false
      const p = entry as unknown as Record<string, any>
      if (key === 'windows' || key === 'doors') {
        if (typeof p.wallId !== 'string' || key === 'doors' && typeof p.isOpen !== 'boolean')
          return false
      }
      else {
        if (!isGridCell(entry))
          return false
        const identity = cellKey(entry) + (key === 'walls' ? ':' + p.face : '')
        if (cells.has(identity))
          return false
        cells.add(identity)
      }
      if (['walls', 'stairs'].includes(key) && !directions.includes(p.face))
        return false
      if (['walls', 'windows', 'doors', 'ceilings', 'stairs'].includes(key)) {
        if (typeof p.id !== 'string' || !p.id || ids.has(p.id))
          return false
        ids.add(p.id)
        if (key === 'walls')
          walls.add(p.id)
      }
      if (p.woundBoxes !== undefined && (!Number.isSafeInteger(p.woundBoxes) || p.woundBoxes < 0))
        return false
      if (key === 'groundTiles' && (typeof p.element !== 'string' || !['normal', 'water', 'earth', 'climbable'].includes(p.terrain)))
        return false
      if (p.element !== undefined && !Object.prototype.hasOwnProperty.call(ELEMENT_COLORS, p.element)) return false
      if (p.materialId !== undefined && typeof p.materialId !== 'string') return false
      if (key === 'spaceTiles' && !['air', 'water', 'earth'].includes(p.spaceType))
        return false
      if (key === 'voxels') {
        if (typeof p.materialId !== 'string' || !p.materialId)
          return false
        if (p.shape !== undefined && !['block', 'ramp'].includes(p.shape))
          return false
        if (p.feature !== undefined && p.feature !== 'window') return false
        if (p.rampDirection !== undefined && !directions.includes(p.rampDirection))
          return false
        if (p.opacity !== undefined && (typeof p.opacity !== 'number' || !Number.isFinite(p.opacity) || p.opacity < 0 || p.opacity > 1))
          return false
        if (p.color !== undefined && (typeof p.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.color)))
          return false
        if (p.tags !== undefined && (!Array.isArray(p.tags) || !p.tags.every((tag: unknown) => typeof tag === 'string')))
          return false
      }
      for (const field of ['blocksMovement', 'blocksSight', 'isSpawnPoint'])
        if (p[field] !== undefined && typeof p[field] !== 'boolean')
          return false
    }
  }
  return count > 0 && stamp.content.windows.every(row => walls.has(row.wallId)) && stamp.content.doors.every(row => walls.has(row.wallId))
}
export function fragmentCollision(map: GameMap, fragment: MapFragment, ignore?: MapFragment): string | null {
  const labels = { groundTiles: 'floor tiles', spaceTiles: 'volumes', voxels: 'blocks', walls: 'walls', ceilings: 'ceilings', stairs: 'stairs' }
  for (const key of MAP_GEOMETRY_COLLECTIONS) {
    if (key === 'windows' || key === 'doors')
      continue
    const identity = (p: any) => cellKey(p) + (key === 'walls' ? ':' + p.face : '')
    const ignored = new Set((ignore?.[key] ?? []).map(identity))
    const occupied = new Set(map[key].map(identity).filter(id => !ignored.has(id)))
    if (fragment[key].some(p => occupied.has(identity(p))))
      return 'That position overlaps existing ' + labels[key] + '. Move the selection or stamp to a clear position.'
  }
  return null
}
