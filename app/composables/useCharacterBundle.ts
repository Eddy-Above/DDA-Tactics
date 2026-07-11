import type { Digimon, EvolutionLine, Tamer } from '../server/db/schema'
import type { CreationRules, DigimonFamily, DigimonStage } from '../types'
import { defaultCreationRules } from '~/utils/creationRules'

// v2 export format: a self-contained character bundle that embeds the
// creation rules it was built under, plus partner digimon and evolution
// lines. Records reference each other via localKeys (server IDs are
// regenerated on import), which the importer remaps to the new IDs —
// unlike the legacy array exports, partner links and evolution chains
// survive a round trip.
export const CHARACTER_BUNDLE_FORMAT = 'dda-character-bundle'

export interface BundleDigimon {
  localKey: string
  name: string
  nickname: string | null
  stage: DigimonStage
  attribute: Digimon['attribute']
  family: string
  type: string | null
  size: Digimon['size']
  baseStats: Digimon['baseStats']
  bonusStats: Digimon['bonusStats']
  attacks: Digimon['attacks']
  qualities: Digimon['qualities']
  dataOptimization: string | null
  bonusDP: number
  bonusDPForQualities: number
  isEnemy: boolean
  isDarkEvolution: boolean
  giganticDimensions: { width: number; height: number; depth: number } | null
  notes: string
  spriteUrl: string | null
  // True when this digimon was partnered to the bundle's tamer (vs. a
  // chain-referenced library/NPC record) — decides partnerId on import
  partneredToTamer: boolean
  evolvesFromKey?: string
  evolutionPathKeys?: string[]
}

export interface BundleEvolutionLine {
  name: string
  description: string
  currentStageIndex: number
  chain: Array<{
    stage: DigimonStage
    species: string
    digimonKey?: string
    isUnlocked: boolean
    evolvesFromIndex: number | null
  }>
}

export interface BundleTamer {
  name: string
  age: number
  attributes: Tamer['attributes']
  skills: Tamer['skills']
  aspects: Tamer['aspects']
  torments: Tamer['torments']
  inspiration: number
  grantedInspiration: number
  xp: number
  xpBonuses: Tamer['xpBonuses']
  notes: string
  spriteUrl: string | null
}

export interface CharacterBundle {
  format: typeof CHARACTER_BUNDLE_FORMAT
  version: 1
  exportedAt: string
  rules: CreationRules
  tamer?: BundleTamer
  digimon: BundleDigimon[]
  evolutionLines?: BundleEvolutionLine[]
}

export type ParsedBundleFile =
  | { kind: 'bundle'; bundle: CharacterBundle }
  | { kind: 'legacy'; entries: unknown[] }

export interface BundleImportTarget {
  // Campaign to import into; ignored when sandbox is true
  campaignId?: string | null
  // Import as workshop (sandbox) records: campaignId null, bundle rules
  // stored as each record's creationRules snapshot
  sandbox?: boolean
  // Import the bundle's digimon as partners of this existing tamer
  // (digimon-only bundles; ignored when the bundle contains a tamer)
  partnerTamerId?: string
}

export interface BundleImportResult {
  tamerId: string | null
  digimonIds: string[]
  evolutionLineIds: string[]
  errors: string[]
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_')
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

function toBundleTamer(tamer: Tamer): BundleTamer {
  return {
    name: tamer.name,
    age: tamer.age,
    attributes: tamer.attributes,
    skills: tamer.skills,
    aspects: tamer.aspects ?? [],
    torments: tamer.torments ?? [],
    inspiration: tamer.inspiration ?? 1,
    grantedInspiration: tamer.grantedInspiration ?? 0,
    xp: tamer.xp ?? 0,
    xpBonuses: tamer.xpBonuses,
    notes: tamer.notes ?? '',
    spriteUrl: tamer.spriteUrl ?? null,
  }
}

function toBundleDigimon(
  d: Digimon,
  localKey: string,
  keyById: Map<string, string>,
  tamerId: string | null,
): BundleDigimon {
  const evolvesFromKey = d.evolvesFromId ? keyById.get(d.evolvesFromId) : undefined
  const evolutionPathKeys = (d.evolutionPathIds ?? [])
    .map((id) => keyById.get(id))
    .filter((key): key is string => !!key)
  return {
    localKey,
    name: d.name,
    nickname: d.nickname ?? null,
    stage: d.stage as DigimonStage,
    attribute: d.attribute,
    family: d.family,
    type: d.type ?? null,
    size: d.size,
    baseStats: d.baseStats,
    bonusStats: d.bonusStats ?? { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 },
    attacks: d.attacks ?? [],
    qualities: d.qualities ?? [],
    dataOptimization: d.dataOptimization ?? null,
    bonusDP: d.bonusDP ?? 0,
    bonusDPForQualities: d.bonusDPForQualities ?? 0,
    isEnemy: d.isEnemy ?? false,
    isDarkEvolution: d.isDarkEvolution ?? false,
    giganticDimensions: d.giganticDimensions ?? null,
    notes: d.notes ?? '',
    spriteUrl: d.spriteUrl ?? null,
    partneredToTamer: !!tamerId && d.partnerId === tamerId,
    ...(evolvesFromKey ? { evolvesFromKey } : {}),
    ...(evolutionPathKeys.length > 0 ? { evolutionPathKeys } : {}),
  }
}

function validateBundle(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Not a valid bundle file'
  const b = value as Record<string, unknown>
  if (b.format !== CHARACTER_BUNDLE_FORMAT) return 'Unrecognized file format'
  if (b.version !== 1) return `Unsupported bundle version: ${b.version}`
  if (!b.rules || typeof b.rules !== 'object') return 'Bundle is missing its creation rules'
  if (!Array.isArray(b.digimon)) return 'Bundle is missing its digimon list'
  return null
}

export function useCharacterBundle() {
  const { createTamer } = useTamers()
  const { createDigimon, updateDigimon } = useDigimon()
  const { createEvolutionLine, updateEvolutionLine } = useEvolution()

  // Bundle a tamer with their partner digimon, evolution lines, and any
  // digimon referenced by those lines' chains.
  async function buildCharacterBundle(tamer: Tamer, rules?: CreationRules | null): Promise<CharacterBundle> {
    const effectiveRules = rules ?? tamer.creationRules ?? defaultCreationRules()

    const partnerEnvelope = await $fetch<{ data: Digimon[] }>('/api/digimon', {
      query: { partnerId: tamer.id, pageSize: '500' },
    })
    const digimonRecords: Digimon[] = [...partnerEnvelope.data]

    const lines = await $fetch<EvolutionLine[]>('/api/evolution-lines', {
      query: { partnerId: tamer.id },
    })

    // Pull in chain-referenced digimon that aren't partnered to the tamer
    const haveIds = new Set(digimonRecords.map((d) => d.id))
    const missingIds: string[] = []
    for (const line of lines) {
      for (const entry of line.chain ?? []) {
        if (entry.digimonId && !haveIds.has(entry.digimonId) && !missingIds.includes(entry.digimonId)) {
          missingIds.push(entry.digimonId)
        }
      }
    }
    if (missingIds.length > 0) {
      const missingEnvelope = await $fetch<{ data: Digimon[] }>('/api/digimon', {
        query: { ids: missingIds.join(',') },
      })
      digimonRecords.push(...missingEnvelope.data)
    }

    const keyById = new Map<string, string>()
    digimonRecords.forEach((d, i) => keyById.set(d.id, `d${i}`))

    return {
      format: CHARACTER_BUNDLE_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      rules: effectiveRules,
      tamer: toBundleTamer(tamer),
      digimon: digimonRecords.map((d) => toBundleDigimon(d, keyById.get(d.id)!, keyById, tamer.id)),
      evolutionLines: lines.map((line) => ({
        name: line.name,
        description: line.description ?? '',
        currentStageIndex: line.currentStageIndex ?? 0,
        chain: (line.chain ?? []).map((entry) => ({
          stage: entry.stage as DigimonStage,
          species: entry.species,
          digimonKey: entry.digimonId ? keyById.get(entry.digimonId) : undefined,
          isUnlocked: entry.isUnlocked ?? false,
          evolvesFromIndex: entry.evolvesFromIndex ?? null,
        })),
      })),
    }
  }

  async function exportCharacterBundle(tamer: Tamer, rules?: CreationRules | null) {
    const bundle = await buildCharacterBundle(tamer, rules)
    downloadJson(bundle, `${sanitizeFilename(tamer.name)}.character.json`)
  }

  function buildDigimonBundle(d: Digimon, rules?: CreationRules | null): CharacterBundle {
    const effectiveRules = rules ?? d.creationRules ?? defaultCreationRules()
    return {
      format: CHARACTER_BUNDLE_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      rules: effectiveRules,
      digimon: [toBundleDigimon(d, 'd0', new Map(), null)],
    }
  }

  function exportDigimonBundle(d: Digimon, rules?: CreationRules | null) {
    downloadJson(buildDigimonBundle(d, rules), `${sanitizeFilename(d.name)}.digimon.json`)
  }

  // Reads a JSON file and classifies it: a v2 character bundle, or a legacy
  // rules-less array export (only accepted by the DM library import).
  function parseBundleFile(file: File): Promise<ParsedBundleFile> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(e.target?.result as string)
        } catch {
          reject(new Error('Invalid JSON file'))
          return
        }
        if (Array.isArray(parsed)) {
          resolve({ kind: 'legacy', entries: parsed })
          return
        }
        const validationError = validateBundle(parsed)
        if (validationError) {
          reject(new Error(validationError))
          return
        }
        resolve({ kind: 'bundle', bundle: parsed as CharacterBundle })
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  // Client-orchestrated import (matches the existing library import pattern):
  // create tamer → create digimon without links (collect localKey→newId) →
  // re-link evolution paths → create evolution lines with remapped chain IDs.
  // Rule-parity checks happen in the calling page BEFORE this runs.
  async function importBundle(bundle: CharacterBundle, target: BundleImportTarget): Promise<BundleImportResult> {
    const result: BundleImportResult = { tamerId: null, digimonIds: [], evolutionLineIds: [], errors: [] }
    const campaignId = target.sandbox ? null : target.campaignId ?? null
    const creationRules = target.sandbox ? bundle.rules ?? defaultCreationRules() : null

    // 1. Tamer
    if (bundle.tamer) {
      const created = await createTamer({
        name: bundle.tamer.name,
        age: bundle.tamer.age,
        campaignId,
        attributes: bundle.tamer.attributes,
        skills: bundle.tamer.skills,
        aspects: bundle.tamer.aspects ?? [],
        torments: bundle.tamer.torments ?? [],
        inspiration: bundle.tamer.inspiration ?? 1,
        grantedInspiration: bundle.tamer.grantedInspiration ?? 0,
        xp: bundle.tamer.xp ?? 0,
        xpBonuses: bundle.tamer.xpBonuses,
        notes: bundle.tamer.notes ?? '',
        spriteUrl: bundle.tamer.spriteUrl ?? undefined,
        creationRules,
      })
      if (!created) {
        result.errors.push(`Failed to create tamer "${bundle.tamer.name}" — import aborted`)
        return result
      }
      result.tamerId = created.id
    }

    const partnerTamerId = bundle.tamer ? result.tamerId : target.partnerTamerId ?? null

    // 2. Digimon (links deferred to step 3 — new IDs don't exist yet)
    const idByKey = new Map<string, string>()
    for (const bd of bundle.digimon) {
      const created = await createDigimon({
        name: bd.name,
        nickname: bd.nickname ?? undefined,
        stage: bd.stage,
        attribute: bd.attribute,
        family: bd.family as DigimonFamily,
        type: bd.type ?? undefined,
        size: bd.size,
        baseStats: bd.baseStats,
        bonusStats: bd.bonusStats,
        bonusDP: bd.bonusDP ?? 0,
        bonusDPForQualities: bd.bonusDPForQualities ?? 0,
        attacks: bd.attacks ?? [],
        qualities: bd.qualities ?? [],
        dataOptimization: bd.dataOptimization ?? undefined,
        isEnemy: bd.isEnemy ?? false,
        isDarkEvolution: bd.isDarkEvolution ?? false,
        giganticDimensions: bd.giganticDimensions ?? null,
        partnerId: (bundle.tamer ? bd.partneredToTamer : true) && partnerTamerId ? partnerTamerId : null,
        campaignId,
        notes: bd.notes ?? '',
        spriteUrl: bd.spriteUrl ?? undefined,
        creationRules,
      })
      if (created) {
        idByKey.set(bd.localKey, created.id)
        result.digimonIds.push(created.id)
      } else {
        result.errors.push(`Failed to create digimon "${bd.name}"`)
      }
    }

    // 3. Evolution links. Two passes: evolutionPathIds first, then
    // evolvesFromId — the PUT's bidirectional sync would otherwise let a
    // later sibling's path update overwrite a child's true evolvesFromId.
    for (const bd of bundle.digimon) {
      const newId = idByKey.get(bd.localKey)
      if (!newId || !bd.evolutionPathKeys?.length) continue
      const pathIds = bd.evolutionPathKeys
        .map((key) => idByKey.get(key))
        .filter((id): id is string => !!id)
      if (pathIds.length > 0) {
        const updated = await updateDigimon(newId, { evolutionPathIds: pathIds })
        if (!updated) result.errors.push(`Failed to link evolutions for "${bd.name}"`)
      }
    }
    for (const bd of bundle.digimon) {
      const newId = idByKey.get(bd.localKey)
      const evolvesFromId = bd.evolvesFromKey ? idByKey.get(bd.evolvesFromKey) : undefined
      if (!newId || !evolvesFromId) continue
      const updated = await updateDigimon(newId, { evolvesFromId })
      if (!updated) result.errors.push(`Failed to link pre-evolution for "${bd.name}"`)
    }

    // 4. Evolution lines with remapped chain digimonIds
    for (const line of bundle.evolutionLines ?? []) {
      const chain = (line.chain ?? [])
        .map((entry) => ({
          stage: entry.stage,
          species: entry.species,
          digimonId: entry.digimonKey ? idByKey.get(entry.digimonKey) ?? '' : '',
          isUnlocked: entry.isUnlocked ?? false,
          evolvesFromIndex: entry.evolvesFromIndex ?? null,
        }))
        .filter((entry) => !!entry.digimonId)
      if (chain.length === 0) {
        result.errors.push(`Skipped evolution line "${line.name}" — no linked digimon could be resolved`)
        continue
      }
      const created = await createEvolutionLine({
        name: line.name,
        description: line.description ?? '',
        chain,
        partnerId: partnerTamerId ?? undefined,
        campaignId: campaignId ?? undefined,
      })
      if (created) {
        result.evolutionLineIds.push(created.id)
        if ((line.currentStageIndex ?? 0) > 0) {
          await updateEvolutionLine(created.id, { currentStageIndex: line.currentStageIndex })
        }
      } else {
        result.errors.push(`Failed to create evolution line "${line.name}"`)
      }
    }

    return result
  }

  return {
    buildCharacterBundle,
    exportCharacterBundle,
    buildDigimonBundle,
    exportDigimonBundle,
    parseBundleFile,
    importBundle,
  }
}
