import type { GameMap, Vec3, DigimonSize } from '~/types'
import type { MovementCapabilities } from '~/utils/movementRules'
import { canPassThrough, canLandOn, sizeInteraction } from '~/utils/movementRules'
import { bfsReachable, findPath } from '~/utils/pathfinding'
import { vec3Key } from '~/utils/mapGeometry'

interface QualityLike { id: string; choiceId?: string; ranks?: number }

export function detectCapabilities(qualities: QualityLike[], movement: number, ram: number, cpu: number): MovementCapabilities {
  const has = (id: string) => qualities.some(q => q.id === id)
  const hasFlight = has('extra-movement') && qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'flight')
  const hasAdvFlight = has('advanced-mobility') && qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-flight')
  const hasJumper = has('extra-movement') && qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'jumper')
  const hasAdvJumper = has('advanced-mobility') && qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper')
  const hasClimb = has('extra-movement') && qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'wallclimber')
  const hasSwim = has('extra-movement') && qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'swimmer')
  const hasDig = has('extra-movement') && qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'digger')

  const jumpRange = hasJumper ? (hasAdvJumper ? movement + cpu : movement) : 0
  const jumpHeight = hasJumper ? (hasAdvJumper ? movement + cpu * 5 : movement) : 0

  return {
    canFly: hasFlight,
    canJump: hasJumper,
    jumpRange,
    jumpHeight,
    canClimb: hasClimb,
    canSwim: hasSwim,
    canDig: hasDig,
  }
}

export function useMapMovement() {
  const reachableCells = ref<Set<string>>(new Set())
  const activePath = ref<Vec3[]>([])

  function computeReachable(
    origin: Vec3,
    budget: number,
    caps: MovementCapabilities,
    map: GameMap,
    destroyedStructures: Set<string> = new Set(),
    unitPositions: Map<string, { pos: Vec3; size: DigimonSize; isEnemy?: boolean }> = new Map(),
    moverSize: DigimonSize = 'medium',
    moverIsEnemy: boolean = false,
  ) {
    // Build set of positions blocked by same-or-close-size units.
    // Same-faction units are always passable-only (allies pass through freely).
    // Cross-faction units use size-based blocking (< 2 size categories = blocked).
    const blockedPositions = new Set<string>()
    for (const [, { pos, size, isEnemy: partIsEnemy }] of unitPositions) {
      const sameFaction = moverIsEnemy === (partIsEnemy ?? false)
      const interaction = sameFaction ? 'passable-only' : sizeInteraction(moverSize, size)
      if (interaction === 'blocked') blockedPositions.add(vec3Key(pos))
    }
    // Passable-only positions (can traverse but not land)
    const passableOnlyPositions = new Set<string>()
    for (const [, { pos, size, isEnemy: partIsEnemy }] of unitPositions) {
      const sameFaction = moverIsEnemy === (partIsEnemy ?? false)
      const interaction = sameFaction ? 'passable-only' : sizeInteraction(moverSize, size)
      if (interaction === 'passable-only') passableOnlyPositions.add(vec3Key(pos))
    }

    const reachable = bfsReachable(origin, budget, (from, to) => {
      if (blockedPositions.has(vec3Key(to))) return false
      return canPassThrough(from, to, caps, map, destroyedStructures)
    })

    // Filter to only cells where the unit can actually land
    const landable = new Set<string>()
    for (const k of reachable) {
      if (k === vec3Key(origin)) continue
      if (passableOnlyPositions.has(k)) continue
      const [x, y, z] = k.split(',').map(Number)
      if (canLandOn({ x, y, z }, caps, map, blockedPositions)) landable.add(k)
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
    unitPositions: Map<string, { pos: Vec3; size: DigimonSize; isEnemy?: boolean }> = new Map(),
    moverSize: DigimonSize = 'medium',
    moverIsEnemy: boolean = false,
  ) {
    const blockedPositions = new Set<string>()
    for (const [, { pos, size, isEnemy: partIsEnemy }] of unitPositions) {
      const sameFaction = moverIsEnemy === (partIsEnemy ?? false)
      if (!sameFaction && sizeInteraction(moverSize, size) === 'blocked') blockedPositions.add(vec3Key(pos))
    }
    const path = findPath(from, to, (f, t) => {
      if (blockedPositions.has(vec3Key(t))) return false
      return canPassThrough(f, t, caps, map, destroyedStructures)
    })
    activePath.value = path ?? []
    return path
  }

  function clearMovement() {
    reachableCells.value = new Set()
    activePath.value = []
  }

  return { reachableCells, activePath, computeReachable, computePath, clearMovement, detectCapabilities }
}
