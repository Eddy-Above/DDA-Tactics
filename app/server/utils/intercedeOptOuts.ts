import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import {
  type EncounterIntercedeOptOuts,
  getTargetOptOuts,
  getGmCharacterOptOuts,
} from '~/utils/intercedeOptOuts'

// Read-modify-write of the encounter's opt-out column under a row lock, so two people saving
// at the same moment are applied one after the other instead of the later write discarding
// the earlier one. Nothing else writes this column, so no other endpoint can revert it.
async function updateLocked(
  encounterId: string,
  build: (row: { intercedeOptOuts: EncounterIntercedeOptOuts | null; participants: unknown }) => EncounterIntercedeOptOuts,
): Promise<EncounterIntercedeOptOuts> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ intercedeOptOuts: encounters.intercedeOptOuts, participants: encounters.participants })
      .from(encounters)
      .where(eq(encounters.id, encounterId))
      .for('update')
    if (!row) throw createError({ statusCode: 404, message: 'Encounter not found' })

    const next = build(row)
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
