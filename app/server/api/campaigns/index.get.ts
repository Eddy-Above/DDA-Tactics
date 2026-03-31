import { db, campaigns } from '../../db'

export default defineEventHandler(async () => {
  const allCampaigns = await db.select().from(campaigns)
  return allCampaigns.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    level: c.level,
    hasPassword: !!c.passwordHash,
    hasDmPassword: !!c.dmPasswordHash,
    rulesSettings: typeof c.rulesSettings === 'string' ? JSON.parse(c.rulesSettings) : (c.rulesSettings || {}),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }))
})
