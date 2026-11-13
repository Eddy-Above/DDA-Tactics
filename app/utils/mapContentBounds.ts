export const MAP_CONTENT_COLLECTIONS = ['groundTiles', 'spaceTiles', 'voxels', 'walls', 'ceilings', 'stairs'] as const
type Collection = typeof MAP_CONTENT_COLLECTIONS[number]
type MapContent = Partial<Record<Collection, ReadonlyArray<{ x: number; y?: number; z: number }>>>
type Extent = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
export interface MapContentBounds {
  x: number
  y: number
  z: number
  collections: Partial<Record<Collection, Extent | null>>
}

function extentOf(cells: ReadonlyArray<{ x: number; y?: number; z: number }>): Extent | null {
  if (!cells.length) return null
  const extent: Extent = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }
  for (const { x, y = 0, z } of cells) {
    extent.minX = Math.min(extent.minX, x)
    extent.minY = Math.min(extent.minY, y)
    extent.minZ = Math.min(extent.minZ, z)
    extent.maxX = Math.max(extent.maxX, x)
    extent.maxY = Math.max(extent.maxY, y)
    extent.maxZ = Math.max(extent.maxZ, z)
  }
  return extent
}

// Update only changed collections. Stored per-collection extents let deletions shrink
// display bounds without fetching unchanged geometry during partial autosaves.
export function updateMapContentBounds(previous: MapContentBounds | null | undefined, patch: MapContent): MapContentBounds {
  const collections = { ...previous?.collections }
  for (const key of MAP_CONTENT_COLLECTIONS) {
    if (patch[key] !== undefined) collections[key] = extentOf(patch[key]!)
  }
  const extents = Object.values(collections).filter((value): value is Extent => !!value)
  return {
    x: extents.length ? Math.max(...extents.map(e => e.maxX)) - Math.min(...extents.map(e => e.minX)) + 1 : 0,
    y: extents.length ? Math.max(...extents.map(e => e.maxY)) - Math.min(...extents.map(e => e.minY)) + 1 : 0,
    z: extents.length ? Math.max(...extents.map(e => e.maxZ)) - Math.min(...extents.map(e => e.minZ)) + 1 : 0,
    collections,
  }
}

export function mapContentSize(map: MapContent) {
  const { x, y, z } = updateMapContentBounds(null, map)
  return { x, y, z }
}

// Display metadata only; never used as a building or movement boundary.
export function mapContentSizeLabel(map: { contentBounds?: MapContentBounds | null }) {
  const { x = 0, y = 0, z = 0 } = map.contentBounds ?? {}
  return 'Bounds: (' + x + ', ' + y + ', ' + z + ')'
}

// Metadata controls the initial viewpoint, never a world boundary.
export function mapContentCenter(bounds: MapContentBounds | null | undefined) {
  const extents = Object.values(bounds?.collections ?? {}).filter((value): value is Extent => !!value)
  if (!extents.length) return { x: 0, y: 0, z: 0 }
  return {
    x: (Math.min(...extents.map(e => e.minX)) + Math.max(...extents.map(e => e.maxX)) + 1) / 2,
    y: (Math.min(...extents.map(e => e.minY)) + Math.max(...extents.map(e => e.maxY)) + 1) / 2,
    z: (Math.min(...extents.map(e => e.minZ)) + Math.max(...extents.map(e => e.maxZ)) + 1) / 2,
  }
}

export function mapContentView(bounds: MapContentBounds | null | undefined, aspect: number, verticalFov = 60) {
  const target = mapContentCenter(bounds)
  const radius = bounds ? Math.hypot(bounds.x, bounds.y, bounds.z) / 2 : 0
  const halfVerticalFov = verticalFov * Math.PI / 360
  const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * Math.max(aspect, 0.01))
  const distance = Math.max(28, radius * 1.15 / Math.sin(Math.min(halfVerticalFov, halfHorizontalFov)))
  const offset = distance / Math.sqrt(3)
  return {
    target,
    position: { x: target.x + offset, y: target.y + offset, z: target.z + offset },
    far: Math.max(500, distance + radius * 2),
    fogDensity: Math.min(0.04, 0.5 / (distance + radius)),
  }
}
