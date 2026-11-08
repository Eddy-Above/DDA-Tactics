import { ref } from 'vue'
import type { GameMap, Vec3, DigimonSize } from '~/types'
import type { MovementCapabilities } from '~/utils/movementRules'
import { canPassThrough, canLandOn, getMovementOccupancy, getFootprintDimensions, getFootprintCells, detectCapabilities, PROJECTILE_CAPS } from '~/utils/movementRules'
import { searchReachable, findPath, type ReachableSearch } from '~/utils/pathfinding'
import { vec3Key } from '~/utils/mapGeometry'

type GiganticDims = { width: number; height: number; depth: number } | null
type UnitPositions = Map<string, { pos: Vec3; size: DigimonSize; isEnemy?: boolean; giganticDimensions?: GiganticDims }>

function searchContextKey(
  origin: Vec3, caps: MovementCapabilities, destroyed: Set<string>, units: UnitPositions,
  moverSize: DigimonSize, moverIsEnemy: boolean, moverDimensions: GiganticDims,
): string {
  return JSON.stringify([
    origin, caps, [...destroyed].sort(),
    [...units].sort(([a], [b]) => a.localeCompare(b)),
    moverSize, moverIsEnemy, moverDimensions,
  ])
}

// Capabilities + projectile caps now live in the shared movementRules module (single source of
// truth for client and server). Re-exported here so existing `from '~/composables/useMapMovement'`
// importers keep working.
export { detectCapabilities, PROJECTILE_CAPS }

export function useMapMovement() {
  const reachableCells = ref<Set<string>>(new Set())
  const activePath = ref<Vec3[]>([])
  let cachedSearch: { map: GameMap; contextKey: string; search: ReachableSearch; landable: Set<string> } | null = null

  // The map owner calls this for in-place geometry edits. Origin, capabilities,
  // destroyed structures and occupied footprints are also compared on every use.
  function invalidateSearch() {
    cachedSearch = null
  }

  function computeReachable(
    origin: Vec3,
    budget: number,
    caps: MovementCapabilities,
    map: GameMap,
    destroyedStructures: Set<string> = new Set(),
    unitPositions: UnitPositions = new Map(),
    moverSize: DigimonSize = 'medium',
    moverIsEnemy: boolean = false,
    moverGiganticDimensions: GiganticDims = null,
  ) {
    const { blockedPositions, landingBlockedPositions } = getMovementOccupancy(moverSize, unitPositions.values())
    const moverDims = getFootprintDimensions(moverSize, moverGiganticDimensions)

    const search = searchReachable(origin, budget, (from, to) => {
      if (blockedPositions.size && getFootprintCells(to, moverDims).some(cell => blockedPositions.has(vec3Key(cell)))) return false
      return canPassThrough(from, to, caps, map, destroyedStructures)
    })

    // Small allows passage only; Tiny allows sharing. Check the complete mover footprint.
    const landable = new Set<string>()
    for (const k of search.cells) {
      if (k === vec3Key(origin)) continue
      const [x, y, z] = k.split(',').map(Number)
      const pos = { x, y, z }
      if (!canLandOn(pos, caps, map, landingBlockedPositions, origin)) continue
      const overlaps = getFootprintCells(pos, moverDims).some(cell => landingBlockedPositions.has(vec3Key(cell)))
      if (overlaps) continue
      landable.add(k)
    }

    cachedSearch = {
      map,
      contextKey: searchContextKey(origin, caps, destroyedStructures, unitPositions, moverSize, moverIsEnemy, moverGiganticDimensions),
      search, landable,
    }
    reachableCells.value = landable
    return landable
  }

  function computePath(
    from: Vec3,
    to: Vec3,
    caps: MovementCapabilities,
    map: GameMap,
    destroyedStructures: Set<string> = new Set(),
    unitPositions: UnitPositions = new Map(),
    moverSize: DigimonSize = 'medium',
    moverIsEnemy: boolean = false,
    moverGiganticDimensions: GiganticDims = null,
  ) {
    if (cachedSearch?.map === map && cachedSearch.contextKey === searchContextKey(
      from, caps, destroyedStructures, unitPositions, moverSize, moverIsEnemy, moverGiganticDimensions,
    )) {
      const path = cachedSearch.search.pathTo(to)
      if (path) {
        if (path.length > 1 && !cachedSearch.landable.has(vec3Key(to))) {
          activePath.value = []
          return null
        }
        activePath.value = path
        return path
      }
    }
    const { blockedPositions, landingBlockedPositions } = getMovementOccupancy(moverSize, unitPositions.values())
    const moverDims = getFootprintDimensions(moverSize, moverGiganticDimensions)
    if (vec3Key(from) !== vec3Key(to) && (
      getFootprintCells(to, moverDims).some(cell => landingBlockedPositions.has(vec3Key(cell)))
    )) {
      activePath.value = []
      return null
    }
    const path = findPath(from, to, (f, t) => {
      if (blockedPositions.size && getFootprintCells(t, moverDims).some(cell => blockedPositions.has(vec3Key(cell)))) return false
      return canPassThrough(f, t, caps, map, destroyedStructures)
    })
    activePath.value = path ?? []
    return path
  }

  function clearMovement() {
    invalidateSearch()
    reachableCells.value = new Set()
    activePath.value = []
  }

  return { reachableCells, activePath, computeReachable, computePath, clearMovement, invalidateSearch, detectCapabilities }
}
