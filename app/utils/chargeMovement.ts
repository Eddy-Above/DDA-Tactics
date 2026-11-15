import type { DigimonSize, Vec3 } from '~/types'
import { footprintDistance, sizeInteraction, type FootprintDims } from './movementRules'

interface ChargeUnit { pos: Vec3; dims: FootprintDims; size: DigimonSize }

/** Intersect reachable anchors with target reach, checking rectangular bodies without enumerating their cells. */
export function chargeDestinationCells(reachable: Set<string>, mover: ChargeUnit, units: ChargeUnit[], reach: number): Set<string> {
  const result = new Set<string>()
  const blockers = units.filter(unit => sizeInteraction(mover.size, unit.size) !== 'shared')
  const clear = (pos: Vec3) => !blockers.some(unit => footprintDistance(pos, mover.dims, unit.pos, unit.dims) === 0)
  const boxes = units.map(unit => ({
    min: { x: unit.pos.x - mover.dims.width + 1 - reach, y: unit.pos.y - mover.dims.height + 1 - reach, z: unit.pos.z - mover.dims.depth + 1 - reach },
    max: { x: unit.pos.x + unit.dims.width - 1 + reach, y: unit.pos.y + unit.dims.height - 1 + reach, z: unit.pos.z + unit.dims.depth - 1 + reach },
  }))
  const candidates = boxes.reduce((sum, box) => sum + (box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1), 0)
  if (candidates < reachable.size) {
    // Usually only a small shell around each target matters, even when Flight
    // reaches thousands of cells. Query the retained movement set directly.
    for (const box of boxes) for (let x = box.min.x; x <= box.max.x; x++)
      for (let y = box.min.y; y <= box.max.y; y++) for (let z = box.min.z; z <= box.max.z; z++) {
        const key = `${x},${y},${z}`
        if (!result.has(key) && reachable.has(key) && clear({ x, y, z })) result.add(key)
      }
  } else {
    // Large bodies/Reach can cover more cells than the movement set itself.
    for (const key of reachable) {
      const [x, y, z] = key.split(',').map(Number)
      const pos = { x, y, z }
      if (units.some(unit => footprintDistance(pos, mover.dims, unit.pos, unit.dims) <= reach) && clear(pos)) result.add(key)
    }
  }
  return result
}
