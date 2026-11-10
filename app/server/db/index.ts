import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { scopedDatabase } from '../utils/databaseScope'

// Load environment variables from .env.local
config({ path: '.env.local' })

// Get database URL from environment
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Create Postgres connection
const client = postgres(databaseUrl)

// Create Drizzle instance with schema
const database = drizzle(client, { schema })
export const db = new Proxy(database, {
    get(target, property) {
      const transaction = scopedDatabase()
      if (!transaction && process.env['DDA_OFFLINE_VERIFY'] === '1') {
      throw new Error(`Unexpected database access during offline verification (${String(property)}). Mock the database explicitly.`)
      }
      const owner = transaction ?? target
      const value = Reflect.get(owner, property, owner)
      return typeof value === 'function' ? value.bind(owner) : value
    },
  })

// Export schema for use in other files
export * from './schema'
