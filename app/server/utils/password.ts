import { randomBytes, pbkdf2, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(pbkdf2)
export const PASSWORD_ITERATIONS = 220_000
const KEY_LENGTH = 64
const DIGEST = 'sha512'

function parseHash(stored: string): { salt: string; hash: Buffer; iterations: number; legacy: boolean } | null {
  if (typeof stored !== 'string') return null
  const legacy = /^([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(stored)
  if (legacy) return { salt: legacy[1]!, hash: Buffer.from(legacy[2]!, 'hex'), iterations: 10_000, legacy: true }
  const current = /^pbkdf2-sha512\$(\d+)\$([a-f0-9]{32})\$([a-f0-9]{128})$/i.exec(stored)
  if (!current) return null
  const iterations = Number(current[1])
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 2_000_000) return null
  return { salt: current[2]!, hash: Buffer.from(current[3]!, 'hex'), iterations, legacy: false }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await derive(password, salt, PASSWORD_ITERATIONS, KEY_LENGTH, DIGEST)
  return `pbkdf2-sha512$${PASSWORD_ITERATIONS}$${salt}$${hash.toString('hex')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const stored = parseHash(storedHash)
  if (!stored || typeof password !== 'string') return false
  const actual = await derive(password, stored.salt, stored.iterations, KEY_LENGTH, DIGEST)
  return actual.length === stored.hash.length && timingSafeEqual(actual, stored.hash)
}

export function needsPasswordRehash(storedHash: string): boolean {
  const stored = parseHash(storedHash)
  return !stored || stored.legacy || stored.iterations < PASSWORD_ITERATIONS
}
