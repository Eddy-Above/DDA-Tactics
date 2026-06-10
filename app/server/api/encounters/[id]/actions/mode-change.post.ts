import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'

type SwappableStat = 'accuracy' | 'damage' | 'dodge' | 'armor'
type StatSwaps = Partial<Record<SwappableStat, SwappableStat>>

interface ModeChangeBody {
  participantId: string
  newSwaps: StatSwaps
}

const SWAPPABLE = new Set<string>(['accuracy', 'damage', 'dodge', 'armor'])

function isValidSinglePairSwap(swaps: StatSwaps): boolean {
  const keys = Object.keys(swaps)
  if (keys.length !== 2) return false
  const [a, b] = keys as [SwappableStat, SwappableStat]
  return SWAPPABLE.has(a) && SWAPPABLE.has(b) && swaps[a] === b && swaps[b] === a
}

function isValidFreeSwap(swaps: StatSwaps): boolean {
  const entries = Object.entries(swaps)
  if (entries.length === 0) return true
  for (const [k, v] of entries) {
    if (!SWAPPABLE.has(k) || !v || !SWAPPABLE.has(v) || k === v) return false
  }
  const values = Object.values(swaps)
  return new Set(values).size === values.length
}

function swapsAreEqual(a: StatSwaps, b: StatSwaps): boolean {
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  if (ak.join(',') !== bk.join(',')) return false
  return ak.every(k => a[k as SwappableStat] === b[k as SwappableStat])
}

const SWAP_DAMAGE_ARMOR: StatSwaps = { damage: 'armor', armor: 'damage' }
const SWAP_ACCURACY_DODGE: StatSwaps = { accuracy: 'dodge', dodge: 'accuracy' }

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<ModeChangeBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }
  if (!body.participantId || body.newSwaps === undefined) {
    throw createError({ statusCode: 400, message: 'participantId and newSwaps are required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: `Encounter ${encounterId} not found` })
  }

  const participants = encounter.participants
  const turnOrder = encounter.turnOrder
  const battleLog = encounter.battleLog

  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }
  if (actor.type !== 'digimon') {
    throw createError({ statusCode: 403, message: 'Only digimon can use Mode Change' })
  }

  const currentIndex = encounter.currentTurnIndex || 0
  if (actor.id !== turnOrder[currentIndex]) {
    throw createError({ statusCode: 403, message: 'It is not this participant\'s turn' })
  }

  if ((actor.actionsRemaining?.simple || 0) < 1) {
    throw createError({ statusCode: 403, message: 'Not enough Simple Actions remaining' })
  }

  const [digimonEntity] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
  if (!digimonEntity) {
    throw createError({ statusCode: 404, message: 'Digimon not found' })
  }

  const qualities: any[] = digimonEntity.qualities ?? []

  const mcQuality = qualities.find((q: any) => q.id === 'mode-change')
  if (!mcQuality) {
    throw createError({ statusCode: 400, message: 'Digimon does not have Mode Change' })
  }
  const mcRank: number = mcQuality.ranks ?? 1

  const x0Quality = qualities.find((q: any) => q.id === 'mode-change-x0')
  const x0Rank: number = x0Quality ? (x0Quality.ranks ?? 1) : 0

  const newSwaps = body.newSwaps as StatSwaps

  // Validate newSwaps against quality rank
  if (x0Rank >= 2) {
    if (!isValidFreeSwap(newSwaps)) {
      throw createError({ statusCode: 400, message: 'Invalid swap configuration for Mode Change X.0 Rank 2' })
    }
  } else if (x0Rank === 1) {
    if (Object.keys(newSwaps).length > 0 && !isValidSinglePairSwap(newSwaps)) {
      throw createError({ statusCode: 400, message: 'Mode Change X.0 Rank 1 requires a single mutual pair swap' })
    }
  } else if (mcRank >= 2) {
    // Standard Mode Change Rank 2: either pair or both, or clear
    const isDamageArmor = swapsAreEqual(newSwaps, SWAP_DAMAGE_ARMOR)
    const isAccuracyDodge = swapsAreEqual(newSwaps, SWAP_ACCURACY_DODGE)
    const isBoth = swapsAreEqual(newSwaps, { ...SWAP_DAMAGE_ARMOR, ...SWAP_ACCURACY_DODGE })
    const isEmpty = Object.keys(newSwaps).length === 0
    if (!isEmpty && !isDamageArmor && !isAccuracyDodge && !isBoth) {
      throw createError({ statusCode: 400, message: 'Mode Change Rank 2 only allows Damage↔Armor or Accuracy↔Dodge swaps' })
    }
  } else {
    // Standard Mode Change Rank 1: only Damage↔Armor or clear
    const isDamageArmor = swapsAreEqual(newSwaps, SWAP_DAMAGE_ARMOR)
    const isEmpty = Object.keys(newSwaps).length === 0
    if (!isEmpty && !isDamageArmor) {
      throw createError({ statusCode: 400, message: 'Mode Change Rank 1 only allows Damage↔Armor swap' })
    }
  }

  // Build human-readable swap label for the battle log
  function swapLabel(swaps: StatSwaps): string {
    if (Object.keys(swaps).length === 0) return 'none'
    const seen = new Set<string>()
    const pairs: string[] = []
    for (const [k, v] of Object.entries(swaps)) {
      if (!seen.has(k) && !seen.has(v as string)) {
        pairs.push(`${capitalize(k)}↔${capitalize(v as string)}`)
        seen.add(k); seen.add(v as string)
      }
    }
    return pairs.join(', ')
  }
  function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

  const digimonName = digimonEntity.nickname || digimonEntity.name || 'Digimon'
  const label = swapLabel(newSwaps)

  const updatedParticipants = participants.map((p: any) => {
    if (p.id !== body.participantId) return p
    return {
      ...p,
      actionsRemaining: {
        ...p.actionsRemaining,
        simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1),
      },
      statSwaps: newSwaps,
    }
  })

  const logEntry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: actor.id,
    actorName: digimonName,
    action: 'Mode Change',
    target: null,
    result: `${digimonName} used Mode Change (active swaps: ${label})`,
    damage: null,
    effects: ['Mode Change'],
  }

  await db.update(encounters).set({
    participants: updatedParticipants,
    battleLog: [...battleLog, logEntry],
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return updated
})
