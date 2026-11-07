import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import {
  type EncounterIntercedeOptOuts,
  type TemporaryIntercedePass,
  GM_OPT_OUT_OWNER,
  findPassSlot,
  getActiveTemporaryPasses,
  getTargetOptOuts,
  getGmCharacterOptOuts,
} from '~/utils/intercedeOptOuts'

interface LockedRow {
  intercedeOptOuts: EncounterIntercedeOptOuts | null
  participants: unknown
  phase: string
}

// Read-modify-write of the encounter's opt-out column under a row lock, so two people saving
// at the same moment are applied one after the other instead of the later write discarding
// the earlier one. Nothing else writes this column, so no other endpoint can revert it.
// `build` returns the value to store, or null to leave the column (and `updatedAt`) untouched.
async function updateLocked(
  encounterId: string,
  build: (row: LockedRow) => EncounterIntercedeOptOuts | null,
): Promise<EncounterIntercedeOptOuts | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ intercedeOptOuts: encounters.intercedeOptOuts, participants: encounters.participants, phase: encounters.phase })
      .from(encounters)
      .where(eq(encounters.id, encounterId))
      .for('update')
    if (!row) throw createError({ statusCode: 404, message: 'Encounter not found' })

    const next = build(row)
    if (next === null) return row.intercedeOptOuts
    await tx.update(encounters).set({ intercedeOptOuts: next, updatedAt: new Date() }).where(eq(encounters.id, encounterId))
    return next
  })
}

/**
 * Replaces one owner's (tamer entity id or 'GM') list of targets they never want to be asked
 * about. `update` receives the current list — legacy participant-level values included — and
 * returns the list to store. Returns the stored list.
 */
export async function updateTargetOptOuts(
  encounterId: string,
  ownerId: string,
  update: (current: string[]) => string[],
): Promise<string[]> {
  let list: string[] = []
  await updateLocked(encounterId, (row) => {
    const stored = row.intercedeOptOuts || {}
    list = [...new Set(update(getTargetOptOuts(row, ownerId)))]
    return { ...stored, targets: { ...(stored.targets || {}), [ownerId]: list } }
  })
  return list
}

/** Replaces the GM's list of characters that should never intercede for one target. */
export async function updateGmCharacterOptOuts(
  encounterId: string,
  targetId: string,
  characterIds: string[],
): Promise<void> {
  await updateLocked(encounterId, (row) => {
    const stored = row.intercedeOptOuts || {}
    return { ...stored, gmCharacters: { ...getGmCharacterOptOuts(row), [targetId]: [...new Set(characterIds)] } }
  })
}

/**
 * Starts "Pass until my next turn" for a player: records the turn counter of their Tamer
 * participant, which any later turn start of that participant moves past. Expired passes are
 * dropped on the way. Permanent opt-outs (`targets`, `gmCharacters`) are carried over untouched.
 */
export async function setTemporaryPass(encounterId: string, ownerId: string): Promise<TemporaryIntercedePass> {
  let pass!: TemporaryIntercedePass
  await updateLocked(encounterId, (row) => {
    if (ownerId === GM_OPT_OUT_OWNER) {
      throw createError({ statusCode: 400, message: 'Passing is only available to players' })
    }
    if (row.phase !== 'combat') {
      throw createError({ statusCode: 409, message: 'Passing is only available while combat is running' })
    }
    const slot = findPassSlot(row.participants, ownerId)
    if (!slot) {
      throw createError({ statusCode: 404, message: `Tamer '${ownerId}' is not in this encounter's turn order` })
    }
    const stored = row.intercedeOptOuts || {}
    pass = { characterId: slot.id, turnsStarted: slot.turnsStarted ?? 0, createdAt: new Date().toISOString() }
    return { ...stored, temporaryPasses: { ...getActiveTemporaryPasses(row), [ownerId]: pass } }
  })
  return pass
}

/** Ends one player's pass ("Resume prompting"). Nothing else about their preferences changes. */
export async function clearTemporaryPass(encounterId: string, ownerId: string): Promise<void> {
  await updateLocked(encounterId, (row) => {
    const stored = row.intercedeOptOuts || {}
    if (!stored.temporaryPasses?.[ownerId]) return null
    const { [ownerId]: _ended, ...remaining } = stored.temporaryPasses
    return { ...stored, temporaryPasses: remaining }
  })
}

/** Drops every pass (combat ended). Permanent opt-outs stay. */
export async function clearTemporaryPasses(encounterId: string): Promise<void> {
  await updateLocked(encounterId, (row) => {
    const stored = row.intercedeOptOuts || {}
    if (!stored.temporaryPasses || Object.keys(stored.temporaryPasses).length === 0) return null
    const { temporaryPasses: _ended, ...rest } = stored
    return rest
  })
}
