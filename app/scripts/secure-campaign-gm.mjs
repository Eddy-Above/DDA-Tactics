#!/usr/bin/env node
import { pbkdf2, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { Writable } from 'node:stream'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

const derive = promisify(pbkdf2)
const ITERATIONS = 220_000
export class OperatorInputError extends Error {}

export function parseOptions(args) {
  if (args.includes('--help')) return { help: true }
  let campaignId, apply = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--campaign-id' && args[i + 1] && !args[i + 1].startsWith('--')) campaignId = args[++i]
    else if (args[i] === '--apply') apply = true
    else throw new OperatorInputError('Use --campaign-id ID and optionally --apply. Run --help for instructions.')
  }
  if (!campaignId || campaignId.length > 128) throw new OperatorInputError('A campaign ID is required.')
  return { campaignId, apply }
}

export function explicitDatabaseUrl(environment) {
  if (environment.DDA_OFFLINE_VERIFY) throw new OperatorInputError('The operator utility cannot run in offline verification mode.')
  let parsed
  try { parsed = new URL(environment.DATABASE_URL ?? '') } catch { throw new OperatorInputError('Set DATABASE_URL explicitly. This utility never loads .env files.') }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new OperatorInputError('DATABASE_URL must identify the intended PostgreSQL database.')
  return environment.DATABASE_URL
}

export async function readPassword(input = process.stdin, output = process.stderr) {
  if (!input.isTTY) {
    input.setEncoding?.('utf8')
    let value = ''
    for await (const chunk of input) {
      value += chunk.toString()
      if (Buffer.byteLength(value) > 2048) throw new OperatorInputError('Password input is too long.')
    }
    return value.replace(/\r?\n$/, '')
  }
  // Readline puts the terminal into raw mode; its output is muted so the password is never echoed.
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const terminal = createInterface({ input, output: muted, terminal: true })
  try {
    output.write('New GM password: ')
    const password = await terminal.question('')
    output.write('\nConfirm GM password: ')
    const confirmation = await terminal.question('')
    output.write('\n')
    if (password !== confirmation) throw new OperatorInputError('Passwords did not match.')
    return password
  } finally { terminal.close() }
}

export async function secureCampaignGm(sql, options, passwordProvider = readPassword) {
  const [campaign] = await sql`SELECT id, name, owner_id, password_hash, dm_password_hash FROM campaigns WHERE id = ${options.campaignId}`
  if (!campaign) throw new OperatorInputError('Campaign not found.')
  if (campaign.owner_id) throw new OperatorInputError('This campaign has an owner. Use its authenticated Settings page.')
  if (campaign.dm_password_hash) throw new OperatorInputError('This campaign already has a GM password. This repair utility does not overwrite it.')
  const summary = { id: campaign.id, name: campaign.name, hasPlayerPassword: !!campaign.password_hash, hasGmPassword: false }
  if (!options.apply) return { ...summary, dryRun: true }
  const password = await passwordProvider()
  if (typeof password !== 'string' || password.length < 8 || password.length > 500) throw new OperatorInputError('Use a GM password between 8 and 500 characters.')
  const salt = randomBytes(16).toString('hex')
  const hash = await derive(password, salt, ITERATIONS, 64, 'sha512')
  const encoded = `pbkdf2-sha512$${ITERATIONS}$${salt}$${hash.toString('hex')}`
  const changed = await sql`UPDATE campaigns SET dm_password_hash = ${encoded}, updated_at = NOW() WHERE id = ${options.campaignId} AND owner_id IS NULL AND dm_password_hash IS NULL RETURNING id`
  if (changed.length !== 1) throw new OperatorInputError('The campaign changed during repair. No password was replaced.')
  return { ...summary, hasGmPassword: true, dryRun: false }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    console.log('Operator-only GM credential repair\n\nSet DATABASE_URL explicitly to the intended database; .env files are never loaded.\nDry run: node scripts/secure-campaign-gm.mjs --campaign-id ID\nApply:   node scripts/secure-campaign-gm.mjs --campaign-id ID --apply\n\nApply prompts without echoing the password, or reads one password from stdin when piped.\nOnly ownerless campaigns without a GM password can be changed. No credential is printed.')
    return
  }
  const databaseUrl = explicitDatabaseUrl(process.env)
  const { default: postgres } = await import('postgres')
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  try { console.log(JSON.stringify(await secureCampaignGm(sql, options))) }
  finally { await sql.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof OperatorInputError ? error.message : 'Repair failed. Check the explicit database connection and permissions; no database error details are displayed.')
    process.exitCode = 1
  })
}
