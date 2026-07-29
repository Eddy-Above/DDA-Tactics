import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../db'
import { generateId } from '../../../utils/id'
import { getRoomSnapshot } from '../../../utils/encounterRoom'

interface DuplicateEncounterBody {
  name?: string
  // 'fresh'    — same cast, initiative, map and positions, but a clean slate to fight from
  // 'snapshot' — a verbatim save-state, including whose turn it is and everyone's wounds
  mode?: 'fresh' | 'snapshot'
}

// Fields a 'fresh' copy carries over: who is in the fight, the initiative they already
// rolled, and settings that aren't per-battle. Deliberately an allow-list rather than a
// list of things to clear — CombatParticipant accumulates per-combat flags constantly
// (boss qualities, Digizoid armour, clash bookkeeping…), and a new one must default to
// being reset, not silently leak into every fresh copy.
const FRESH_COPY_CARRY_OVER = [
  'id',
  'type',
  'entityId',
  'seq',
  'name',
  'initiative',
  'initiativeRoll',
  'maxWounds',
  'totalHealth',
  'evolutionLineId',
  'npcStageIndex',
  'isEnemy',
  'currentInspiration',
  'intercedeOptOuts',
  'gmCharacterOptOuts',
  'maxPostTurnIntercedes',
] as const

function resetParticipantForFreshCopy(p: any): any {
  const carried: any = {}
  for (const key of FRESH_COPY_CARRY_OVER) {
    if (p[key] !== undefined) carried[key] = p[key]
  }

  return {
    ...carried,
    actionsRemaining: { simple: 2 },
    currentStance: 'neutral',
    activeEffects: [],
    isActive: false,
    hasActed: false,
    currentWounds: 0,
  }
}

export default defineEventHandler(async (event) => {
  const sourceId = getRouterParam(event, 'id')
  const body = await readBody<DuplicateEncounterBody>(event) ?? {}
  const mode = body.mode === 'snapshot' ? 'snapshot' : 'fresh'

  if (!sourceId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  const [source] = await db.select().from(encounters).where(eq(encounters.id, sourceId))

  if (!source) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${sourceId} not found`,
    })
  }

  // Positions/destructibles come from the live room, not the DB row — the row is only a
  // 1500ms-debounced durability snapshot and can lag the tokens the GM is looking at.
  const room = await getRoomSnapshot(sourceId)

  const sourceParticipants = (source.participants as any[]) || []
  // Participant ids are kept verbatim so turnOrder, participantPositions keys and
  // clash.opponentParticipantId all stay valid with no remapping. They only need to be
  // unique within an encounter.
  const participants = mode === 'snapshot'
    ? structuredClone(sourceParticipants)
    : structuredClone(sourceParticipants).map(resetParticipantForFreshCopy)

  const now = new Date()
  const copy: any = {
    id: generateId(),
    name: body.name?.trim() || `${source.name} (Copy)`,
    description: source.description,
    campaignId: source.campaignId,
    mapId: source.mapId,

    participants,
    turnOrder: structuredClone((source.turnOrder as string[]) || []),
    hazards: structuredClone((source.hazards as any[]) || []),

    round: mode === 'snapshot' ? source.round : 0,
    phase: mode === 'snapshot' ? source.phase : 'setup',
    currentTurnIndex: mode === 'snapshot' ? (source.currentTurnIndex ?? 0) : 0,

    // A copy is a GM working area — it never inherits half-answered player prompts, and
    // stays hidden until the GM explicitly publishes it.
    battleLog: [],
    pendingRequests: [],
    requestResponses: [],
    visibleToPlayers: false,

    participantPositions: room.participantPositions,
    destructibleStates: room.destructibleStates,

    createdAt: now,
    updatedAt: now,
  }

  await db.insert(encounters).values(copy)

  return copy
})
