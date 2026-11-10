import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, tamers, digimon, maps, type Campaign } from '../db'
import { getSessionUser } from './session'
import { assertCanControlTamer, requireCampaignDm, requireCampaignMember, resolveCampaignAccess, type CampaignAccess } from './campaignSecurity'
import { withDatabase } from './databaseScope'
import { createEntityScopeResolver } from './entityScopeGraph'

export type EntityKind = 'tamer' | 'digimon' | 'map' | 'evolution-line'
export async function entityWrite<T>(work: () => Promise<T>): Promise<T> {
  const callbacks: Array<() => void | Promise<void>> = []
  const result = await db.transaction(tx => withDatabase(tx, work, callbacks))
  for (const callback of callbacks) await callback()
  return result
}
export async function entityCampaignId(kind: EntityKind, record: any): Promise<string | null> {
  return createEntityScopeResolver([record], kind)(kind, record)
}
export async function requireEntityAccess(event: H3Event, kind: EntityKind, record: any, write = false,
  resolveScope = createEntityScopeResolver([record], kind)): Promise<CampaignAccess | null> {
  const scope = await resolveScope(kind, record)
  if (scope) {
    const access = await requireCampaignMember(event, scope)
    if (!write) return access
    if (access.isDm) return access
    if (kind === 'tamer') { await assertCanControlTamer(event, record.id, access); return access }
    if ((kind === 'digimon' && !record.isEnemy || kind === 'evolution-line') && record.partnerId) { await assertCanControlTamer(event, record.partnerId, access); return access }
    return requireCampaignDm(event, scope)
  }
  if (kind === 'map') {
    if (write) throw createError({ statusCode: 403, message: 'Legacy standalone maps are read-only' })
    return null
  }
  const user = await getSessionUser(event)
  if ((kind === 'tamer' || kind === 'digimon') && record.ownerId && (write || record.hidden) && user?.id !== record.ownerId) throw createError({ statusCode: write ? 403 : 404, message: write ? 'You do not own this character' : 'Character not found' })
  if (kind === 'evolution-line') {
    if (record.partnerId) {
      const [partner] = await db.select().from(tamers).where(eq(tamers.id, record.partnerId))
      if (!partner || partner.campaignId) throw createError({ statusCode: 400, message: 'Invalid standalone evolution line partner' })
      await requireEntityAccess(event, 'tamer', partner, write, resolveScope)
    }
    for (const entry of record.chain ?? []) {
      const [form] = await db.select().from(digimon).where(eq(digimon.id, entry.digimonId))
      if (!form || form.campaignId) throw createError({ statusCode: 400, message: 'Invalid standalone evolution form' })
      await requireEntityAccess(event, 'digimon', form, write, resolveScope)
    }
  }
  return null
}
export async function filterReadableEntities(event: H3Event, rows: any[], kind: EntityKind) {
  const campaigns = new Map<string, boolean>()
  const resolveScope = createEntityScopeResolver(rows, kind)
  const result = []
  for (const row of rows) {
    const scope = await resolveScope(kind, row)
    if (scope) {
      if (!campaigns.has(scope)) campaigns.set(scope, (await resolveCampaignAccess(event, scope)).isMember)
      if (campaigns.get(scope)) result.push(row)
    } else {
      try { await requireEntityAccess(event, kind, row, false, resolveScope); result.push(row) } catch (error: any) { if (error.statusCode !== 404 && error.statusCode !== 403) throw error }
    }
  }
  return result
}
export async function requireLinkedEntity(event: H3Event, kind: 'tamer' | 'digimon' | 'map', id: string | null | undefined, campaignId: string | null, write = true) {
  if (!id) return null
  if (typeof id !== 'string') throw createError({ statusCode: 400, message: 'Invalid linked entity ID' })
  const table = kind === 'tamer' ? tamers : kind === 'digimon' ? digimon : maps
  const [record] = await db.select().from(table).where(eq(table.id, id))
  if (!record || await entityCampaignId(kind, record) !== (campaignId ?? null)) throw createError({ statusCode: 400, message: 'Linked entity belongs to a different campaign' })
  await requireEntityAccess(event, kind, record, write)
  return record
}
