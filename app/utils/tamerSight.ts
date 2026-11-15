import type { GameMap, Vec3 } from '~/types'
import type { FootprintDims } from './movementRules'
import { buildLosIndex, canSeeFootprint } from './lineOfSight'

/** A Tamer uses ordinary sight; any visible part of a larger Digimon is sufficient. */
export function createTamerSightCheck(map: GameMap, origin: Vec3 | undefined, destroyed: Set<string> = new Set()) {
  const index = origin ? buildLosIndex(map, destroyed) : null
  return (target: Vec3 | undefined, dims: FootprintDims): boolean => !!origin && !!target && !!index
    && canSeeFootprint(index, origin, { width: 1, height: 1, depth: 1 }, target, dims)
}
