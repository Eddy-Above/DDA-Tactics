import type * as THREE from 'three'

/** Dispose owned objects once, including resources shared by siblings. */
export function disposeMapObjects(objects: readonly THREE.Object3D[]): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  for (const object of objects) object.traverse(child => {
    const renderable = child as THREE.Mesh
    if (renderable.geometry) geometries.add(renderable.geometry)
    const list = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
    for (const material of list) if (material) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

export function clearMapGroup(group: THREE.Group): void {
  disposeMapObjects(group.children)
  group.clear()
}

const previewKeys = new WeakMap<THREE.Group, string>()
export function mapPreviewChanged(group: THREE.Group, key: string): boolean {
  if (group.children.length && previewKeys.get(group) === key) return false
  previewKeys.set(group, key)
  return true
}
