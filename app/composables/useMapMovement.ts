import { ref } from 'vue'
import type { GameMap, Vec3, DigimonSize } from '~/types'
import type { MovementCapabilities } from '~/utils/movementRules'
import { canPassThrough, canLandOn, sizeInteraction, getFootprintDimensions, getFootprintCells, detectCapabilities, PROJECTILE_CAPS } from '~/utils/movementRules'
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
  let cachedSearch: { map: GameMap; contextKey: string; search: ReachableSearch } | null = null

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
    // Build set of positions blocked by same-or-close-size units.
    // Same-faction units are always passable-only (allies pass through freely).
    // Cross-faction units use size-based blocking (< 2 size categories = blocked).
    // Each unit's full 3D box (all width x height x depth cells) counts as occupied.
    const blockedPositions = new Set<string>()
    for (const [, { pos, size, isEnemy: partIsEnemy, giganticDimensions }] of unitPositions) {
      const sameFaction = moverIsEnemy === (partIsEnemy ?? false)
      const interaction = sameFaction ? 'passable-only' : sizeInteraction(moverSize, size)
      if (interaction === 'blocked') {
        const dims = getFootprintDimensions(size, giganticDimensions)
        for (const cell of getFootprintCells(pos, dims)) blockedPositions.add(vec3Key(cell))
      }
    }
    // Passable-only positions (can traverse but not land)
    const passableOnlyPositions = new Set<string>()
    for (const [, { pos, size, isEnemy: partIsEnemy, giganticDimensions }] of unitPositions) {
      const sameFaction = moverIsEnemy === (partIsEnemy ?? false)
      const interaction = sameFaction ? 'passable-only' : sizeInteraction(moverSize, size)
      if (interaction === 'passable-only') {
        const dims = getFootprintDimensions(size, giganticDimensions)
        for (const cell of getFootprintCells(pos, dims)) passableOnlyPositions.add(vec3Key(cell))
      }
    }

    const search = searchReachable(origin, budget, (from, to) => {
      if (blockedPositions.has(vec3Key(to))) return false
      return canPassThrough(from, to, caps, map, destroyedStructures)
    })
    cachedSearch = {
      map,
      contextKey: searchContextKey(origin, caps, destroyedStructures, unitPositions, moverSize, moverIsEnemy, moverGiganticDimensions),
      search,
    }

    // Filter to only cells where the unit can actually land — the mover's own full
    // 3D box at that anchor must not overlap any other unit's box (blocked or passable-only).
    const moverDims = getFootprintDimensions(moverSize, moverGiganticDimensions)
    const landable = new Set<string>()
    for (const k of search.cells) {
      if (k === vec3Key(origin)) continue
      const [x, y, z] = k.split(',').map(Number)
      const pos = { x, y, z }
      if (!canLandOn(pos, caps, map, blockedPositions, origin)) continue
      const overlaps = getFootprintCells(pos, moverDims).some(cell => {
        const ck = vec3Key(cell)
        return blockedPositions.has(ck) || passableOnlyPositions.has(ck)
      })
      if (overlaps) continue
      landable.add(k)
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
        activePath.value = path
        return path
      }
    }
    const blockedPositions = new Set<string>()
    for (const [, { pos, size, isEnemy: partIsEnemy, giganticDimensions }] of unitPositions) {
      const sameFaction = moverIsEnemy === (partIsEnemy ?? false)
      if (!sameFaction && sizeInteraction(moverSize, size) === 'blocked') {
        const dims = getFootprintDimensions(size, giganticDimensions)
        for (const cell of getFootprintCells(pos, dims)) blockedPositions.add(vec3Key(cell))
      }
    }
    const path = findPath(from, to, (f, t) => {
      if (blockedPositions.has(vec3Key(t))) return false
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
