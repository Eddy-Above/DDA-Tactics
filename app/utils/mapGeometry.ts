import type { Vec3 } from '~/types'

export function vec3Key(v: Vec3) { return `${v.x},${v.y},${v.z}` }
export function parseVec3Key(k: string): Vec3 { const [x, y, z] = k.split(',').map(Number); return { x, y, z } }

// Project a 3D world position to 2D screen coordinates using a camera matrix
// Returns { x, y } in normalized device coordinates (−1..1), or pixel coords if canvas size provided
export function worldToScreen(
  worldPos: Vec3,
  camera: { projectionMatrix: { elements: number[] }; matrixWorldInverse: { elements: number[] } },
  width: number,
  height: number,
): { x: number; y: number } {
  // This is a simplified version; the actual implementation will use THREE.Vector3.project()
  // This function is a placeholder for the pattern used in MapCanvas.vue
  return { x: 0, y: 0 }
}

// Get neighbours of a ground tile (same y level, orthogonal only)
export function groundNeighbours(pos: Vec3): Vec3[] {
  return [
    { x: pos.x + 1, y: pos.y, z: pos.z },
    { x: pos.x - 1, y: pos.y, z: pos.z },
    { x: pos.x, y: pos.y, z: pos.z + 1 },
    { x: pos.x, y: pos.y, z: pos.z - 1 },
  ]
}
