import { db, tamers, type NewTamer } from '../../db'
import { generateId } from '../../utils/id'

interface CreateTamerBody {
  name: string
  age: number
  campaignLevel: 'standard' | 'enhanced' | 'extreme'
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
  notes?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateTamerBody>(event)

  // Validate required fields
  if (!body.name || !body.age || !body.campaignLevel || !body.attributes || !body.skills) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: name, age, campaignLevel, attributes, skills',
    })
  }

  const id = generateId()
  const now = new Date()

  const newTamer: NewTamer = {
    id,
    name: body.name,
    age: body.age,
    campaignLevel: body.campaignLevel,
    attributes: body.attributes,
    skills: body.skills,
    aspects: body.aspects || [],
    torments: body.torments || [],
    specialOrders: [],
    inspiration: 1,
    xp: 0,
    equipment: [],
    currentWounds: 0,
    notes: body.notes || '',
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(tamers).values(newTamer)

  return newTamer
})
