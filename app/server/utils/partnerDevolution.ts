import { eq } from 'drizzle-orm'
import { db, digimon, evolutionLines, type Digimon, type EvolutionLine, type Encounter } from '../db'
import { STAGE_CONFIG, type DigimonStage } from '../../types'
import type { CombatParticipant, StoredCombatParticipant } from '../../types/combat'
import { getCombatEvolutionParent, resolveCombatEvolutionIndex } from '../../utils/combatEvolutionOptions'
import { readCombatRecord, withCombatRecords } from './combatRecordCache'
import { getDigizoidArmorBonus } from './digizoidArmor'
import { resolveParticipantName } from './participantName'

export type CombatDevolutionState = NonNullable<CombatParticipant['woundsHistory']>[number]
type DevolvingParticipant = Pick<CombatParticipant, 'type' | 'entityId' | 'evolutionLineId' | 'woundsHistory' | 'isEnemy'>
type DevolutionRecord = Pick<Digimon, 'id' | 'baseStats' | 'bonusStats' | 'stage' | 'qualities' | 'currentWounds'>

/** A sheet's wounds and wound totals, using the same health calculation as combat digivolution. */
export function buildCombatDevolutionState(
  record: DevolutionRecord,
  stageIndex: number,
  fallbackStage?: DigimonStage,
): CombatDevolutionState {
  const stage = (record.stage || fallbackStage) as DigimonStage
  const totalHealth = (record.baseStats?.health || 0) + (record.bonusStats?.health || 0)
    + getDigizoidArmorBonus(record.qualities || []).health
  return {
    stageIndex,
    entityId: record.id,
    maxWounds: totalHealth + (STAGE_CONFIG[stage]?.woundBonus || 0),
    totalHealth,
    wounds: record.currentWounds ?? 0,
  }
}

/** Resolve an earlier combat form without changing history, participants or character sheets. */
export async function resolveCombatDevolutionState(
  participant: DevolvingParticipant,
  database: Pick<typeof db, 'select'> = db,
): Promise<CombatDevolutionState | null> {
  if (Array.isArray(participant.woundsHistory) && participant.woundsHistory.length > 0) {
    const saved = participant.woundsHistory[participant.woundsHistory.length - 1]
    return saved ? { ...saved, wounds: saved.wounds ?? 0 } : null
  }

  // NPCs keep their existing history-only behavior. A real partner need not have its Tamer in
  // this encounter, or have digivolved during this combat, to return to its linked parent sheet.
  if (participant.type !== 'digimon' || participant.isEnemy || !participant.evolutionLineId) return null
  const current = await readCombatRecord('digimon', participant.entityId,
    () => database.select().from(digimon).where(eq(digimon.id, participant.entityId)))
  if (!current || current.isEnemy || typeof current.partnerId !== 'string' || !current.partnerId.trim()) return null

  const [line] = await database.select().from(evolutionLines).where(eq(evolutionLines.id, participant.evolutionLineId))
  if (!line) return null
  let chain: unknown = line.chain
  if (typeof chain === 'string') {
    try { chain = JSON.parse(chain) } catch { return null }
  }
  if (!Array.isArray(chain)) return null
  const entries = chain as EvolutionLine['chain']
  const currentIndex = resolveCombatEvolutionIndex(entries, participant.entityId, line.currentStageIndex)
  const parent = getCombatEvolutionParent(entries, currentIndex)
  if (typeof parent?.digimonId !== 'string' || !parent.digimonId.trim()) return null

  const previous = await readCombatRecord('digimon', parent.digimonId,
    () => database.select().from(digimon).where(eq(digimon.id, parent.digimonId)))
  return previous ? buildCombatDevolutionState(previous, parent.chainIndex, parent.stage) : null
}

type NamingParticipant = Pick<CombatParticipant, 'id' | 'type' | 'entityId' | 'seq' | 'isEnemy'>

/** Restore one knocked-out form; callers retain aura refreshes, turn handling and persistence. */
export async function autoDevolveParticipant(
  participant: StoredCombatParticipant,
  participants: readonly NamingParticipant[],
  { round, database = db }: { round: number; database?: Pick<typeof db, 'select' | 'update'> },
): Promise<Encounter['battleLog'][number] | null> {
  return withCombatRecords(async () => {
    if (participant.type !== 'digimon' || !participant.evolutionLineId
      || typeof participant.maxWounds !== 'number' || participant.maxWounds <= 0
      || typeof participant.currentWounds !== 'number' || !(participant.currentWounds >= participant.maxWounds)) return null

    const previousState = await resolveCombatDevolutionState(participant, database)
    if (!previousState) return null
    const oldDigimon = await readCombatRecord('digimon', participant.entityId,
      () => database.select().from(digimon).where(eq(digimon.id, participant.entityId)))
    const newDigimon = await readCombatRecord('digimon', previousState.entityId,
      () => database.select().from(digimon).where(eq(digimon.id, previousState.entityId)))
    const isPartner = typeof oldDigimon?.partnerId === 'string' && !!oldDigimon.partnerId.trim()
      && !oldDigimon.isEnemy && !participant.isEnemy
    const actorName = resolveParticipantName(participant, [...participants], oldDigimon?.name,
      oldDigimon?.isEnemy ?? false)
    const hasCombatMonster = (newDigimon?.qualities || []).some(q => q.id === 'combat-monster')
    const combatMonsterBonus = hasCombatMonster
      ? Math.min(participant.combatMonsterBonus ?? 0, previousState.totalHealth ?? previousState.maxWounds)
      : 0

    // Perform all reads and the partner's shared-line write before changing the supplied combat
    // state. A failed write must leave the form and its saved wound history available for a retry.
    if (isPartner) {
      await database.update(evolutionLines).set({
        currentStageIndex: previousState.stageIndex,
        updatedAt: new Date(),
      }).where(eq(evolutionLines.id, participant.evolutionLineId))
    }

    if (Array.isArray(participant.woundsHistory) && participant.woundsHistory.length > 0) {
      participant.woundsHistory = participant.woundsHistory.slice(0, -1)
    }
    participant.entityId = previousState.entityId
    participant.maxWounds = previousState.maxWounds
    participant.currentWounds = previousState.wounds ?? 0
    if (previousState.totalHealth !== undefined) participant.totalHealth = previousState.totalHealth
    participant.combatMonsterBonus = combatMonsterBonus
    if (isPartner) delete participant.npcStageIndex
    else participant.npcStageIndex = previousState.stageIndex

    return {
      id: `log-${Date.now()}-autodevolve-${participant.id}`,
      timestamp: new Date().toISOString(),
      round,
      actorId: participant.id,
      actorName,
      action: `was knocked out and devolved to ${newDigimon?.name || 'previous form'}!`,
      target: null,
      result: `Wounds restored to ${participant.currentWounds}`,
      damage: null,
      effects: ['Auto-Devolve'],
    }
  })
}
