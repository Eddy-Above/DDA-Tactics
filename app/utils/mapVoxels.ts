import type { ElementType, GameMap, MapVoxel, Vec3 } from '~/types'
import { ELEMENT_COLORS } from '~/types'

export interface MapVoxelLightSourceDefinition {
  color: number
  intensity: number
  distance: number
  flicker?: boolean
}

export interface MapVoxelMaterialDefinition {
  id: string
  label: string
  color: number
  transparent?: boolean
  opacity?: number
  blocksMovementDefault?: boolean
  blocksSightDefault?: boolean
  lightSource?: MapVoxelLightSourceDefinition
  tags?: string[]
}

const elementMaterial = (
  id: ElementType,
  label: string,
  tags: string[] = [],
  options: Partial<MapVoxelMaterialDefinition> = {},
): MapVoxelMaterialDefinition => ({
  id,
  label,
  color: ELEMENT_COLORS[id],
  tags: [id, ...tags],
  blocksMovementDefault: true,
  blocksSightDefault: true,
  ...options,
})

export const MAP_VOXEL_MATERIALS: readonly MapVoxelMaterialDefinition[] = [
  elementMaterial('void', 'Neutral Block', ['solid']),
  elementMaterial('fire', 'Fire Block', ['elemental', 'hot']),
  elementMaterial('water', 'Water Volume', ['elemental', 'liquid'], {
    transparent: true,
    opacity: 0.48,
    blocksMovementDefault: false,
    blocksSightDefault: false,
  }),
  elementMaterial('wind', 'Air Current', ['elemental', 'air'], {
    transparent: true,
    opacity: 0.34,
    blocksMovementDefault: false,
    blocksSightDefault: false,
  }),
  elementMaterial('ice', 'Ice Block', ['elemental', 'slippery'], {
    transparent: true,
    opacity: 0.62,
    blocksMovementDefault: true,
    blocksSightDefault: false,
  }),
  elementMaterial('thunder', 'Thunder Block', ['elemental', 'electric']),
  elementMaterial('wood', 'Wood Block', ['organic']),
  elementMaterial('earth', 'Earth Block', ['solid', 'diggable']),
  {
    id: 'sand', label: 'Sand', color: 0xd7bf85,
    blocksMovementDefault: true, blocksSightDefault: true,
    tags: ['solid', 'diggable', 'sand'],
  },
  {
    id: 'snow', label: 'Snow', color: 0xebf3f8,
    blocksMovementDefault: true, blocksSightDefault: true,
    tags: ['solid', 'diggable', 'snow'],
  },
  {
    id: 'soft-metal', label: 'Soft Metal', color: 0xb4b9c6,
    blocksMovementDefault: true, blocksSightDefault: true,
    tags: ['solid', 'metal', 'soft-metal'],
  },
  elementMaterial('darkness', 'Darkness Block', ['elemental', 'shadow'], {
    transparent: true,
    opacity: 0.72,
    blocksMovementDefault: false,
    blocksSightDefault: true,
  }),
  elementMaterial('steel', 'Steel Block', ['solid', 'metal']),
  // Non-solid, but too bright to see (or target) through.
  elementMaterial('light', 'Light Block', ['elemental'], {
    transparent: true,
    opacity: 0.58,
    blocksMovementDefault: false,
    blocksSightDefault: true,
  }),
  {
    id: 'flickering-light', label: 'Flickering Light', color: 0xffd78a,
    transparent: true, opacity: 0.58,
    blocksMovementDefault: false, blocksSightDefault: true,
    lightSource: { color: 0xffd78a, intensity: 2.5, distance: 5, flicker: true },
    tags: ['elemental', 'light', 'light-source', 'flickering'],
  },
  {
    id: 'glass',
    label: 'Glass',
    color: 0x88ccff,
    transparent: true,
    opacity: 0.38,
    blocksMovementDefault: true,
    blocksSightDefault: false,
    tags: ['transparent', 'glass'],
  },
] as const

const MATERIAL_BY_ID = new Map(MAP_VOXEL_MATERIALS.map((material) => [material.id, material]))

export const DEFAULT_VOXEL_MATERIAL_ID = 'void'

export function getMapVoxels(map: Pick<GameMap, 'voxels'> | null | undefined): MapVoxel[] {
  return map?.voxels ?? []
}

export function getVoxelMaterialId(voxel: Pick<MapVoxel, 'materialId' | 'element'>): string {
  return voxel.materialId || voxel.element || DEFAULT_VOXEL_MATERIAL_ID
}

/** Keep material names extensible while saving an existing elemental affinity. */
export function getVoxelMaterialElement(materialId: string): ElementType {
  if (Object.prototype.hasOwnProperty.call(ELEMENT_COLORS, materialId)) return materialId as ElementType
  if (materialId === 'sand') return 'earth'
  if (materialId === 'snow') return 'ice'
  if (materialId === 'soft-metal') return 'steel'
  if (materialId === 'flickering-light') return 'light'
  return 'void'
}

export function getVoxelMaterialDefinition(voxelOrId: Pick<MapVoxel, 'materialId' | 'element'> | string | null | undefined): MapVoxelMaterialDefinition {
  const id = typeof voxelOrId === 'string'
    ? voxelOrId
    : voxelOrId
      ? getVoxelMaterialId(voxelOrId)
      : DEFAULT_VOXEL_MATERIAL_ID
  return MATERIAL_BY_ID.get(id) ?? MATERIAL_BY_ID.get(DEFAULT_VOXEL_MATERIAL_ID)!
}

export function parseVoxelColor(color: string | undefined): number | null {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return null
  return Number.parseInt(color.slice(1), 16)
}

export function getVoxelColor(voxel: MapVoxel): number {
  if (voxel.feature === 'window') return 0x88ccff
  return parseVoxelColor(voxel.color) ?? getVoxelMaterialDefinition(voxel).color
}

export function getVoxelLightSource(voxel: MapVoxel): MapVoxelLightSourceDefinition | undefined {
  if (voxel.feature === 'window') return undefined
  const source = getVoxelMaterialDefinition(voxel).lightSource
  return source ? { ...source, color: getVoxelColor(voxel) } : undefined
}

export function getVoxelOpacity(voxel: MapVoxel): number {
  if (voxel.feature === 'window') return 0.42
  const def = getVoxelMaterialDefinition(voxel)
  return Math.max(0, Math.min(1, voxel.opacity ?? def.opacity ?? 1))
}

export function voxelBlocksMovement(voxel: MapVoxel): boolean {
  if (voxel.feature === 'window') return true
  const def = getVoxelMaterialDefinition(voxel)
  return voxel.blocksMovement ?? def.blocksMovementDefault ?? true
}

export function voxelBlocksSight(voxel: MapVoxel): boolean {
  if (voxel.feature === 'window') return false
  const def = getVoxelMaterialDefinition(voxel)
  return voxel.blocksSight ?? def.blocksSightDefault ?? true
}

// Whether a voxel stops targeting, both into it and through it. Only non-solid, see-through
// volumes (water, air currents) let attacks and area effects pass; solid blocks (glass and ice
// included) and opaque volumes (darkness, light) block.
export function voxelBlocksTargeting(voxel: MapVoxel): boolean {
  return voxelBlocksMovement(voxel) || voxelBlocksSight(voxel)
}

export function vec3MatchesVoxel(pos: Vec3, voxel: Pick<MapVoxel, 'x' | 'y' | 'z'>): boolean {
  return voxel.x === pos.x && voxel.y === pos.y && voxel.z === pos.z
}

export function mapVoxelAt(map: Pick<GameMap, 'voxels'>, pos: Vec3): MapVoxel | null {
  return getMapVoxels(map).find((voxel) => vec3MatchesVoxel(pos, voxel)) ?? null
}

export function mapVoxelBlocksMovement(map: Pick<GameMap, 'voxels'>, pos: Vec3): boolean {
  const voxel = mapVoxelAt(map, pos)
  return Boolean(voxel && voxelBlocksMovement(voxel))
}

export function mapVoxelBlocksSight(map: Pick<GameMap, 'voxels'>, pos: Vec3): boolean {
  const voxel = mapVoxelAt(map, pos)
  return Boolean(voxel && voxelBlocksSight(voxel))
}

export function voxelKey(pos: Pick<Vec3, 'x' | 'y' | 'z'>): string {
  return `${pos.x},${pos.y},${pos.z}`
}
