<template>
  <div
    class="encounter-map-root"
    :style="bottomOverlayOffset != null ? { '--overlay-bottom': bottomOverlayOffset + 'px' } : undefined"
  >
    <!-- GM Toolbar (top) -->
    <MapToolbar
      v-if="isDm && map"
      :active-tool="editor.activeTool.value"
      :draw-mode="editor.drawMode.value"
      :element-brush="editor.elementBrush.value"
      :current-edit-y="editor.currentEditY.value"
      :can-undo="editor.canUndo.value"
      :can-redo="editor.canRedo.value"
      @select-tool="editor.selectTool"
      @set-draw-mode="v => editor.drawMode.value = v"
      @set-element="v => editor.elementBrush.value = v"
      @change-y="d => editor.currentEditY.value += d"
      @undo="onUndo"
      @redo="onRedo"
    />

    <!-- 3D Canvas (fills remaining space) -->
    <div class="canvas-wrapper">
      <ClientOnly>
        <MapCanvas
          v-if="map"
          :map="map"
          :participants="liveParticipants"
          :participant-positions="positions"
          :destructible-states="encounter.destructibleStates ?? []"
          :tamer-map="tamerMapForCanvas"
          :digimon-map="digimonMapForCanvas"
          :active-tool="editor.activeTool.value"
          :draw-mode="editor.drawMode.value"
          :current-edit-y="editor.currentEditY.value"
          :is-dm="isDm"
          :my-participant-ids="myParticipantIds"
          :active-participant-id="activeParticipantId"
          :secondary-active-participant-id="secondaryActiveParticipantId"
          :selected-attack="mapSelectedAttack"
          :selectable-participant-ids="selectableParticipantIds"
          :attacker-range="attackerStats.range"
          :attacker-effective-limit="attackerStats.effectiveLimit"
          :attacker-melee-range="attackerStats.meleeRange"
          :attacker-caps="attackerCaps"
          :reachable-cells="movement.reachableCells.value"
          :active-path="movement.activePath.value"
          :placing-participant-id="selectedId"
          :draggable-participant-ids="draggableParticipantIds"
          :external-drag-participant-id="hudDragId"
          :gm-move-participant-id="gmMoveParticipantId"
          :charge-mode="chargeMode"
          :charge-move-participant-id="chargeMoveParticipantId"
          :show-spawn-indicators="props.editorMode || (props.encounter.phase !== 'combat' && props.encounter.phase !== 'ended')"
          :eddy-soul-rules="eddySoulRules"
          :radial-options="radialOptions"
          @attack-selected="(id, attackId) => emit('attack-selected', id, attackId)"
          @stance-selected="(id, stance) => emit('stance-selected', id, stance)"
          @action-selected="(id, action, choiceId) => emit('action-selected', id, action, choiceId)"
          @unit-placed="onCanvasPlace"
          @unit-dragged="onUnitDragged"
          @unit-moved="onCombatMove"
          @cell-draw="onCellDraw"
          @wall-edit="onWallEdit"
          @wall-edit-at-edge="onWallEditAtEdge"
          @wall-place="onWallPlace"
          @voxel-edit="onVoxelEdit"
          @target-selected="onTargetSelected"
          @area-attack-confirmed="onAreaAttackConfirmed"
          @attack-cancelled="$emit('attack-cancelled')"
          @charge-target-selected="onChargeTargetSelected"
          :npc-move-participant-id="npcMoveParticipantId"
          @npc-action="onNpcAction"
          @player-action="(id, action) => { if (action === 'move') onNpcMove(id); else if (action === 'clash-move') onClashMove(id); else emit('player-action', id, action) }"
          @gm-move="onGmMoveStart"
          @gm-manage="(id) => emit('gm-manage', id)"
          @gm-moved="onGmMove"
          @cell-hovered="onCellHovered"
          @movement-cancelled="() => { npcMoveParticipantId = null; chargeMoveParticipantId = null; gmMoveParticipantId = null; movement.clearMovement() }"
          @wall-selected="onWallSelected"
          @door-toggle="(doorId, isOpen) => setDoorsOpen([doorId], isOpen)"
        />
        <div v-else class="no-map">
          <div class="no-map-msg">
            <span v-if="isDm">No map attached. Attach a map from the encounter settings.</span>
            <span v-else>The GM hasn't attached a map yet.</span>
          </div>
        </div>
      </ClientOnly>

      <!-- Overlay: Battle Log (right side) -->
      <div v-if="!editorMode" class="overlay overlay-right">
        <MapBattleLog
          :battle-log="encounter.battleLog"
          :is-dm="isDm"
          :npc-entity-ids="npcEntityIds"
          :battle-log-total="encounter._battleLogTotal"
          :battle-log-was-trimmed="encounter._battleLogWasTrimmed"
        />
      </div>

      <!-- Overlay: Player HUD (bottom-left). Also the placement control: while placement is active
           its cards are clicked to arm, or dragged onto the map. -->
      <div class="overlay overlay-bottom-left">
        <MapPlayerHUD
          :participants="liveParticipants"
          :tamer-map="tamerMapForCanvas"
          :digimon-map="digimonMapForCanvas"
          :is-dm="isDm"
          :my-tamer-id="myTamerId"
          :my-participant-ids="myParticipantIds"
          :placement-active="placementActive"
          :setup-placement="isSetupPlacement"
          :placeable-ids="placeableIds"
          :placed-ids="placedIds"
          :armed-id="selectedId"
          @select-placement="selectParticipant"
          @placement-drag-start="id => hudDragId = id"
          @placement-drag-end="hudDragId = null"
        />
      </div>

      <!-- Overlay: Combat controls slot (bottom-right) -->
      <div class="overlay overlay-bottom-right">
        <slot name="combat-controls" />
      </div>

      <!-- Overlay: Turn order slot (top-left) -->
      <div class="overlay overlay-top-left">
        <slot name="turn-order" />
      </div>

      <!-- GM Property Panel (right side when structure selected) -->
      <div v-if="isDm && selectedStructure" class="overlay overlay-property">
        <MapPropertyPanel
          :selected="selectedStructure"
          @close="selectedStructure = null"
          @save="onStructureSave"
        />
      </div>

      <!-- Floating charge attack picker (shown when a Charge Attack is selected) -->
      <div
        v-if="isChargeAttack && chargeMode === null && !chargeAttackInFlight"
        class="fixed z-50 bg-digimon-dark-800 border border-digimon-dark-600 rounded-xl p-4 shadow-xl"
        style="bottom: 120px; left: 50%; transform: translateX(-50%); min-width: 280px; max-width: 380px;"
      >
        <div class="text-sm text-digimon-dark-400 mb-3 text-center">Charge Attack</div>
        <div class="flex flex-col gap-2">
          <button
            class="px-3 py-2 rounded text-sm text-left bg-digimon-dark-700 text-digimon-dark-200 hover:bg-digimon-dark-600"
            @click="startChargeBefore"
          >Move Before Attack</button>
          <button
            class="px-3 py-2 rounded text-sm text-left bg-digimon-dark-700 text-digimon-dark-200 hover:bg-digimon-dark-600"
            @click="chargeMode = 'after'"
          >Move After Attack</button>
        </div>
        <button class="mt-3 w-full text-xs text-digimon-dark-500 hover:text-white" @click="$emit('attack-cancelled')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  GameMap, Encounter, Vec3, CombatParticipant, WallFace, DestructibleState, EddySoulRules, Stance,
} from '~/types'
import type { AreaShapeData } from '~/utils/areaShapes'
import type { MapAttackDescriptor } from '~/utils/mapAttackDescriptor'
import { getAreaShape, computePassLanding } from '~/utils/areaShapes'
import { useMap } from '~/composables/useMap'
import { useMapWebSocket } from '~/composables/useMapWebSocket'
import { useMapMovement, detectCapabilities, PROJECTILE_CAPS } from '~/composables/useMapMovement'
import { useMapEditor } from '~/composables/useMapEditor'
import { calculateDigimonDerivedStats, STAGE_CONFIG, type DigimonStage } from '~/types'
import { applyStanceToMovement } from '~/utils/stanceModifiers'
import { getAllStatEffectModifier, applyDerivedStatEffects } from '~/data/attackConstants'
import type { MovementCapabilities } from '~/utils/movementRules'
import { getFootprintDimensions, getFootprintCells } from '~/utils/movementRules'
import { chebyshev } from '~/utils/pathfinding'
import { dropRoute, getDraggableParticipantIds, getPlaceableParticipantIds, isSetupPhase } from '~/utils/placementRules'
import { closedDoorsCrossedByPath } from '~/utils/mapDoors'
import { segmentCells } from '~/utils/lineOfSight'
import type { MapRadialOptions, MapRadialChoiceAction } from '~/types/mapRadial'

type ClashRadialAction = 'clash-attack' | 'clash-pin' | 'clash-throw' | 'clash-end' | 'clash-check' | 'clash-move'

// ── Props ──────────────────────────────────────────────────────────────────
const props = defineProps<{
  encounter: Encounter & { participantPositions: Record<string, Vec3>; destructibleStates: DestructibleState[] }
  isDm: boolean
  myTamerId: string | null
  tamerMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number; partnerId?: string | null; speed?: number; body?: number }>
  digimonMap: Record<string, {
    name: string; spriteUrl?: string | null; currentWounds: number
    woundBoxes: number; size: any; stage: any; baseStats: any; qualities: any[]
    movement?: number
    giganticDimensions?: { width: number; height: number; depth: number } | null
    isEnemy?: boolean
    partnerId?: string | null
  }>
  selectedAttack: MapAttackDescriptor | null
  playerPlacementMode?: boolean
  myParticipantIds?: string[]
  editorMode?: boolean
  selectableParticipantIds?: string[]
  eddySoulRules?: EddySoulRules
  radialOptions?: Record<string, MapRadialOptions>
  bottomOverlayOffset?: number   // px from viewport bottom for bottom-anchored overlays; defaults to 10 via CSS fallback
}>()

const emit = defineEmits<{
  (e: 'target-selected', participantId: string): void
  (e: 'encounter-updated', partial: Partial<Encounter>): void
  (e: 'npc-action', participantId: string, action: 'stance' | 'attack' | 'clash' | ClashRadialAction): void
  (e: 'gm-manage', participantId: string): void
  (e: 'player-action', participantId: string, action: 'attack' | 'direct' | 'special-order' | 'stance' | 'digivolve' | 'mode-change' | 'clash' | ClashRadialAction): void
  (e: 'area-attack-confirmed', targetParticipantIds: string[], areaShapeData: AreaShapeData | null): void
  (e: 'attack-cancelled'): void
  (e: 'throw-landing-selected', controllerId: string, thrownTargetId: string, landingPos: Vec3): void
  (e: 'throw-ally-landing-selected', interceptorParticipantId: string, allyParticipantId: string, landingPos: Vec3): void
  (e: 'attack-selected', participantId: string, attackId: string): void
  (e: 'stance-selected', participantId: string, stance: Stance): void
  (e: 'action-selected', participantId: string, action: MapRadialChoiceAction, choiceId: string): void
  // Note: 'move' is handled internally in EncounterMap
}>()

// ── Map state ──────────────────────────────────────────────────────────────
const mapStore = useMap()
const map = ref<GameMap | null>(null)
const encounterId = computed(() => props.encounter.id)

onMounted(async () => {
  if (props.encounter.mapId) {
    map.value = await mapStore.fetchMap(props.encounter.mapId)
  }
})

watch(() => props.encounter.mapId, async (id) => {
  map.value = id ? await mapStore.fetchMap(id) : null
})

// ── Positions (local, authoritative within this component) ─────────────────
// participantPositions can arrive as a parsed object (GET endpoint) or as a raw JSON
// string (POST action responses spread the unparsed DB column, e.g. intercede-claim).
// Coerce to an object so a string never gets spread into garbage numeric keys, which
// would make every token's position lookup fail and the tokens vanish.
function toPositionsObj(v: any): Record<string, Vec3> {
  if (!v) return {}
  if (typeof v === 'string') { try { return JSON.parse(v) || {} } catch { return {} } }
  return { ...v }
}

const positions = ref<Record<string, Vec3>>(toPositionsObj(props.encounter.participantPositions))

// ── WebSocket ──────────────────────────────────────────────────────────────
const ws = useMapWebSocket(encounterId)

// Tracks the last position version applied from the server, so out-of-order
// or duplicate unit-moved/position-patch messages can't regress local state.
let lastAppliedVersion = 0

ws.onMessage((msg) => {
  if (msg.type === 'unit-moved') {
    if (msg.version <= lastAppliedVersion) return
    lastAppliedVersion = msg.version
    positions.value = { ...positions.value, [msg.participantId]: msg.position }
  } else if (msg.type === 'position-patch') {
    if (msg.version <= lastAppliedVersion) return
    lastAppliedVersion = msg.version
    positions.value = { ...positions.value, ...msg.patch }
  } else if (msg.type === 'map-edited' || msg.type === 'element-painted' || msg.type === 'door-toggled') {
    if (props.encounter.mapId) mapStore.fetchMap(props.encounter.mapId).then(m => { map.value = m })
  } else if (msg.type === 'full-state') {
    lastAppliedVersion = msg.version
    positions.value = toPositionsObj(msg.participantPositions)
  }
})

// ── Editor ─────────────────────────────────────────────────────────────────
const editor = useMapEditor(map)

// ── Movement ───────────────────────────────────────────────────────────────
const movement = useMapMovement()

// ── Auth/identity ──────────────────────────────────────────────────────────
// Everyone actually in the fight. Reserves are staged by the GM and have no business on the
// map — no token, no HUD row, no reticule — until they're deployed. (The occupancy and
// battle-log helpers below don't need filtering: they already skip participants with no
// position, and a reserve never has one.)
const liveParticipants = computed(() =>
  props.encounter.participants.filter(p => !(p as any).inReserve)
)

const myParticipantIds = computed(() =>
  props.myParticipantIds?.length
    ? props.myParticipantIds
    : liveParticipants.value
        .filter(p => p.type === 'tamer' && p.entityId === props.myTamerId)
        .map(p => p.id)
)

const activeParticipantId = computed(() =>
  props.encounter.turnOrder[props.encounter.currentTurnIndex] ?? null
)

// ── Partner of the active participant (tamer <-> partner digimon) ──────────
// Both members of a player's tamer/partner-digimon pair are highlighted
// together during that pair's combined turn.
const secondaryActiveParticipantId = computed(() => {
  const activeId = activeParticipantId.value
  if (!activeId) return null
  const participants = props.encounter.participants
  const active = participants.find(p => p.id === activeId)
  if (!active) return null

  if (active.type === 'tamer') {
    const partner = participants.find(p =>
      p.type === 'digimon' && props.digimonMap[p.entityId]?.partnerId === active.entityId
    )
    return partner?.id ?? null
  }

  if (active.type === 'digimon') {
    const partnerTamerId = props.digimonMap[active.entityId]?.partnerId
    if (!partnerTamerId) return null
    const tamerParticipant = participants.find(p => p.type === 'tamer' && p.entityId === partnerTamerId)
    return tamerParticipant?.id ?? null
  }

  return null
})

// ── NPC entity ID set (for battle log redaction) ───────────────────────────
const npcEntityIds = computed(() => {
  const ids = new Set<string>()
  for (const p of props.encounter.participants) {
    if (p.type !== 'digimon') continue
    if (props.digimonMap[p.entityId]?.isEnemy) ids.add(p.id)
  }
  return ids
})

// ── Attacker stats (for targeting UI) ──────────────────────────────────────
const attackerStats = computed(() => {
  // When a selected attack carries explicit limits from the attacking participant, use them directly
  if (props.selectedAttack?.effectiveLimit !== undefined) {
    return {
      range: props.selectedAttack.range === 'ranged' ? 1 : 0,
      effectiveLimit: props.selectedAttack.effectiveLimit,
      meleeRange: props.selectedAttack.meleeRange ?? 1,
    }
  }
  const participant = props.encounter.participants.find(p => p.id === activeParticipantId.value)
  if (!participant || participant.type !== 'digimon') return { range: 0, effectiveLimit: 0, meleeRange: 1 }
  const d = props.digimonMap[participant.entityId]
  if (!d) return { range: 0, effectiveLimit: 0, meleeRange: 1 }
  const derived = applyDerivedStatEffects(calculateDigimonDerivedStats(d.baseStats, d.stage, d.size), participant.activeEffects ?? [])
  const reachRanks = (d.qualities as any[]).find(q => q.id === 'reach')?.ranks ?? 0
  return {
    range: derived.range,
    effectiveLimit: derived.effectiveLimit,
    meleeRange: reachRanks > 0 ? reachRanks * 2 : 1,
  }
})

// Movement capabilities of the current attacker, for [Pass] landing validation in MapCanvas.
// Reuses npcMoveCaps so the Pass landing rule and the movement-range rule agree by construction
// (real stance-adjusted movement + stage bonus, so jumpRange/jumpHeight are correct).
const attackerCaps = computed<MovementCapabilities>(() => {
  const attackerId = props.selectedAttack?.attackerParticipantId ?? activeParticipantId.value
  return npcMoveCaps(attackerId ?? '')?.caps ?? detectCapabilities([], 0, 0, 0)
})

// ── Canvas-ready maps ───────────────────────────────────────────────────────
const tamerMapForCanvas = computed(() => {
  const out: Record<string, any> = {}
  for (const [id, t] of Object.entries(props.tamerMap)) out[id] = t
  return out
})

const digimonMapForCanvas = computed(() => {
  const out: Record<string, any> = {}
  for (const [id, d] of Object.entries(props.digimonMap)) out[id] = d
  return out
})

// ── Placement & movement state ──────────────────────────────────────────────
const selectedId = ref<string | null>(null)
const npcMoveParticipantId = ref<string | null>(null)
// GM free-move: the participant the GM is repositioning (free teleport, no action cost, any turn)
const gmMoveParticipantId = ref<string | null>(null)
const throwAimContext = ref<{ controllerId: string; thrownTargetId: string } | null>(null)
const throwAllyAimContext = ref<{ interceptorParticipantId: string; allyParticipantId: string } | null>(null)

// ── Charge Attack ────────────────────────────────────────────────────────────
const chargeMode = ref<'before' | 'after' | null>(null)
const chargeAfterAttackerId = ref<string | null>(null)
const chargeMoveParticipantId = ref<string | null>(null)
const chargeAttackInFlight = ref(false)

const isChargeAttack = computed(() => {
  if (!props.selectedAttack?.tags?.includes('Charge Attack')) return false
  return getAreaShape(props.selectedAttack.tags) !== 'pass'
})

const mapSelectedAttack = computed(() =>
  isChargeAttack.value && chargeMode.value === null && !chargeAttackInFlight.value ? null : props.selectedAttack
)

// During setup the whole roster is offered and a card can be clicked to pick a unit back up and
// re-place it. Once combat is underway that would silently yank a placed unit off the board
// (selectParticipant deletes its position), so only unplaced units are offered — repositioning
// a placed one is what GM free-move (and, for the GM, dragging) is for.
const isSetupPlacement = computed(() => isSetupPhase(props.encounter.phase))

// Who the HUD offers for placement. The rules live in utils/placementRules.ts so they can be
// tested without a canvas.
const placeableIds = computed(() => getPlaceableParticipantIds({
  participants: props.encounter.participants,
  positions: positions.value,
  isDm: props.isDm,
  phase: props.encounter.phase,
  myParticipantIds: props.myParticipantIds,
}))
const placedIds = computed(() => Object.keys(positions.value))

// The HUD is the placement control; this switches its cards into placement mode. The GM can
// place units at any point in a live encounter, not just during setup — reinforcements deployed
// from reserve (and anyone who joined mid-combat) need a way onto the board. Off once the
// encounter has ended.
const placementActive = computed(() =>
  !props.editorMode &&
  ((props.isDm && props.encounter.phase !== 'ended' && placeableIds.value.length > 0) ||
    (props.playerPlacementMode ?? false))
)

// Tokens already on the map that may be dragged elsewhere (GM: any live phase; player: own
// characters during setup only).
const draggableParticipantIds = computed(() =>
  props.editorMode
    ? []
    : getDraggableParticipantIds({
        participants: props.encounter.participants,
        positions: positions.value,
        isDm: props.isDm,
        phase: props.encounter.phase,
        myParticipantIds: props.myParticipantIds,
      })
)

// The HUD card currently being dragged. MapCanvas needs it during `dragover`, when the browser
// hides dataTransfer contents.
const hudDragId = ref<string | null>(null)

function selectParticipant(id: string) {
  if (selectedId.value === id) {
    selectedId.value = null
    return
  }
  // Pick up if already placed
  if (positions.value[id]) {
    const p = { ...positions.value }
    delete p[id]
    positions.value = p
  }
  selectedId.value = id
}

function onCanvasPlace(participantId: string, cell: Vec3) {
  positions.value = { ...positions.value, [participantId]: cell }
  selectedId.value = null
  ws.send({ type: 'unit-moved', encounterId: props.encounter.id, participantId, position: cell, path: [], version: 0 })
}

// A drag finished on a valid cell: either a token moved on the canvas or a HUD card dropped on it.
// MapCanvas already enforced the surface rules (players: spawn areas only; GM: anywhere), so this
// only decides how the drop is committed. One `unit-moved` goes out per drop — never per cell
// crossed — so the server's Guiding Light recompute isn't hammered by a long drag.
function onUnitDragged(participantId: string, cell: Vec3) {
  hudDragId.value = null
  // The drag was offered by state that may have moved on (phase change, unit removed mid-drag).
  if (!draggableParticipantIds.value.includes(participantId) && !placeableIds.value.includes(participantId)) return
  if (dropRoute(props.encounter.phase, !!positions.value[participantId]) === 'gm-move') onGmMove(participantId, cell)
  else onCanvasPlace(participantId, cell)
}

function onCombatMove(participantId: string, position: Vec3, path: Vec3[]) {
  if (throwAimContext.value && participantId === throwAimContext.value.thrownTargetId) {
    const { controllerId, thrownTargetId } = throwAimContext.value
    throwAimContext.value = null
    npcMoveParticipantId.value = null
    movement.clearMovement()
    emit('throw-landing-selected', controllerId, thrownTargetId, position)
    return
  }

  if (throwAllyAimContext.value && participantId === throwAllyAimContext.value.allyParticipantId) {
    const { interceptorParticipantId, allyParticipantId } = throwAllyAimContext.value
    throwAllyAimContext.value = null
    npcMoveParticipantId.value = null
    movement.clearMovement()
    emit('throw-ally-landing-selected', interceptorParticipantId, allyParticipantId, position)
    return
  }

  const movePath = movePathTo(participantId, position, path)
  const distance = moveDistance(participantId, position, movePath)
  positions.value = { ...positions.value, [participantId]: position }
  ws.send({ type: 'unit-moved', encounterId: props.encounter.id, participantId, position, path, version: 0 })
  openDoorsAlong(participantId, movePath)

  if (chargeMoveParticipantId.value === participantId) {
    chargeMoveParticipantId.value = null
    movement.clearMovement()
    postMove(participantId, distance, true)  // the Charge already paid for this move
    return
  }

  if (npcMoveParticipantId.value === participantId) {
    npcMoveParticipantId.value = null
    movement.clearMovement()
    postMove(participantId, distance, false)
  }
}

// Reports a combat move to the server: spends a simple action (unless the move is part of a
// Charge or Pass) and applies [Burn]'s movement damage. Resolves once saved, so a Charge or Pass
// can wait for it before its attack and the two server writes can't overwrite each other.
// `defeated`: Burn knocked the (enemy) mover out and it left the encounter.
type MoveResult = { success: boolean; defeated?: boolean } | void
function postMove(participantId: string, distance: number, noActionCost: boolean): Promise<MoveResult> {
  return $fetch<{ success: boolean; defeated?: boolean }>(`/api/encounters/${props.encounter.id}/actions/move`, {
    method: 'POST',
    body: { participantId, distance, ...(noActionCost ? { noActionCost: true } : {}) },
  }).catch((e: unknown) => console.error('move action failed', e))
}

// GM free-move: enter reposition mode for a participant (cancels any other move mode). The GM then
// aims at any height with a ghost and scroll wheel → onGmMove. No movement budget or capability check.
function onGmMoveStart(participantId: string) {
  gmMoveParticipantId.value = participantId
  npcMoveParticipantId.value = null
  chargeMoveParticipantId.value = null
  movement.clearMovement()
}

// GM free-move destination chosen: reposition the character with NO action cost (no /actions/move).
function onGmMove(participantId: string, position: Vec3) {
  positions.value = { ...positions.value, [participantId]: position }
  ws.send({ type: 'unit-moved', encounterId: props.encounter.id, participantId, position, path: [], version: 0 })
  gmMoveParticipantId.value = null
}

// ── Doors ──────────────────────────────────────────────────────────────────
// Door state lives on the map record, like in-encounter map edits: update it locally (MapCanvas
// rebuilds the scene and its line-of-sight model), save it, then tell other viewers to refetch.
async function setDoorsOpen(doorIds: string[], isOpen: boolean) {
  const mapId = props.encounter.mapId
  if (!map.value || !mapId || doorIds.length === 0) return
  const ids = new Set(doorIds)
  map.value.doors = map.value.doors.map(d => (ids.has(d.id) ? { ...d, isOpen } : d))
  try {
    await mapStore.updateMap(mapId, { doors: map.value.doors })
    for (const doorId of doorIds) ws.send({ type: 'door-toggled', encounterId: props.encounter.id, doorId, isOpen })
  } catch (e) {
    console.error('door toggle failed', e)
    const fresh = await mapStore.fetchMap(mapId)  // resync; null means the fetch failed too
    if (fresh) map.value = fresh
  }
}

// The mover's path to `destination` (for opening doors and measuring the move): the drawn path when
// it ends there, else one derived the way hover pathing does. Call before the mover's position is
// updated.
function movePathTo(participantId: string, destination: Vec3, drawn: Vec3[] = []): Vec3[] {
  if (drawn.length > 1 && sameVec3(drawn[drawn.length - 1], destination)) return drawn
  if (!map.value) return []
  const ctx = npcMoveCaps(participantId)
  if (!ctx) return []
  const shown = movement.activePath.value  // computePath also sets the drawn path; keep it as is
  const path = movement.computePath(ctx.pos, destination, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy, ctx.moverGig)
  movement.activePath.value = shown
  return path ?? []
}

// Cells moved: the path's steps (pathing is uniform-cost 26-neighbour), or the straight-line distance
// when no path could be derived. Call before the mover's position is updated.
function moveDistance(participantId: string, destination: Vec3, path: Vec3[]): number {
  if (path.length > 1) return path.length - 1
  const from = positions.value[participantId]
  return from ? chebyshev(from, destination) : 0
}

// Moving through a closed door opens it. `path` is the mover's anchor cells, start first.
function openDoorsAlong(participantId: string, path: Vec3[]) {
  if (!map.value || path.length < 2) return
  const p = props.encounter.participants.find(x => x.id === participantId)
  const dInfo = p?.type === 'digimon' ? (digimonMapForCanvas.value[p.entityId] as any) : null
  const dims = getFootprintDimensions(dInfo?.size ?? 'medium', dInfo?.giganticDimensions ?? null)
  const doorIds = closedDoorsCrossedByPath(map.value, path, dims, destroyedIds())
  if (doorIds.length) setDoorsOpen(doorIds, true)
}

function destroyedIds(): Set<string> {
  return new Set(
    (props.encounter.destructibleStates ?? [])
      .filter((s: any) => s.currentWounds <= 0)
      .map((s: any) => s.structureId as string)
  )
}

function npcMoveCaps(participantId: string) {
  const p = props.encounter.participants.find(x => x.id === participantId)
  if (!p) return null
  const pos = positions.value[participantId]
  if (!pos) return null
  const dInfo = p.type === 'digimon' ? digimonMapForCanvas.value[p.entityId] as any : undefined
  let budget: number
  let qualities: any[]
  if (p.type === 'tamer') {
    const tInfo = tamerMapForCanvas.value[p.entityId] as any
    budget = applyStanceToMovement(tInfo?.speed ?? 4, p.currentStance, 0)
    qualities = []
  } else {
    const stageBonus = STAGE_CONFIG[dInfo?.stage as DigimonStage]?.stageBonus ?? 0
    budget = applyStanceToMovement((dInfo?.movement ?? 4) + getAllStatEffectModifier(p.activeEffects ?? []), p.currentStance, stageBonus)
    qualities = dInfo?.qualities ?? []
  }
  const caps = movement.detectCapabilities(qualities, budget, 0, 0)
  // Tamers are always player-side; digimon carry isEnemy from their DB record
  const moverIsEnemy: boolean = p.type === 'digimon' && ((p as any).isEnemy === true)
  const occupied = new Map<string, { pos: Vec3; size: any; isEnemy: boolean; giganticDimensions?: { width: number; height: number; depth: number } | null }>()
  for (const part of props.encounter.participants) {
    if (part.id === participantId) continue
    const partPos = positions.value[part.id]
    if (!partPos) continue
    const partInfo = part.type === 'digimon' ? digimonMapForCanvas.value[part.entityId] : undefined
    const partSize = partInfo?.size ?? 'medium'
    const partIsEnemy: boolean = part.type === 'digimon' && ((part as any).isEnemy === true)
    const partGig = partInfo?.giganticDimensions ?? null
    occupied.set(part.id, { pos: partPos as Vec3, size: partSize, isEnemy: partIsEnemy, giganticDimensions: partGig })
  }
  const moverGig = dInfo?.giganticDimensions ?? null
  return { p, pos, dInfo, budget, caps, occupied, moverIsEnemy, moverGig }
}

function throwCaps(thrownParticipantId: string, controllerId: string) {
  const thrown = props.encounter.participants.find(x => x.id === thrownParticipantId)
  if (!thrown) return null
  const pos = positions.value[thrownParticipantId]
  if (!pos) return null
  const controller = props.encounter.participants.find(x => x.id === controllerId)
  if (!controller) return null

  let budget: number
  if (controller.type === 'tamer') {
    const tInfo = tamerMapForCanvas.value[controller.entityId] as any
    budget = tInfo?.body ?? 0
  } else {
    const cInfo = digimonMapForCanvas.value[controller.entityId] as any
    budget = cInfo ? applyDerivedStatEffects(calculateDigimonDerivedStats(cInfo.baseStats, cInfo.stage, cInfo.size), controller.activeEffects ?? []).body : 0
  }

  const thrownInfo = thrown.type === 'digimon' ? digimonMapForCanvas.value[thrown.entityId] as any : undefined
  const moverSize = thrownInfo?.size ?? 'medium'
  const moverGig = thrownInfo?.giganticDimensions ?? null
  const moverIsEnemy = thrown.type === 'digimon' && ((thrown as any).isEnemy === true)

  const occupied = new Map<string, { pos: Vec3; size: any; isEnemy: boolean; giganticDimensions?: { width: number; height: number; depth: number } | null }>()
  for (const part of props.encounter.participants) {
    if (part.id === thrownParticipantId) continue
    const partPos = positions.value[part.id]
    if (!partPos) continue
    const partInfo = part.type === 'digimon' ? digimonMapForCanvas.value[part.entityId] : undefined
    const partSize = partInfo?.size ?? 'medium'
    const partIsEnemy = part.type === 'digimon' && ((part as any).isEnemy === true)
    const partGig = partInfo?.giganticDimensions ?? null
    occupied.set(part.id, { pos: partPos as Vec3, size: partSize, isEnemy: partIsEnemy, giganticDimensions: partGig })
  }

  return { pos, budget, caps: PROJECTILE_CAPS, occupied, moverSize, moverIsEnemy, moverGig }
}

// ── Charge Attack handlers ───────────────────────────────────────────────────
function sameVec3(a: Vec3 | undefined, b: Vec3): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.z === b.z
}

function startChargeBefore() {
  const attackerId = props.selectedAttack?.attackerParticipantId ?? activeParticipantId.value
  if (!attackerId || !map.value) return
  const ctx = npcMoveCaps(attackerId)
  if (!ctx) return
  movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy, ctx.moverGig)
  chargeMode.value = 'before'
}

async function onChargeTargetSelected(attackerId: string, destination: Vec3, targetId: string | null) {
  let moveSaved: Promise<MoveResult> | null = null
  if (!sameVec3(positions.value[attackerId], destination)) {
    const movePath = movePathTo(attackerId, destination)  // the charge path isn't drawn
    const distance = moveDistance(attackerId, destination, movePath)
    positions.value = { ...positions.value, [attackerId]: destination }
    ws.send({ type: 'unit-moved', encounterId: props.encounter.id, participantId: attackerId, position: destination, path: [], version: 0 })
    openDoorsAlong(attackerId, movePath)
    moveSaved = postMove(attackerId, distance, true)
  }
  chargeMode.value = null
  movement.clearMovement()
  if (targetId) {
    chargeAttackInFlight.value = true
    const moved = moveSaved ? await moveSaved : undefined  // the attack's server write must not race the Charge move's
    if (moved?.defeated) {
      // Burn on the way in knocked the attacker out: there's no attack
      emit('attack-cancelled')
      return
    }
    emit('target-selected', targetId)
  }
}

function onTargetSelected(targetId: string) {
  if (chargeMode.value === 'after') {
    chargeAfterAttackerId.value = props.selectedAttack?.attackerParticipantId ?? activeParticipantId.value
    chargeMode.value = null
    chargeAttackInFlight.value = true
  }
  emit('target-selected', targetId)
}

async function onAreaAttackConfirmed(targetIds: string[], areaShapeData: AreaShapeData | null) {
  let moveSaved: Promise<MoveResult> | null = null
  if (areaShapeData?.shape === 'pass') {
    const newPos = computePassLanding(areaShapeData.attackerPos, areaShapeData.dir, areaShapeData.movement ?? 0, areaShapeData.ram ?? 0)
    const attackerId = props.selectedAttack?.attackerParticipantId ?? activeParticipantId.value
    if (attackerId && !sameVec3(positions.value[attackerId], newPos)) {
      const distance = chebyshev(positions.value[attackerId] ?? areaShapeData.attackerPos, newPos)
      positions.value = { ...positions.value, [attackerId]: newPos }
      ws.send({ type: 'unit-moved', encounterId: props.encounter.id, participantId: attackerId, position: newPos, path: [], version: 0 })
      // A [Pass] moves in a straight line, so it opens any closed door on that line.
      openDoorsAlong(attackerId, segmentCells(areaShapeData.attackerPos, newPos))
      moveSaved = postMove(attackerId, distance, true)
    }
  }

  if (chargeMode.value === 'after') {
    chargeAfterAttackerId.value = props.selectedAttack?.attackerParticipantId ?? activeParticipantId.value
    chargeMode.value = null
    chargeAttackInFlight.value = true
  }
  const moved = moveSaved ? await moveSaved : undefined  // the attack's server write must not race the Pass move's
  if (moved?.defeated) {
    // Burn on the Pass move knocked the attacker out: no attack, and no move after it
    chargeAfterAttackerId.value = null
    emit('attack-cancelled')
    return
  }
  emit('area-attack-confirmed', targetIds, areaShapeData)
}

watch(() => props.selectedAttack, (val) => {
  if (val !== null) return
  chargeAttackInFlight.value = false
  if (chargeMode.value === 'before') {
    chargeMode.value = null
    movement.clearMovement()
  }
  if (chargeAfterAttackerId.value) {
    const attackerId = chargeAfterAttackerId.value
    chargeAfterAttackerId.value = null
    const ctx = npcMoveCaps(attackerId)
    if (ctx && map.value) {
      movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy, ctx.moverGig)
      chargeMoveParticipantId.value = attackerId
    }
  }
})

function onNpcMove(participantId: string) {
  if (!map.value) return
  const ctx = npcMoveCaps(participantId)
  if (!ctx) return
  movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy, ctx.moverGig)
  npcMoveParticipantId.value = participantId
}

// Clash reposition (controller only): same movement, but restricted to cells that keep the
// mover's footprint in contact with its clash partner — clashing units may shuffle around but
// must stay touching. Breaking contact is only allowed via charge/pass clash attacks (which end
// the clash). The clash state is preserved by this move.
function onClashMove(participantId: string) {
  if (!map.value) return
  const ctx = npcMoveCaps(participantId)
  if (!ctx) return
  const clash = (ctx.p as any)?.clash
  if (!clash?.isController) return
  movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy, ctx.moverGig)

  const opponentId = clash.opponentParticipantId
  const opp = opponentId ? ctx.occupied.get(opponentId) : undefined
  if (opp) {
    const moverDims = getFootprintDimensions((ctx.dInfo?.size ?? 'medium') as any, ctx.moverGig)
    const oppDims = getFootprintDimensions((opp.size ?? 'medium') as any, opp.giganticDimensions ?? null)
    const oppCells = getFootprintCells(opp.pos, oppDims)
    // Reach-initiated clashes stay in contact at the reach distance; melee clashes at distance 1.
    const contactRange = clash.reachInitiated && clash.reachDistance ? clash.reachDistance : 1
    const filtered = new Set<string>()
    for (const k of movement.reachableCells.value) {
      const [x, y, z] = k.split(',').map(Number)
      const moverCells = getFootprintCells({ x, y, z }, moverDims)
      const inContact = moverCells.some(mc => oppCells.some(oc => chebyshev(mc, oc) <= contactRange))
      if (inContact) filtered.add(k)
    }
    movement.reachableCells.value = filtered
  }
  npcMoveParticipantId.value = participantId
}

// Post-attack charge move (charge clash attack, "move after"): the clash has already ended, so
// the controller may charge away freely. Enters the normal free-move mode (no contact restriction).
function startChargeAfterMove(participantId: string) {
  if (!map.value) return
  const ctx = npcMoveCaps(participantId)
  if (!ctx) return
  movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy, ctx.moverGig)
  npcMoveParticipantId.value = participantId
}

function startThrowAim(controllerId: string, thrownTargetId: string) {
  if (!map.value) return
  const ctx = throwCaps(thrownTargetId, controllerId)
  if (!ctx) return
  movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.moverSize, ctx.moverIsEnemy, ctx.moverGig)
  npcMoveParticipantId.value = thrownTargetId
  throwAimContext.value = { controllerId, thrownTargetId }
}

function cancelThrowAim() {
  throwAimContext.value = null
  npcMoveParticipantId.value = null
  movement.clearMovement()
}

function startThrowAllyAim(interceptorParticipantId: string, allyParticipantId: string, excludeCells: Set<string>) {
  if (!map.value) return
  const ctx = throwCaps(allyParticipantId, interceptorParticipantId)
  if (!ctx) return
  movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.moverSize, ctx.moverIsEnemy, ctx.moverGig)
  if (excludeCells.size > 0) {
    const filtered = new Set<string>()
    for (const k of movement.reachableCells.value) {
      if (!excludeCells.has(k)) filtered.add(k)
    }
    movement.reachableCells.value = filtered
  }
  npcMoveParticipantId.value = allyParticipantId
  throwAllyAimContext.value = { interceptorParticipantId, allyParticipantId }
}

function cancelThrowAllyAim() {
  throwAllyAimContext.value = null
  npcMoveParticipantId.value = null
  movement.clearMovement()
}

let lastHoveredMovementCell: string | null = null
// Cache map serialization independently of token, participant and record changes.
const mapSignature = computed(() => JSON.stringify(map.value))

// Polling recreates participant and character records. Compare movement inputs by
// value so an unchanged snapshot (or a health/action update) keeps the hovered path.
// Reading the nested values also tracks in-place geometry and occupancy edits.
watch(() => JSON.stringify([
  mapSignature.value, positions.value,
  (props.encounter.destructibleStates ?? [])
    .filter(s => s.currentWounds <= 0).map(s => s.structureId).sort(),
  props.encounter.participants.map(p => [
    p.id, p.type, p.entityId, p.currentStance, p.activeEffects, p.isEnemy,
  ]).sort(([a], [b]) => String(a).localeCompare(String(b))),
  Object.entries(props.digimonMap).sort(([a], [b]) => a.localeCompare(b)).map(([id, d]) => [
    id, d.size, d.giganticDimensions, d.stage, d.baseStats, d.movement, d.qualities, d.isEnemy,
  ]),
  Object.entries(props.tamerMap).sort(([a], [b]) => a.localeCompare(b)).map(([id, t]) => [id, t.speed, t.body]),
]), () => {
  lastHoveredMovementCell = null
  movement.invalidateSearch()
  movement.activePath.value = []
}, { flush: 'sync' })

watch([npcMoveParticipantId, chargeMoveParticipantId, throwAimContext, throwAllyAimContext, movement.reachableCells], () => {
  lastHoveredMovementCell = null
}, { deep: true, flush: 'sync' })

function onCellHovered(cell: Vec3 | null) {
  const participantId = npcMoveParticipantId.value ?? chargeMoveParticipantId.value
  if (!cell || !participantId || !map.value) {
    lastHoveredMovementCell = null
    movement.activePath.value = []
    return
  }
  const hoverKey = `${participantId}:${cell.x},${cell.y},${cell.z}`
  if (hoverKey === lastHoveredMovementCell) return
  lastHoveredMovementCell = hoverKey
  if (throwAimContext.value) {
    const ctx = throwCaps(throwAimContext.value.thrownTargetId, throwAimContext.value.controllerId)
    if (!ctx) return
    movement.computePath(ctx.pos, cell, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.moverSize, ctx.moverIsEnemy, ctx.moverGig)
    return
  }
  if (throwAllyAimContext.value) {
    const ctx = throwCaps(throwAllyAimContext.value.allyParticipantId, throwAllyAimContext.value.interceptorParticipantId)
    if (!ctx) return
    movement.computePath(ctx.pos, cell, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.moverSize, ctx.moverIsEnemy, ctx.moverGig)
    return
  }
  const ctx = npcMoveCaps(participantId)
  if (!ctx) return
  movement.computePath(ctx.pos, cell, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy, ctx.moverGig)
}

function onNpcAction(participantId: string, action: 'move' | 'stance' | 'attack' | 'clash' | ClashRadialAction) {
  if (action === 'move') { onNpcMove(participantId); return }
  if (action === 'clash-move') { onClashMove(participantId); return }
  emit('npc-action', participantId, action as 'stance' | 'attack' | 'clash' | ClashRadialAction)
}

// ── Map editor handlers ────────────────────────────────────────────────────
const selectedStructure = ref<any | null>(null)

async function persistMap(tool: string) {
  if (!map.value || !props.encounter.mapId) return
  await mapStore.updateMap(props.encounter.mapId, {
    groundTiles: map.value.groundTiles,
    spaceTiles: map.value.spaceTiles,
    voxels: map.value.voxels ?? [],
    walls: map.value.walls,
    windows: map.value.windows,
    doors: map.value.doors,
    ceilings: map.value.ceilings,
    stairs: map.value.stairs,
  } as any)
  ws.send({ type: 'map-edited', encounterId: props.encounter.id, changeType: 'add', tileType: tool as any, data: null })
}

async function onCellDraw(start: Vec3, end: Vec3) {
  if (!map.value || !props.encounter.mapId) return
  const tool = editor.activeTool.value
  if (tool === 'add-ground')    editor.applyGroundDraw(start, end)
  else if (tool === 'add-space')     editor.applySpaceDraw(start, end)
  else if (tool === 'paint-element') editor.applyPaintElement(start, end)
  else if (tool === 'voxel')         editor.applyVoxelDraw(start, end)
  else if (tool === 'ceiling')       editor.applyCeilingDraw(start, end)
  else if (tool === 'spawn')         editor.applySpawnToggle(start, end)
  else if (tool === 'delete')        editor.deleteAt(start, end)
  else return
  await persistMap(tool)
}

async function onWallEdit(wallId: string) {
  if (!map.value || !props.encounter.mapId) return
  const tool = editor.activeTool.value
  if (tool === 'window')    editor.applyWindow(wallId)
  else if (tool === 'door') editor.applyDoor(wallId)
  else return
  await persistMap(tool)
}

async function onVoxelEdit(cell: Vec3, mode?: 'window' | 'spawn') {
  if (!map.value || !props.encounter.mapId) return
  const tool = mode ?? editor.activeTool.value
  if (tool === 'window') editor.applyVoxelWindow(cell)
  else if (tool === 'spawn') editor.applySpawnToggle(cell, cell)
  else return
  await persistMap(`voxel-${tool}`)
}

async function onWallEditAtEdge(tile: Vec3, face: WallFace, mode?: string) {
  if (!map.value || !props.encounter.mapId) return
  const tool = editor.activeTool.value
  if (mode === 'delete-wall') {
    editor.deleteWallAt(tile, face)
  } else if (mode === 'delete-fill') {
    editor.deleteWallFillAt(tile, face)
  } else {
    const wall = map.value.walls.find(w => w.x === tile.x && w.y === tile.y && w.z === tile.z && w.face === face)
    if (!wall) return
    if (tool === 'window')    editor.applyWindow(wall.id)
    else if (tool === 'door') editor.applyDoor(wall.id)
    else return
  }
  await persistMap(tool)
}

async function onWallPlace(startTile: Vec3, endTile: Vec3, face: WallFace) {
  if (!map.value || !props.encounter.mapId) return
  const tool = editor.activeTool.value
  if (tool === 'wall')        editor.applyWallDraw(startTile, endTile, face)
  else if (tool === 'stairs') editor.applyStair(startTile, face)
  else return
  await persistMap(tool)
}

async function onUndo() {
  editor.undo()
  await persistMap('undo')
}

async function onRedo() {
  editor.redo()
  await persistMap('redo')
}

function onWallSelected(wallId: string) {
  const wall = map.value?.walls.find(w => w.id === wallId)
  if (!wall) return
  selectedStructure.value = { type: 'wall', id: wallId, currentWoundBoxes: wall.woundBoxes, face: wall.face }
}

function onStructureSave(id: string, type: string, woundBoxes: number | null, face?: WallFace) {
  if (!map.value) return
  if (type === 'wall') {
    const wall = map.value.walls.find(w => w.id === id)
    if (wall) wall.woundBoxes = woundBoxes ?? undefined
  } else if (type === 'ceiling') {
    const ceiling = map.value.ceilings.find(c => c.id === id)
    if (ceiling) ceiling.woundBoxes = woundBoxes ?? undefined
  } else if (type === 'window') {
    const win = map.value.windows.find(w => w.id === id)
    if (win) win.woundBoxes = woundBoxes ?? undefined
  }
  if (props.encounter.mapId) {
    mapStore.updateMap(props.encounter.mapId, {
      walls: map.value.walls,
      ceilings: map.value.ceilings,
      windows: map.value.windows,
    } as any)
    ws.send({ type: 'map-edited', encounterId: props.encounter.id, changeType: 'add', tileType: type as any, data: null })
  }
  selectedStructure.value = null
}

defineExpose({ startThrowAim, cancelThrowAim, startThrowAllyAim, cancelThrowAllyAim, startChargeAfterMove })
</script>

<style scoped>
.encounter-map-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  background: #0d0e1a;
  overflow: hidden;
}
.canvas-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.no-map {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
}
.no-map-msg {
  background: rgba(20, 22, 40, 0.9);
  border: 1px solid #334;
  border-radius: 10px;
  padding: 24px 32px;
  color: #8899aa;
  font-size: 15px;
}
.overlay {
  position: absolute;
  pointer-events: auto;
  z-index: 20;
}
.overlay-top-left   { top: 10px; left: 10px; }
.overlay-right      { top: 10px; right: 10px; bottom: var(--overlay-bottom, 10px); display: flex; flex-direction: column; justify-content: flex-start; }
.overlay-bottom-left  { bottom: var(--overlay-bottom, 10px); left: 10px; }
.overlay-bottom-right { bottom: var(--overlay-bottom, 10px); right: 10px; }
.overlay-property   { top: 50%; right: 10px; transform: translateY(-50%); }
</style>
