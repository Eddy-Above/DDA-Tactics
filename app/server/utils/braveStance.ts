import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import { clearHealedBraveStance } from '../../utils/combatStances'

/** Finalize healing inside the command transaction, including support attacks and GM health edits. */
export async function finishBraveStanceHealthChange<T>(id: string, previous: any, value: T): Promise<T> {
  const result = value as any
  const published = result?.id === id ? result : result?.encounter?.id === id ? result.encounter : null
  if (![...(previous.participants ?? []), ...(published?.participants ?? [])].some(p => p.currentStance === 'brave')) return value
  const encounter = published?.phase && Array.isArray(published.participants) ? published
    : (await db.select().from(encounters).where(eq(encounters.id, id)))[0]
  if (!encounter || encounter.phase !== 'combat') return value
  const participants = encounter.participants.map(clearHealedBraveStance)
  if (participants.every((p: any, index: number) => p === encounter.participants[index])) return value
  const [saved] = await db.update(encounters).set({ participants, updatedAt: new Date() }).where(eq(encounters.id, id)).returning()
  if (published) Object.assign(published, saved)
  return value
}
