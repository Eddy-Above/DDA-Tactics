import { db, tamers, type NewTamer } from '../../db'
import { generateId } from '../../utils/id'
import { parseTamerData } from '../../utils/parsers'

interface CreateTamerBody {
  name: string
  age: number
  campaignId?: string
  attributes: {
    agility: number
    body: number
    charisma: number
    intelligence: number
    willpower: number
  }
  skills: {
    dodge: number
    fight: number
    stealth: number
    athletics: number
    endurance: number
    featsOfStrength: number
    manipulate: number
    perform: number
    persuasion: number
    computer: number
    survival: number
    knowledge: number
    perception: number
    decipherIntent: number
    bravery: number
  }
  aspects?: Array<{
    id: string
    name: string
    description: string
    type: 'major' | 'minor'
    usesRemaining: number
  }>
  torments?: Array<{
    id: string
    name: string
    description: string
    severity: 'minor' | 'major' | 'terrible'
    totalBoxes: number
    markedBoxes: number
  }>
  xpBonuses?: {
    attributes: Record<string, number>
    skills: Record<string, number>
    inspiration: number
  }
  notes?: string
  spriteUrl?: string
  xp?: number
  inspiration?: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateTamerBody>(event)

  console.log('[POST /api/tamers] Received body:', {
    name: body.name,
    attributes: body.attributes,
    skills: body.skills ? Object.keys(body.skills).length : 'missing' },
  )

  // Validate required fields
  if (!body.name || !body.age || !body.attributes || !body.skills) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: name, age, attributes, skills',
    })
  }

  const id = generateId()
  const now = new Date()

  // Ensure JSON fields are properly structured
  const attributes = body.attributes || { agility: 0, body: 0, charisma: 0, intelligence: 0, willpower: 0 }
  const skills = body.skills || {
    dodge: 0, fight: 0, stealth: 0, athletics: 0, endurance: 0, featsOfStrength: 0,
    manipulate: 0, perform: 0, persuasion: 0, computer: 0, survival: 0, knowledge: 0,
    perception: 0, decipherIntent: 0, bravery: 0,
  }
  const xpBonuses = body.xpBonuses || {
    attributes: { agility: 0, body: 0, charisma: 0, intelligence: 0, willpower: 0 },
    skills: {
      dodge: 0, fight: 0, stealth: 0, athletics: 0, endurance: 0, featsOfStrength: 0,
      manipulate: 0, perform: 0, persuasion: 0, computer: 0, survival: 0, knowledge: 0,
      perception: 0, decipherIntent: 0, bravery: 0,
    },
    inspiration: 0,
  }

  // For Drizzle with PostgreSQL text + JSON mode, we might need to handle serialization explicitly
  const newTamer: any = {
    id,
    name: body.name,
    age: body.age,
    campaignId: body.campaignId || null,
    attributes: JSON.stringify(attributes),
    skills: JSON.stringify(skills),
    aspects: JSON.stringify(body.aspects || []),
    torments: JSON.stringify(body.torments || []),
    specialOrders: JSON.stringify([]),
    inspiration: body.inspiration ?? 1,
    xp: body.xp ?? 0,
    equipment: JSON.stringify([]),
    currentWounds: 0,
    notes: body.notes || '',
    spriteUrl: body.spriteUrl,
    xpBonuses: JSON.stringify(xpBonuses),
    createdAt: now,
    updatedAt: now,
  }

  console.log('[POST /api/tamers] Inserting tamer:', {
    id: newTamer.id,
    name: newTamer.name,
    attributes: newTamer.attributes,
  })

  await db.insert(tamers).values(newTamer)

  console.log('[POST /api/tamers] Successfully inserted tamer')

  // Parse the stringified values back to objects for the response
  const response = {
    ...newTamer,
    attributes: attributes,
    skills: skills,
    aspects: body.aspects || [],
    torments: body.torments || [],
    specialOrders: [],
    equipment: [],
    xpBonuses: xpBonuses,
  }

  return response
})
