import type { GameMap, Vec3, MapGroundTile, MapSpaceTile, MapVoxel, MapStair, MapWall, MapCeiling, MapDoor } from '~/types'

interface MovementMapIndex {
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
  for (const door of map.doors ?? []) if (!doors.has(door.wallId)) doors.set(door.wallId, door)
  searchIndexes.set(view, {
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
