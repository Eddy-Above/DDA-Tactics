import type { GameMap, Vec3, MapGroundTile, MapSpaceTile, MapVoxel, MapStair, MapWall, MapCeiling, MapDoor } from '~/types'

interface MovementMapIndex {
  minimumSupportY: number
  footprintTerrain: Map<string, number>
  water: Map<string, boolean>
  swimming: Map<string, boolean>
  jumpSupport: Map<string, boolean>
  adjacentFooting: Map<string, boolean>
  airborne: Map<string, boolean>
  ground: ReadonlyMap<string, MapGroundTile>
  space: ReadonlyMap<string, MapSpaceTile>
  voxels: ReadonlyMap<string, MapVoxel>
  stairs: ReadonlyMap<string, MapStair>
  walls: ReadonlyMap<string, readonly MapWall[]>
  ceilings: ReadonlyMap<string, readonly MapCeiling[]>
  doors: ReadonlyMap<string, MapDoor>
}

// Only ephemeral search views are keys. Mutable application map roots never enter this cache.
const searchIndexes = new WeakMap<GameMap, MovementMapIndex>()
const cellKey = (pos: Vec3) => `${pos.x},${pos.y},${pos.z}`

function firstByCell<T extends Vec3>(entries: readonly T[]): Map<string, T> {
  const index = new Map<string, T>()
  for (const entry of entries) {
    const key = cellKey(entry)
    if (!index.has(key)) index.set(key, entry)
  }
  return index
}

function allByCell<T extends Vec3>(entries: readonly T[], normalizeY = false): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const entry of entries) {
    const key = normalizeY ? `${entry.x},${entry.y ?? 0},${entry.z}` : cellKey(entry)
    const atCell = index.get(key)
    if (atCell) atCell.push(entry)
    else index.set(key, [entry])
  }
  return index
}

/** Build fresh lookup tables for one synchronous movement search without altering the saved map. */
export function createMovementMapView(map: GameMap): GameMap {
  if (searchIndexes.has(map)) return map
  const view = { ...map }
  const doors = new Map<string, MapDoor>()
  const minimumSupportY = getMinimumSupportY(map)
  for (const door of map.doors ?? []) if (!doors.has(door.wallId)) doors.set(door.wallId, door)
  searchIndexes.set(view, {
    minimumSupportY,
    footprintTerrain: new Map(),
    water: new Map(), swimming: new Map(), jumpSupport: new Map(), adjacentFooting: new Map(), airborne: new Map(),
    ground: firstByCell(map.groundTiles ?? []),
    space: firstByCell(map.spaceTiles ?? []),
    voxels: firstByCell(map.voxels ?? []),
    stairs: firstByCell(map.stairs ?? []),
    walls: allByCell(map.walls ?? [], true),
    ceilings: allByCell(map.ceilings ?? []),
    doors,
  })
  return view
}

export function getMovementMapIndex(map: GameMap): MovementMapIndex | undefined {
  return searchIndexes.get(map)
}

/** Conservative lower bound for every dry or water launch surface on this snapshot. */
export function getMinimumSupportY(map: GameMap): number {
  const index = searchIndexes.get(map)
  if (index) return index.minimumSupportY
  let minimum = Infinity
  for (const layer of [map.groundTiles, map.spaceTiles, map.voxels, map.stairs]) {
    for (const cell of layer ?? []) minimum = Math.min(minimum, cell.y ?? 0)
  }
  return minimum
}
