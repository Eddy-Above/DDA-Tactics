import { eq, and, isNull } from 'drizzle-orm'
import { db, digimon, tamers } from '../../db'

export default defineEventHandler(async (event) => {
  try {
    // Find all digimon with partnerId set but campaignId null
    const digimonToUpdate = await db
      .select({
        id: digimon.id,
        name: digimon.name,
        partnerId: digimon.partnerId,
      })
      .from(digimon)
      .where(and(
        isNull(digimon.campaignId),
        // partnerId is not null (check that it exists)
        eq(digimon.partnerId, digimon.partnerId) // This ensures partnerId exists
      ))

    if (digimonToUpdate.length === 0) {
      return { message: 'No digimon with null campaignId found', updated: 0 }
    }

    let updated = 0

    // For each digimon, find the partner tamer and set campaignId
    for (const d of digimonToUpdate) {
      if (!d.partnerId) continue

      const [tamer] = await db.select().from(tamers).where(eq(tamers.id, d.partnerId))

      if (tamer && tamer.campaignId) {
        await db
          .update(digimon)
          .set({ campaignId: tamer.campaignId, updatedAt: new Date() })
          .where(eq(digimon.id, d.id))

        updated++
        console.log(`[Backfill] Updated "${d.name}" (${d.id}) with campaignId from partner ${d.partnerId}`)
      }
    }

    return {
      message: `Successfully backfilled ${updated} digimon with campaign IDs from their partner tamers`,
      updated,
    }
  } catch (e) {
    console.error('[Backfill] Error:', e)
    throw createError({
      statusCode: 500,
      message: `Failed to backfill digimon campaigns: ${e instanceof Error ? e.message : String(e)}`,
    })
  }
})
