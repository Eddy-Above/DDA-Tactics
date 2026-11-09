import type { ElementType, GameMap, Vec3 } from '~/types'
import { getVoxelMaterialElement, getVoxelMaterialId, voxelBlocksMovement } from './mapVoxels'
import { getMovementMapIndex } from './movementMapIndex'

export const NATUREWALK_ELEMENTS: readonly ElementType[] = ['fire', 'water', 'wind', 'ice', 'thunder', 'wood', 'earth', 'darkness', 'steel', 'light']
export const NATUREWALK_ENVIRONMENT_ID = 'naturewalk-environment'
export interface NaturewalkEnvironmentSettings { elements: ElementType[]; useMapTerrain: boolean }
type Quality = { id: string; choiceId?: string; ranks?: number }

export function normalizeNaturewalkElements(values: unknown): ElementType[] {
  return Array.isArray(values) ? [...new Set(values.filter((value): value is ElementType => NATUREWALK_ELEMENTS.includes(value)))] : []
}

export function getNaturewalkElements(qualities: readonly Quality[] | null | undefined): ElementType[] {
  return normalizeNaturewalkElements((qualities ?? []).filter(q => q.id === 'naturewalk').map(q => q.choiceId)).slice(0, 2)
}

export function getNaturewalkBonuses(qualities: readonly Quality[] | null | undefined, environment: readonly string[] = []) {
  const chosen = getNaturewalkElements(qualities)
  const has = (element: ElementType) => chosen.includes(element)
  const active = (element: ElementType) => has(element) && environment.includes(element)
  const advanced = (choice: string) => (qualities ?? []).some(q => q.id === 'advanced-mobility' && q.choiceId === `adv-${choice}`)
  return {
    damageBonus: active('fire') ? 2 : 0,
    dodgeBonus: active('wind') ? 2 : 0,
    armorBonus: active('ice') ? 2 : 0,
    movementBonus: active('steel') ? 2 + (advanced('wallclimber') || advanced('jumper') ? 2 : 0) : 0,
    armorPiercingRanks: active('earth') && advanced('digger') ? 1 : 0,
    poisonMinimumDuration: active('wood') ? 2 : 3,
    waterTempWounds: active('water') && advanced('swimmer') ? 2 : 0,
    immuneToBurn: has('fire'), canBreatheUnderwater: has('water'), canSeeDarkness: has('darkness'),
    resistsHeat: has('fire'), resistsCold: has('ice'), resistsHighWinds: has('wind'),
  }
}

export function getNaturewalkResistanceRanks(qualities: readonly Quality[] | null | undefined, effect: string): number {
  const chosen = getNaturewalkElements(qualities)
  return effect === 'Paralysis' && chosen.includes('thunder') || effect === 'Blind' && chosen.includes('light') ? 1 : 0
}

export function getNaturewalkTerrainElements(map: GameMap | null | undefined, position: Vec3 | null | undefined): ElementType[] {
  if (!map || !position) return []
  const index = getMovementMapIndex(map)
  const key = (p: Vec3) => `${p.x},${p.y},${p.z}`
  const at = <T extends Vec3>(entries: readonly T[] | undefined, p: Vec3) => entries?.find(t => t.x === p.x && t.y === p.y && t.z === p.z)
  const ground = index ? index.ground.get(key(position)) : at(map.groundTiles, position)
  const space = index ? index.space.get(key(position)) : at(map.spaceTiles, position)
  const voxel = index ? index.voxels.get(key(position)) : at(map.voxels, position)
  const below = { ...position, y: position.y - 1 }
  const support = index ? index.voxels.get(key(below)) : at(map.voxels, below)
  const elements: unknown[] = []
  if (ground) {
    elements.push(ground.element)
    if (ground.terrain === 'water' || ground.terrain === 'earth') elements.push(ground.terrain)
  }
  if (space?.spaceType === 'water' || space?.spaceType === 'earth') elements.push(space.spaceType)
  for (const cell of [voxel, support && (voxelBlocksMovement(support) || getVoxelMaterialId(support) === 'water') ? support : undefined]) {
    if (!cell) continue
    const material = getVoxelMaterialId(cell)
    elements.push(material === 'sand' ? 'fire' : material === 'snow' ? 'ice' : cell.element ?? getVoxelMaterialElement(material))
  }
  return normalizeNaturewalkElements(elements)
}

export function getNaturewalkEnvironmentSettings(hazards: readonly any[] | null | undefined): NaturewalkEnvironmentSettings {
  const settings = hazards?.find(hazard => hazard.id === NATUREWALK_ENVIRONMENT_ID)?.naturewalkEnvironment
  return { elements: normalizeNaturewalkElements(settings?.elements), useMapTerrain: settings?.useMapTerrain !== false }
}

export function resolveNaturewalkEnvironment(map: GameMap | null | undefined, position: Vec3 | null | undefined, settings: NaturewalkEnvironmentSettings): ElementType[] {
  return normalizeNaturewalkElements([...settings.elements, ...(settings.useMapTerrain ? getNaturewalkTerrainElements(map, position) : [])])
}
