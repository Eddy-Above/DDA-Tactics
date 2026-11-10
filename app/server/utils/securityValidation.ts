import { getTableColumns } from 'drizzle-orm'

export function objectBody(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError({ statusCode: 400, message: 'Expected an object body' })
  return value as Record<string, any>
}
export function allowFields(value: unknown, allowed: readonly string[]): Record<string, any> {
  const body = objectBody(value)
  for (const field of Object.keys(body)) if (!allowed.includes(field)) throw createError({ statusCode: 400, message: `Field '${field}' cannot be changed here` })
  return Object.fromEntries(Object.entries(body).filter(([field]) => allowed.includes(field)))
}
export function finiteNumber(value: unknown, name = 'number', options: { integer?: boolean; min?: number; max?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || options.integer && !Number.isSafeInteger(value)
    || options.min !== undefined && value < options.min || options.max !== undefined && value > options.max) throw createError({ statusCode: 400, message: `Invalid ${name}` })
  return value
}
export function boundedString(value: unknown, name = 'string', max = 10000, empty = true): string {
  if (typeof value !== 'string' || value.length > max || !empty && !value.trim()) throw createError({ statusCode: 400, message: `Invalid ${name}` })
  return value
}
export function safeUrl(value: unknown, name = 'image URL'): string | null {
  if (value === null || value === '') return value === '' ? '' : null
  const text = boundedString(value, name, 2048)
  let url: URL
  try { url = new URL(text) } catch { throw createError({ statusCode: 400, message: `Invalid ${name}` }) }
  if (url.protocol !== 'https:' || url.username || url.password) throw createError({ statusCode: 400, message: `${name} must use HTTPS` })
  return text
}
export function validPosition(value: unknown) {
  const body = allowFields(value, ['x', 'y', 'z'])
  return { x: finiteNumber(body.x, 'x', { integer: true }), y: finiteNumber(body.y, 'y', { integer: true }), z: finiteNumber(body.z, 'z', { integer: true }) }
}
function validateJson(value: any, depth = 0): void {
  if (depth > 30) throw createError({ statusCode: 400, message: 'JSON nesting is too deep' })
  if (typeof value === 'number') finiteNumber(value)
  else if (typeof value === 'string') boundedString(value, 'text', 100000)
  else if (Array.isArray(value)) value.forEach(item => validateJson(item, depth + 1))
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw createError({ statusCode: 400, message: 'Invalid object key' })
    validateJson(item, depth + 1)
  }
}
/** Runtime projection: TypeScript Partial/Pick do not constrain an HTTP request. */
export function tableWriteBody<T extends Record<string, any>>(bodyValue: unknown, table: any, existing?: T, extras: string[] = [], protectedFields: string[] = []): Record<string, any> {
  const body = objectBody(bodyValue)
  const columns = getTableColumns(table) as Record<string, any>
  const blocked = new Set(['id', 'createdAt', 'updatedAt', 'ownerId', 'campaignId', ...protectedFields])
  const result: Record<string, any> = {}
  for (const [field, value] of Object.entries(body)) {
    if (extras.includes(field)) { validateJson(value); result[field] = value; continue }
    const column = Object.prototype.hasOwnProperty.call(columns, field) ? columns[field] : undefined
    if (!column) throw createError({ statusCode: 400, message: `Unknown field '${field}'` })
    if (!existing && ['id', 'ownerId', 'createdAt', 'updatedAt', ...protectedFields].includes(field)) throw createError({ statusCode: 400, message: `Field '${field}' is server-owned` })
    if (blocked.has(field) && existing) {
      if (JSON.stringify(value) !== JSON.stringify(existing[field])) throw createError({ statusCode: 400, message: `Field '${field}' is immutable` })
      continue
    }
    if (value === null) {
      if (column.notNull) throw createError({ statusCode: 400, message: `Field '${field}' cannot be null` })
    } else if (column.dataType === 'number') finiteNumber(value, field, { integer: !column.columnType?.includes('Double') })
    else if (column.dataType === 'boolean' && typeof value !== 'boolean') throw createError({ statusCode: 400, message: `Invalid ${field}` })
    else if (column.dataType === 'string') boundedString(value, field, 100000)
    else validateJson(value)
    if ((field === 'spriteUrl' || field === 'imageUrl') && value != null && (!existing || value !== existing[field])) safeUrl(value, field)
    result[field] = value
  }
  return result
}
