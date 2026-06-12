import { count, ilike } from 'drizzle-orm'
import { db, campaigns } from '../../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize as string) || 20))
  const search = (query.search as string | undefined)?.trim()

  const whereClause = search ? ilike(campaigns.name, `%${search}%`) : undefined

  const [{ value: total }] = await db.select({ value: count() }).from(campaigns).where(whereClause)

  const rows = await db
    .select()
    .from(campaigns)
    .where(whereClause)
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    data: rows.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      level: c.level,
      hasPassword: !!c.passwordHash,
      hasDmPassword: !!c.dmPasswordHash,
      rulesSettings: c.rulesSettings,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    total: Number(total),
    page,
    pageSize,
    totalPages: Math.ceil(Number(total) / pageSize),
  }
})
