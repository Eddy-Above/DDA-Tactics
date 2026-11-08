import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import type { Vec3 } from '../../types'
import { applyEffectToParticipant } from './applyEffect'
import { getUnlockedSpecialOrders } from '../../utils/specialOrders'
import { getDigimonDerivedStats } from './resolveSupportAttack'
import { computeAreaCells } from '../../utils/areaShapes'
import { getFootprintCells, getFootprintDimensions } from '../../utils/movementRules'
import { getRoomPositions, broadcast } from './encounterRoom'
import { buildEncounterPayload } from './encounterPayload'
import { loadEncounterCombatContext } from './combatContext'
import { loadParticipantDigimon, loadTamersByIds } from './combatSpatial'

const AURA_NAME = 'Guiding Light'
const FOCUS_NAME = 'Guiding Light (Focus)'

function applyAura(effects: any[], name: string, source: string, potency: number, description: string, houseRules?: { stunMaxDuration1?: boolean }): any[] {
  const existing = effects.find((e: any) => e.name === name)
  if (existing && existing.source === source && existing.potency === potency) return effects
  return applyEffectToParticipant(effects, { name, type: 'buff', duration: 0, source, description, potency }, houseRules)
}

function removeAura(effects: any[], name: string): any[] {
  if (!effects.some((e: any) => e.name === name)) return effects
  return effects.filter((e: any) => e.name !== name)
}

/**
 * Recomputes the [Guiding Light] aura across all participants: any eligible Digimon (its
 * partner Tamer's Charisma has unlocked Guiding Light) grants +2 Accuracy to allied Digimon within
 * its ranged Burst, and itself gains +1 Dodge per allied Digimon in that area. Idempotent —
 * safe to call on every position change; a target only in range of one source, in case two
 * owners' radii overlap the same ally (mirrors how other PERMANENT_EFFECTS like Shield replace
 * rather than stack).
 */
export async function applyGuidingLightAuras(
  participants: any[],
  positions: Record<string, Vec3>,
  campaignLevel: 'standard' | 'enhanced' | 'extreme',
  houseRules?: { stunMaxDuration1?: boolean }
): Promise<{ participants: any[]; changed: boolean }> {
  const digimonParticipants = participants.filter((p) => p.type === 'digimon' && !p.inReserve && !p.isMinion && !p.summonerId && !p.summonedByParticipantId)

  const digimonRows = await loadParticipantDigimon(digimonParticipants)
  const partnerIds = digimonParticipants.flatMap(p => {
    if (!positions[p.id]) return []
    const partnerId = digimonRows.get(p.entityId)?.partnerId
    return partnerId ? [partnerId] : []
  })
  const tamerRows = await loadTamersByIds(partnerIds)

  const footprints = new Map<string, Vec3[]>()
  for (const p of digimonParticipants) {
    const position = positions[p.id]
    const record = digimonRows.get(p.entityId)
    if (!position || !record) continue
    footprints.set(p.id, getFootprintCells(position, getFootprintDimensions(record.size, record.giganticDimensions)))
  }

  // Every eligible Guiding Light source and the allies currently within its burst radius
  const sources: { ownerId: string; allyIds: Set<string> }[] = []
  for (const p of digimonParticipants) {
    const ownerPos = positions[p.id]
    if (!ownerPos) continue
    const d = digimonRows.get(p.entityId)
    if (!d?.partnerId) continue
    const tamer = tamerRows.get(d.partnerId)
    if (!tamer) continue
    const unlocked = getUnlockedSpecialOrders(tamer.attributes as any, tamer.xpBonuses as any, campaignLevel)
    if (!unlocked.some((o) => o.name === AURA_NAME)) continue

    const derived = await getDigimonDerivedStats(p.entityId)
    if (!derived) continue
    // Use the map's actual Burst cells and full target footprints, including height. An
    // anchor-distance check overreaches diagonally and misses the far side of large units.
    const burstCells = new Set(computeAreaCells(
      'burst', 'ranged', ownerPos, { x: 0, y: 0, z: 0 }, derived.bit, 0, 0,
      getFootprintDimensions(d.size, d.giganticDimensions),
    ).map(cell => `${cell.x},${cell.y},${cell.z}`))

    const allyIds = new Set<string>()
    for (const other of digimonParticipants) {
      if (other.id === p.id) continue
      if ((other.isEnemy ?? false) !== (p.isEnemy ?? false)) continue
      if (footprints.get(other.id)?.some(cell => burstCells.has(`${cell.x},${cell.y},${cell.z}`))) {
        allyIds.add(other.id)
      }
    }
    sources.push({ ownerId: p.id, allyIds })
  }

  // First source reached wins per ally — avoids ambiguous stacking from overlapping auras
  const buffedBy = new Map<string, string>()
  for (const { ownerId, allyIds } of sources) {
    for (const allyId of allyIds) {
      if (!buffedBy.has(allyId)) buffedBy.set(allyId, ownerId)
    }
  }
  const focusCount = new Map<string, number>()
  for (const { ownerId, allyIds } of sources) focusCount.set(ownerId, allyIds.size)

  let changed = false
  const updated = participants.map((p) => {
    const originalEffects: any[] = p.activeEffects || []
    let effects = originalEffects

    const ownerId = buffedBy.get(p.id)
    effects = ownerId
      ? applyAura(effects, AURA_NAME, ownerId, 1, "+2 Accuracy from an ally's [Guiding Light]", houseRules)
      : removeAura(effects, AURA_NAME)

    const count = focusCount.get(p.id) ?? 0
    effects = count > 0
      ? applyAura(effects, FOCUS_NAME, p.id, count, `+1 Dodge per ally in [Guiding Light] radius (${count} allies)`, houseRules)
      : removeAura(effects, FOCUS_NAME)

    // Still run cleanup when no Digimon remain, so old effects cannot linger on Tamers.
    if (effects === originalEffects) return p
    changed = true
    return { ...p, activeEffects: effects }
  })

  return changed ? { participants: updated, changed } : { participants, changed: false }
}

// Refresh an action's own participant array before its caller persists it. Re-reading and
// writing participants independently here could overwrite wounds or a form change in flight.
export async function refreshGuidingLightForParticipants(
  encounterId: string | undefined,
  participants: any[],
  positions?: Record<string, Vec3>,
): Promise<any[]> {
  const context = await loadEncounterCombatContext(encounterId)
  if (!context) return participants

  const result = await applyGuidingLightAuras(
    participants, positions ?? await getRoomPositions(context.encounter.id), context.campaignLevel, context.houseRules,
  )
  return result.participants
}

async function recomputeGuidingLightForEncounterOnce(encounterId: string): Promise<boolean> {
  const context = await loadEncounterCombatContext(encounterId)
  if (!context) return false
  const { encounter, campaignLevel, houseRules } = context

  const positions = await getRoomPositions(encounterId)
  const { participants, changed } = await applyGuidingLightAuras(
    (encounter.participants as any[]) ?? [],
    positions,
    campaignLevel,
    houseRules
  )
  if (!changed) return false

  await db.update(encounters).set({ participants, updatedAt: new Date() }).where(eq(encounters.id, encounterId))

  const payload = await buildEncounterPayload(encounterId)
  if (payload) {
    broadcast(encounterId, { type: 'encounter-state', encounterId, encounter: payload, version: Date.now() })
  }
  return true
}

// Per-encounter serialization: each recompute does an independent read-modify-write of
// `encounters.participants` across several sequential DB round-trips (encounter + campaign +
// per-participant digimon/tamer/derived-stats lookups + persist + payload rebuild). Fired
// back-to-back — e.g. a drag crossing several grid cells sends `unit-moved` repeatedly before
// the first recompute's write lands — two overlapping calls can finish out of order and the
// slower one's write clobbers the faster/more-recent one's result, leaving the aura stuck wrong
// until another move happens to trigger a fresh recompute (reproduced live: rapid moves left a
// stale aura state that never self-corrected). Coalesce instead of racing: while one recompute
// is in flight for an encounter, a new request doesn't start its own — it marks "run once more
// after this one" and shares the in-flight promise, so every caller still resolves once the
// data is current, and a burst of N requests costs at most 2 passes instead of N racing ones.
const inFlight = new Map<string, Promise<boolean>>()
const pendingRerun = new Set<string>()

export function recomputeGuidingLightForEncounter(encounterId: string): Promise<boolean> {
  const existing = inFlight.get(encounterId)
  if (existing) {
    pendingRerun.add(encounterId)
    return existing
  }

  const run = (async (): Promise<boolean> => {
    let result = false
    try {
      result = await recomputeGuidingLightForEncounterOnce(encounterId)
    } finally {
      inFlight.delete(encounterId)
    }
    if (pendingRerun.delete(encounterId)) {
      result = (await recomputeGuidingLightForEncounter(encounterId)) || result
    }
    return result
  })()

  inFlight.set(encounterId, run)
  return run
}
