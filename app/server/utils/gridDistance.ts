import type { Vec3 } from '../../types'

// Chebyshev distance — "king's move" in 3D grid
export function chebyshev(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}
