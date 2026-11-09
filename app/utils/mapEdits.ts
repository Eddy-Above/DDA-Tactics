import { toRaw } from 'vue'
import type { GameMap, Vec3 } from '~/types'

export const MAP_GEOMETRY_COLLECTIONS = [
  'groundTiles', 'spaceTiles', 'voxels', 'walls', 'windows', 'doors', 'ceilings', 'stairs',
] as const

export type MapGeometryCollection = typeof MAP_GEOMETRY_COLLECTIONS[number]

export interface MapEditChange {
  revision: number
  previousRevision: number
  collections: MapGeometryCollection[]
  cells: Vec3[]
}

// Client-only metadata. Numeric links cannot retain previous map roots.
const revisions = new WeakMap<GameMap, number>()
const changes = new WeakMap<GameMap, MapEditChange>()
let nextRevision = 1

export function getMapGeometryRevision(map: GameMap | null | undefined): number {
  if (!map) return 0
  const raw = toRaw(map)
  let revision = revisions.get(raw)
  if (revision === undefined) {
    revision = nextRevision++
    revisions.set(raw, revision)
  }
  return revision
}

export function getMapEditChange(map: GameMap | null | undefined): MapEditChange | undefined {
  return map ? changes.get(toRaw(map)) : undefined
}

export function recordMapEdit(previous: GameMap, next: GameMap, collections: MapGeometryCollection[], cells: Vec3[]): GameMap {
  const previousRevision = getMapGeometryRevision(previous)
  const raw = toRaw(next)
  const revision = nextRevision++
  revisions.set(raw, revision)
  changes.set(raw, {
    revision,
    previousRevision,
    collections: [...new Set(collections)],
    cells: [...new Map(cells.map(({ x, y, z }) => [`${x},${y},${z}`, { x, y, z }])).values()],
  })
  return raw
}
