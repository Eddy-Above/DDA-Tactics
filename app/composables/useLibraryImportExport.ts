import type { Tamer, Digimon } from '../server/db/schema'
import type { GameMap } from '../types'

interface ImportResult {
  successful: number
  failed: number
  errors: Array<{ index: number; name: string; error: string }>
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function parseJsonFile(file: File): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        resolve(Array.isArray(parsed) ? parsed : [parsed])
      }
      catch {
        reject(new Error('Invalid JSON file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function validateTamerEntry(data: unknown): string | null {
  if (!data || typeof data !== 'object') return 'Not an object'
  const d = data as Record<string, unknown>
  if (!d.name || typeof d.name !== 'string') return 'Missing or invalid "name"'
  if (d.age === undefined || typeof d.age !== 'number') return 'Missing or invalid "age"'
  if (!d.attributes || typeof d.attributes !== 'object') return 'Missing "attributes"'
  const attrs = d.attributes as Record<string, unknown>
  for (const key of ['agility', 'body', 'charisma', 'intelligence', 'willpower']) {
    if (typeof attrs[key] !== 'number') return `Missing attribute "${key}"`
  }
  if (!d.skills || typeof d.skills !== 'object') return 'Missing "skills"'
  const skills = d.skills as Record<string, unknown>
  for (const key of ['dodge', 'fight', 'stealth', 'athletics', 'endurance', 'featsOfStrength', 'manipulate', 'perform', 'persuasion', 'computer', 'survival', 'knowledge', 'perception', 'decipherIntent', 'bravery']) {
    if (typeof skills[key] !== 'number') return `Missing skill "${key}"`
  }
  return null
}

function validateMapEntry(data: unknown): string | null {
  if (!data || typeof data !== 'object') return 'Not an object'
  const d = data as Record<string, unknown>
  if (!d.name || typeof d.name !== 'string') return 'Missing or invalid "name"'
  if (!d.dimensions || typeof d.dimensions !== 'object') return 'Missing "dimensions"'
  const dims = d.dimensions as Record<string, unknown>
  if (typeof dims.width !== 'number' || typeof dims.depth !== 'number') return 'dimensions must have numeric width and depth'
  return null
}

function validateDigimonEntry(data: unknown): string | null {
  if (!data || typeof data !== 'object') return 'Not an object'
  const d = data as Record<string, unknown>
  if (!d.name || typeof d.name !== 'string') return 'Missing or invalid "name"'

  if (!d.stage || typeof d.stage !== 'string') return 'Missing or invalid "stage"'
  if (!d.attribute || typeof d.attribute !== 'string') return 'Missing or invalid "attribute"'
  if (!d.family || typeof d.family !== 'string') return 'Missing or invalid "family"'
  if (!d.baseStats || typeof d.baseStats !== 'object') return 'Missing "baseStats"'
  const stats = d.baseStats as Record<string, unknown>
  for (const key of ['accuracy', 'damage', 'dodge', 'armor', 'health']) {
    if (typeof stats[key] !== 'number') return `Missing baseStats.${key}`
  }
  return null
}

export function useLibraryImportExport() {
  const { createTamer } = useTamers()
  const { createDigimon } = useDigimon()
  const { createMap, updateMap } = useMap()

  function exportTamers(tamers: Tamer[]) {
    const data = tamers.map((t) => ({
      name: t.name,
      age: t.age,
      attributes: t.attributes,
      skills: t.skills,
      aspects: t.aspects,
      torments: t.torments,
      specialOrders: t.specialOrders,
      inspiration: t.inspiration,
      grantedInspiration: t.grantedInspiration,
      xp: t.xp,
      xpBonuses: t.xpBonuses,
      notes: t.notes,
      spriteUrl: t.spriteUrl ?? null,
    }))
    downloadJson(data, 'tamers.json')
  }

  function exportDigimon(digimonList: Digimon[]) {
    if (!confirm('Exporting Digimon will not include partner assignments or evolution chain links. These will need to be reassigned after import. Continue?')) {
      return
    }
    const data = digimonList.map((d) => {
      const raw = (d as unknown) as Record<string, unknown>
      return {
        name: d.name,
        nickname: d.nickname ?? null,
        stage: d.stage,
        attribute: d.attribute,
        family: d.family,
        type: d.type ?? null,
        size: d.size,
        baseStats: d.baseStats,
        bonusStats: raw.bonusStats ?? { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 },
        attacks: d.attacks,
        qualities: d.qualities,
        dataOptimization: d.dataOptimization ?? null,
        bonusDP: d.bonusDP,
        bonusDPForQualities: (raw.bonusDPForQualities as number | undefined) ?? 0,
        currentWounds: d.currentWounds,
        currentStance: d.currentStance,
        isEnemy: d.isEnemy,
        notes: d.notes,
        spriteUrl: d.spriteUrl ?? null,
      }
    })
    downloadJson(data, 'digimon.json')
  }

  async function importTamers(file: File, campaignId: string): Promise<ImportResult> {
    let entries: unknown[]
    try {
      entries = await parseJsonFile(file)
    }
    catch (e) {
      return {
        successful: 0,
        failed: 1,
        errors: [{ index: -1, name: '', error: e instanceof Error ? e.message : 'Unknown error' }],
      }
    }

    const result: ImportResult = { successful: 0, failed: 0, errors: [] }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as Record<string, unknown>
      const validationError = validateTamerEntry(entry)
      if (validationError) {
        result.failed++
        result.errors.push({ index: i, name: (entry?.name as string) || '', error: validationError })
        continue
      }

      try {
        const created = await createTamer({
          name: entry.name as string,
          age: entry.age as number,
          campaignId,
          attributes: entry.attributes as Tamer['attributes'],
          skills: entry.skills as Tamer['skills'],
          aspects: (entry.aspects as Tamer['aspects']) ?? [],
          torments: (entry.torments as Tamer['torments']) ?? [],
          inspiration: (entry.inspiration as number) ?? 1,
          grantedInspiration: (entry.grantedInspiration as number) ?? 0,
          xp: (entry.xp as number) ?? 0,
          notes: (entry.notes as string) ?? '',
          spriteUrl: (entry.spriteUrl as string | undefined) ?? undefined,
        })
        if (created) {
          result.successful++
        }
        else {
          result.failed++
          result.errors.push({ index: i, name: entry.name as string, error: 'Server returned no result' })
        }
      }
      catch (e) {
        result.failed++
        result.errors.push({
          index: i,
          name: (entry.name as string) || '',
          error: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    }

    return result
  }

  async function importDigimon(file: File, campaignId: string): Promise<ImportResult> {
    let entries: unknown[]
    try {
      entries = await parseJsonFile(file)
    }
    catch (e) {
      return {
        successful: 0,
        failed: 1,
        errors: [{ index: -1, name: '', error: e instanceof Error ? e.message : 'Unknown error' }],
      }
    }

    const result: ImportResult = { successful: 0, failed: 0, errors: [] }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as Record<string, unknown>
      const validationError = validateDigimonEntry(entry)
      if (validationError) {
        result.failed++
        result.errors.push({ index: i, name: (entry?.name as string) || '', error: validationError })
        continue
      }

      try {
        const created = await createDigimon({
          name: entry.name as string,
          nickname: (entry.nickname as string | null | undefined) ?? undefined,
          stage: entry.stage as Digimon['stage'],
          attribute: entry.attribute as Digimon['attribute'],
          family: entry.family as string as Digimon['family'],
          type: (entry.type as string | undefined) ?? undefined,
          size: (entry.size as Digimon['size']) ?? 'medium',
          baseStats: entry.baseStats as Digimon['baseStats'],
          attacks: (entry.attacks as Digimon['attacks']) ?? [],
          qualities: (entry.qualities as Digimon['qualities']) ?? [],
          dataOptimization: (entry.dataOptimization as string | undefined) ?? undefined,
          bonusDP: (entry.bonusDP as number) ?? 0,
          isEnemy: (entry.isEnemy as boolean) ?? false,
          campaignId,
          notes: (entry.notes as string) ?? '',
          spriteUrl: (entry.spriteUrl as string | undefined) ?? undefined,
        })
        if (created) {
          result.successful++
        }
        else {
          result.failed++
          result.errors.push({ index: i, name: entry.name as string, error: 'Server returned no result' })
        }
      }
      catch (e) {
        result.failed++
        result.errors.push({
          index: i,
          name: (entry.name as string) || '',
          error: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    }

    return result
  }

  function exportMap(map: GameMap) {
    const data = {
      name: map.name,
      description: map.description,
      dimensions: map.dimensions,
      groundTiles: map.groundTiles,
      spaceTiles: map.spaceTiles,
      voxels: map.voxels,
      walls: map.walls,
      windows: map.windows,
      doors: map.doors,
      ceilings: map.ceilings,
      stairs: map.stairs,
    }
    downloadJson(data, `${map.name.replace(/[^a-z0-9]/gi, '_')}.map.json`)
  }

  function exportMaps(maps: GameMap[]) {
    const data = maps.map(map => ({
      name: map.name,
      description: map.description,
      dimensions: map.dimensions,
      groundTiles: map.groundTiles,
      spaceTiles: map.spaceTiles,
      voxels: map.voxels,
      walls: map.walls,
      windows: map.windows,
      doors: map.doors,
      ceilings: map.ceilings,
      stairs: map.stairs,
    }))
    downloadJson(data, 'maps.json')
  }

  async function importMaps(file: File, campaignId: string): Promise<ImportResult> {
    let entries: unknown[]
    try {
      entries = await parseJsonFile(file)
    }
    catch (e) {
      return {
        successful: 0,
        failed: 1,
        errors: [{ index: -1, name: '', error: e instanceof Error ? e.message : 'Unknown error' }],
      }
    }

    const result: ImportResult = { successful: 0, failed: 0, errors: [] }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as Record<string, unknown>
      const validationError = validateMapEntry(entry)
      if (validationError) {
        result.failed++
        result.errors.push({ index: i, name: (entry?.name as string) || '', error: validationError })
        continue
      }

      try {
        const created = await createMap({
          name: entry.name as string,
          description: (entry.description as string | undefined) ?? '',
          campaignId,
          dimensions: entry.dimensions as GameMap['dimensions'],
        })
        await updateMap(created.id, {
          groundTiles: (entry.groundTiles as GameMap['groundTiles']) ?? [],
          spaceTiles: (entry.spaceTiles as GameMap['spaceTiles']) ?? [],
          voxels: (entry.voxels as GameMap['voxels']) ?? [],
          walls: (entry.walls as GameMap['walls']) ?? [],
          windows: (entry.windows as GameMap['windows']) ?? [],
          doors: (entry.doors as GameMap['doors']) ?? [],
          ceilings: (entry.ceilings as GameMap['ceilings']) ?? [],
          stairs: (entry.stairs as GameMap['stairs']) ?? [],
        })
        result.successful++
      }
      catch (e) {
        result.failed++
        result.errors.push({
          index: i,
          name: (entry.name as string) || '',
          error: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    }

    return result
  }

  return { exportTamers, exportDigimon, importTamers, importDigimon, exportMap, exportMaps, importMaps }
}
