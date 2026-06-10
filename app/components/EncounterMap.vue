<template>
  <div class="encounter-map-root">
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
          :participants="encounter.participants"
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
          :selected-attack="mapSelectedAttack"
          :selectable-participant-ids="selectableParticipantIds"
          :attacker-range="attackerStats.range"
          :attacker-effective-limit="attackerStats.effectiveLimit"
          :attacker-melee-range="attackerStats.meleeRange"
          :reachable-cells="movement.reachableCells.value"
          :active-path="movement.activePath.value"
          :placing-participant-id="selectedId"
          :charge-mode="chargeMode"
          :charge-move-participant-id="chargeMoveParticipantId"
          :show-spawn-indicators="props.editorMode || (props.encounter.phase !== 'combat' && props.encounter.phase !== 'ended')"
          @unit-placed="onCanvasPlace"
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
          @player-action="(id, action) => { if (action === 'move') onNpcMove(id); else emit('player-action', id, action) }"
          @cell-hovered="onCellHovered"
          @movement-cancelled="() => { npcMoveParticipantId = null; chargeMoveParticipantId = null; movement.clearMovement() }"
          @wall-selected="onWallSelected"
        />
        <div v-else class="no-map">
          <div class="no-map-msg">
            <span v-if="isDm">No map attached. Attach a map from the encounter settings.</span>
            <span v-else>The GM hasn't attached a map yet.</span>
          </div>
        </div>
      </ClientOnly>

      <!-- Overlay: Placement panel (left side) -->
      <div v-if="showPanel" class="overlay overlay-left">
        <div class="placement-panel">
          <div class="placement-panel-title">{{ isDm ? 'Place Units' : 'Place Your Digimon' }}</div>
          <div
            v-for="p in eligibleParticipants"
            :key="p.id"
            class="placement-card"
            :class="{ selected: selectedId === p.id, placed: !!positions[p.id] }"
            @click="selectParticipant(p.id)"
          >
            <div class="placement-avatar">
              <img v-if="getSpriteUrl(p)" :src="getSpriteUrl(p)" class="placement-avatar-img" />
              <div v-else class="placement-avatar-fallback">{{ getNameForParticipant(p)[0] }}</div>
            </div>
            <span class="placement-name">{{ getNameForParticipant(p) }}</span>
            <span v-if="positions[p.id]" class="placed-badge">✓</span>
          </div>
          <div class="placement-hint">
            {{ selectedId ? 'Click a tile to place' : 'Select a character above' }}
          </div>
        </div>
      </div>

      <!-- Overlay: Battle Log (right side) -->
      <div v-if="!editorMode" class="overlay overlay-right">
        <MapBattleLog
          :battle-log="encounter.battleLog"
          :is-dm="isDm"
          :npc-entity-ids="npcEntityIds"
        />
      </div>

      <!-- Overlay: Player HUD (bottom-left) -->
      <div class="overlay overlay-bottom-left">
        <MapPlayerHUD
          :participants="encounter.participants"
          :tamer-map="tamerMapForCanvas"
          :digimon-map="digimonMapForCanvas"
          :is-dm="isDm"
          :my-tamer-id="myTamerId"
          :my-participant-ids="myParticipantIds"
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
        v-if="isChargeAttack && chargeMode === null"
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
  GameMap, Encounter, Vec3, CombatParticipant, WallFace, DestructibleState,
} from '~/types'
import { useMap } from '~/composables/useMap'
import { useMapWebSocket } from '~/composables/useMapWebSocket'
import { useMapMovement, detectCapabilities } from '~/composables/useMapMovement'
import { useMapEditor } from '~/composables/useMapEditor'
import { useEncounters } from '~/composables/useEncounters'
import { calculateDigimonDerivedStats } from '~/types'

// ── Props ──────────────────────────────────────────────────────────────────
const props = defineProps<{
  encounter: Encounter & { participantPositions: Record<string, Vec3>; destructibleStates: DestructibleState[] }
  isDm: boolean
  myTamerId: string | null
  tamerMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number; partnerId?: string | null }>
  digimonMap: Record<string, {
    name: string; spriteUrl?: string | null; currentWounds: number
    woundBoxes: number; size: any; stage: any; baseStats: any; qualities: any[]
    giganticDimensions?: { width: number; height: number; depth: number } | null
    isEnemy?: boolean
  }>
  selectedAttack: { tags: string[]; range: 'melee' | 'ranged'; bit: number; movement?: number; ram?: number; sizeAboveLarge?: number; effectiveLimit?: number; meleeRange?: number; attackerParticipantId?: string | null } | null
  playerPlacementMode?: boolean
  myParticipantIds?: string[]
  editorMode?: boolean
  selectableParticipantIds?: string[]
}>()

const emit = defineEmits<{
  (e: 'positions-updated', positions: Record<string, Vec3>): void
  (e: 'target-selected', participantId: string): void
  (e: 'encounter-updated', partial: Partial<Encounter>): void
  (e: 'npc-action', participantId: string, action: 'stance' | 'attack'): void
  (e: 'player-action', participantId: string, action: 'attack' | 'direct' | 'special-order' | 'stance' | 'digivolve'): void
  (e: 'area-attack-confirmed', targetParticipantIds: string[]): void
  (e: 'attack-cancelled'): void
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

// Sync from server polls
watch(
  () => props.encounter.participantPositions,
  (incoming) => { positions.value = toPositionsObj(incoming) },
  { deep: true }
)

// ── WebSocket ──────────────────────────────────────────────────────────────
const ws = useMapWebSocket(encounterId)

ws.onMessage((msg) => {
  if (msg.type === 'unit-moved') {
    positions.value = { ...positions.value, [msg.participantId]: msg.position }
    emit('positions-updated', positions.value)
  } else if (msg.type === 'map-edited' || msg.type === 'element-painted' || msg.type === 'door-toggled') {
    if (props.encounter.mapId) mapStore.fetchMap(props.encounter.mapId).then(m => { map.value = m })
  } else if (msg.type === 'full-state') {
    positions.value = toPositionsObj(msg.participantPositions)
    emit('positions-updated', positions.value)
  }
})

// ── Editor ─────────────────────────────────────────────────────────────────
const editor = useMapEditor(map)

// ── Movement ───────────────────────────────────────────────────────────────
const movement = useMapMovement()

// ── Auth/identity ──────────────────────────────────────────────────────────
const myParticipantIds = computed(() =>
  props.myParticipantIds?.length
    ? props.myParticipantIds
    : props.encounter.participants
        .filter(p => p.type === 'tamer' && p.entityId === props.myTamerId)
        .map(p => p.id)
)

const activeParticipantId = computed(() =>
  props.encounter.turnOrder[props.encounter.currentTurnIndex] ?? null
)

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
  const derived = calculateDigimonDerivedStats(d.baseStats, d.stage, d.size)
  const reachRanks = (d.qualities as any[]).find(q => q.id === 'reach')?.ranks ?? 0
  return {
    range: derived.range,
    effectiveLimit: derived.effectiveLimit,
    meleeRange: reachRanks > 0 ? reachRanks * 2 : 1,
  }
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

// ── Placement panel ─────────────────────────────────────────────────────────
const selectedId = ref<string | null>(null)
const npcMoveParticipantId = ref<string | null>(null)

// ── Charge Attack ────────────────────────────────────────────────────────────
const chargeMode = ref<'before' | 'after' | null>(null)
const chargeAfterAttackerId = ref<string | null>(null)
const chargeMoveParticipantId = ref<string | null>(null)

const isChargeAttack = computed(() => props.selectedAttack?.tags?.includes('Charge Attack') ?? false)

const mapSelectedAttack = computed(() =>
  isChargeAttack.value && chargeMode.value === null ? null : props.selectedAttack
)

const showPanel = computed(() =>
  !props.editorMode &&
  ((props.isDm && props.encounter.phase === 'setup') || (props.playerPlacementMode ?? false))
)

const eligibleParticipants = computed(() => {
  if (props.isDm) return props.encounter.participants.filter(p => (p as any).isEnemy)
  return props.encounter.participants.filter(p => (props.myParticipantIds ?? []).includes(p.id))
})

function getNameForParticipant(p: CombatParticipant) {
  if (p.type === 'tamer') return tamerMapForCanvas.value[p.entityId]?.name ?? '?'
  return digimonMapForCanvas.value[p.entityId]?.name ?? '?'
}

function getSpriteUrl(p: CombatParticipant): string | null {
  if (p.type === 'tamer') return tamerMapForCanvas.value[p.entityId]?.spriteUrl ?? null
  return digimonMapForCanvas.value[p.entityId]?.spriteUrl ?? null
}

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
    emit('positions-updated', positions.value)
  }
  selectedId.value = id
}

function onCanvasPlace(participantId: string, cell: Vec3) {
  positions.value = { ...positions.value, [participantId]: cell }
  selectedId.value = null
  emit('positions-updated', positions.value)
  ws.send({ type: 'unit-moved', encounterId: props.encounter.id, participantId, position: cell, path: [] })
}

function onCombatMove(participantId: string, position: Vec3, path: Vec3[]) {
  positions.value = { ...positions.value, [participantId]: position }
  emit('positions-updated', positions.value)
  ws.send({ type: 'unit-moved', encounterId: props.encounter.id, participantId, position, path })

  if (chargeMoveParticipantId.value === participantId) {
    chargeMoveParticipantId.value = null
    movement.clearMovement()
    useEncounters().updateEncounter(props.encounter.id, { participantPositions: positions.value } as any)
    return
  }

  if (npcMoveParticipantId.value === participantId) {
    npcMoveParticipantId.value = null
    movement.clearMovement()
    $fetch(`/api/encounters/${props.encounter.id}/actions/move`, {
      method: 'POST',
      body: { participantId },
    }).catch((e: unknown) => console.error('move action deduct failed', e))
  }
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
  const dInfo = digimonMapForCanvas.value[p.entityId] as any
  const budget: number = dInfo?.movement ?? 4
  const qualities: any[] = dInfo?.qualities ?? []
  const caps = movement.detectCapabilities(qualities, budget, 0, 0)
  // Tamers are always player-side; digimon carry isEnemy from their DB record
  const moverIsEnemy: boolean = p.type === 'digimon' && ((p as any).isEnemy === true)
  const occupied = new Map<string, { pos: Vec3; size: any; isEnemy: boolean }>()
  for (const part of props.encounter.participants) {
    if (part.id === participantId) continue
    const partPos = positions.value[part.id]
    if (!partPos) continue
    const partSize = (digimonMapForCanvas.value[part.entityId] as any)?.size ?? 'medium'
    const partIsEnemy: boolean = part.type === 'digimon' && ((part as any).isEnemy === true)
    occupied.set(part.id, { pos: partPos as Vec3, size: partSize, isEnemy: partIsEnemy })
  }
  return { p, pos, dInfo, budget, caps, occupied, moverIsEnemy }
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
  movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy)
  chargeMode.value = 'before'
}

async function onChargeTargetSelected(attackerId: string, destination: Vec3, targetId: string | null) {
  if (!sameVec3(positions.value[attackerId], destination)) {
    positions.value = { ...positions.value, [attackerId]: destination }
    emit('positions-updated', positions.value)
    ws.send({ type: 'unit-moved', encounterId: props.encounter.id, participantId: attackerId, position: destination, path: [] })
    await useEncounters().updateEncounter(props.encounter.id, { participantPositions: positions.value } as any)
  }
  chargeMode.value = null
  movement.clearMovement()
  if (targetId) emit('target-selected', targetId)
}

function onTargetSelected(targetId: string) {
  if (chargeMode.value === 'after') {
    chargeAfterAttackerId.value = props.selectedAttack?.attackerParticipantId ?? activeParticipantId.value
    chargeMode.value = null
  }
  emit('target-selected', targetId)
}

function onAreaAttackConfirmed(targetIds: string[]) {
  if (chargeMode.value === 'after') {
    chargeAfterAttackerId.value = props.selectedAttack?.attackerParticipantId ?? activeParticipantId.value
    chargeMode.value = null
  }
  emit('area-attack-confirmed', targetIds)
}

watch(() => props.selectedAttack, (val) => {
  if (val !== null) return
  if (chargeMode.value === 'before') {
    chargeMode.value = null
    movement.clearMovement()
  }
  if (chargeAfterAttackerId.value) {
    const attackerId = chargeAfterAttackerId.value
    chargeAfterAttackerId.value = null
    const ctx = npcMoveCaps(attackerId)
    if (ctx && map.value) {
      movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy)
      chargeMoveParticipantId.value = attackerId
    }
  }
})

function onNpcMove(participantId: string) {
  if (!map.value) return
  const ctx = npcMoveCaps(participantId)
  if (!ctx) return
  movement.computeReachable(ctx.pos, ctx.budget, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy)
  npcMoveParticipantId.value = participantId
}

function onCellHovered(cell: Vec3 | null) {
  if (!cell || !npcMoveParticipantId.value || !map.value) {
    movement.activePath.value = []
    return
  }
  const ctx = npcMoveCaps(npcMoveParticipantId.value)
  if (!ctx) return
  movement.computePath(ctx.pos, cell, ctx.caps, map.value, destroyedIds(), ctx.occupied, ctx.dInfo?.size ?? 'medium', ctx.moverIsEnemy)
}

function onNpcAction(participantId: string, action: 'move' | 'stance' | 'attack') {
  if (action === 'move') { onNpcMove(participantId); return }
  emit('npc-action', participantId, action as 'stance' | 'attack')
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
.overlay-left       { top: 60px; left: 10px; bottom: 10px; display: flex; flex-direction: column; justify-content: center; pointer-events: none; }
.overlay-right      { top: 10px; right: 10px; bottom: 10px; display: flex; flex-direction: column; justify-content: flex-start; }
.overlay-bottom-left  { bottom: 10px; left: 10px; }
.overlay-bottom-right { bottom: 10px; right: 10px; }
.overlay-property   { top: 50%; right: 10px; transform: translateY(-50%); }
.placement-panel {
  pointer-events: auto;
  background: rgba(10, 12, 25, 0.92);
  border: 1px solid #334;
  border-radius: 8px;
  padding: 10px;
  width: 180px;
  max-height: 70vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.placement-panel-title {
  font-size: 10px;
  font-weight: 700;
  color: #8899aa;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-bottom: 5px;
  border-bottom: 1px solid #334;
  margin-bottom: 2px;
}
.placement-card {
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
  border: 1px solid #334;
  background: #1a1e30;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #bbc;
  transition: background 0.12s;
}
.placement-card:hover { background: #242840; border-color: #446; }
.placement-card.selected { border-color: #f97316; background: #3a1a05; color: #fff; }
.placement-card.placed { opacity: 0.6; }
.placement-avatar {
  width: 32px; height: 32px;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  background: #223;
}
.placement-avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.placement-avatar-fallback {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; color: #aabbcc;
}
.placement-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.placed-badge { font-size: 10px; color: #22cc55; flex-shrink: 0; }
.placement-hint { font-size: 10px; color: #556; margin-top: 3px; text-align: center; }
</style>
