<template>
  <div
    ref="containerRef"
    class="map-canvas-container"
    @wheel.prevent="onWheel"
    @dragover="onExternalDragOver"
    @dragleave="onExternalDragLeave"
    @drop="onExternalDrop"
  >
    <canvas ref="canvasRef" class="map-canvas" />
    <!-- Y-clip + ghost walls controls -->
    <div class="map-view-controls">
      <div class="map-view-row">
        <span>Y-clip</span>
        <input type="number" v-model.number="clipY" min="-5" max="20" step="1" class="clip-input" />
      </div>
      <button :class="{ active: ghostWalls }" @click="ghostWalls = !ghostWalls">Ghost Walls</button>
      <div v-if="aimedMoveParticipantId" class="map-view-row" title="Scroll to change movement height">
        <span>Move Y</span><span>{{ aimedMoveY }}</span>
      </div>
    </div>
    <!-- Click-to-show health bar (client-local) -->
    <div
      v-if="clickedHealthBar"
      class="health-bar-popup"
      :style="{ left: clickedHealthBar.screenX + 'px', top: clickedHealthBar.screenY + 'px' }"
    >
      <div class="health-bar-name">{{ clickedHealthBar.name }}</div>
      <div class="health-bar-track">
        <div
          class="health-bar-fill"
          :class="healthBarClass(clickedHealthBar.pct)"
          :style="{ width: (clickedHealthBar.pct * 100) + '%' }"
        />
      </div>
      <div class="health-bar-label">{{ Math.round(clickedHealthBar.pct * 100) }}%</div>
    </div>
    <!-- Radial movement confirmation -->
    <div
      v-if="pendingMovePos && movePendingScreen"
      class="move-confirm-popup"
      :style="{ left: movePendingScreen.x + 'px', top: movePendingScreen.y + 'px' }"
    >
      <button class="move-confirm-btn confirm" @click="confirmMove">✓ Confirm</button>
      <button class="move-confirm-btn cancel" @click="cancelMove">✗ Cancel</button>
    </div>
    <!-- Character token overlays -->
    <div class="char-overlays">
      <div v-if="movementGhostOverlay && aimedMoveParticipantId" class="char-token"
        :style="{ left: movementGhostOverlay.x + 'px', top: movementGhostOverlay.y + 'px', width: movementGhostOverlay.h + 'px', height: movementGhostOverlay.h + 'px', opacity: 0.2, borderColor: movementGhostOverlay.valid ? STANCE_COLORS[movementGhostOverlay.stance] : '#ff3333', zIndex: 1000001 }">
        <img v-if="movementGhostOverlay.spriteUrl" :src="movementGhostOverlay.spriteUrl" class="char-token-img" />
        <div v-else class="char-token-fallback">{{ movementGhostOverlay.initial }}</div>
      </div>
      <div
        v-for="(ov, pid) in characterOverlays"
        :key="pid"
        class="char-token"
        :style="{ left: ov.x + 'px', top: ov.y + 'px', width: ov.w + 'px', height: ov.h + 'px', borderColor: STANCE_COLORS[ov.stance], zIndex: ov.zIndex }"
      >
        <img v-if="ov.spriteUrl" :src="ov.spriteUrl" class="char-token-img" />
        <div v-else class="char-token-fallback">{{ ov.initial }}</div>
        <div v-if="ov.woundFilter" class="char-token-wound-filter" :class="ov.woundFilter" />
      </div>
    </div>
    <!-- Movement distance label -->
    <div
      v-if="hoveredMoveScreen && aimedMoveParticipantId"
      class="move-distance-label"
      :style="{ left: hoveredMoveScreen.x + 'px', top: hoveredMoveScreen.y + 'px' }"
    >{{ hoveredMoveDistance }} m</div>
    <div v-if="movementGapLabel && aimedMoveParticipantId" class="move-distance-label"
      :style="{ left: movementGapLabel.x + 'px', top: movementGapLabel.y + 'px', color: '#8edbff' }">{{ movementGapLabel.text }}</div>
    <MapRadialMenu
      v-if="participantChoice && participantChoiceScreen && participantChoiceItems.length"
      key="participant-choice"
      :items="participantChoiceItems"
      :center="participantChoiceScreen"
      :bounds="radialBounds"
      label="Choose character"
      :token-radius="24"
      @select="onParticipantChoice"
      @hover="onParticipantChoiceHover"
      @close="closeRadial"
    />
    <MapRadialMenu
      v-else-if="radialParticipantId && radialScreen"
      :key="radialParticipantId"
      :items="radialItems"
      :center="radialScreen"
      :bounds="radialBounds"
      :label="participantDisplayNames[radialParticipantId] ?? 'Participant'"
      :token-radius="radialTokenRadius"
      @select="onRadialSelect"
      @hover="onRadialHover"
      @close="closeRadial"
    />
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type {
  GameMap, MapVoxel, Vec3, CombatParticipant, ElementType, MapTool, DigimonSize,
  DestructibleState, WallFace, Stance, EddySoulRules,
} from '~/types'
import { vec3Key, parseVec3Key } from '~/utils/mapGeometry'
import { getMapVoxels, mapVoxelBlocksMovement } from '~/utils/mapVoxels'
import { buildVoxelSurface } from '~/utils/voxelSurface'
import { createMapTerrainChunks } from '~/utils/mapTerrainChunks'
import { getMapGeometryRevision } from '~/utils/mapEdits'
import { clearMapGroup, disposeMapObjects, mapPreviewChanged } from '~/utils/mapRenderResources'
import { createVoxelGeometry, createStairGeometry, stairDirectionForFace } from '~/utils/voxelGeometry'
import { getAreaShape, computeAreaCells, computePassBeam, normalize3, computePassLanding } from '~/utils/areaShapes'
import type { AreaShapeData } from '~/utils/areaShapes'
import type { MapAttackDescriptor } from '~/utils/mapAttackDescriptor'
import type { FootprintDims, MovementCapabilities } from '~/utils/movementRules'
import { getFootprintDimensions, getFootprintCells, canLandOn, sizeInteraction } from '~/utils/movementRules'
import { STANCE_COLORS } from '~/utils/stanceModifiers'
import { MAP_GEOMETRY, buildLosIndex, losClear, losClip, canSeeFootprint, type LosIndex } from '~/utils/lineOfSight'
import { doorsAdjacentTo } from '~/utils/mapDoors'
import {
  evaluatePlacement, makeSpawnCellChecker,
  type PlacementEvaluation, type PlacementFootprint,
} from '~/utils/placementRules'
import { createTokenDragController } from '~/utils/tokenDrag'
import { buildMovementGroundIndex, movementGroundBelow } from '~/utils/movementGap'
import { buildParticipantDisplayNames } from '~/utils/participantDisplayNames'
import type { AttackRadialRider, MapRadialItem, MapRadialOptions, MapRadialChoiceAction } from '~/types/mapRadial'
import { withRadialActionCosts } from '~/utils/radialActionCosts'

type ClashRadialAction = 'clash-attack' | 'clash-pin' | 'clash-throw' | 'clash-end' | 'clash-check' | 'clash-move'

// ── Props ──────────────────────────────────────────────────────────────────
const props = defineProps<{
  map: GameMap | null
  participants: CombatParticipant[]
  participantPositions: Record<string, Vec3>
  destructibleStates: DestructibleState[]
  tamerMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number }>
  digimonMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number; size: DigimonSize; giganticDimensions?: { width: number; height: number; depth: number } | null; partnerId?: string | null; qualities?: any[]; isEnemy?: boolean }>
  activeTool: MapTool
  drawMode: 'line' | 'square' | 'cube'
  currentEditY: number
  rampDirection?: WallFace
  isDm: boolean
  combatActive?: boolean
  myParticipantIds: string[]  // participant IDs the current user controls
  activeParticipantId: string | null  // whose turn it is
  secondaryActiveParticipantId: string | null  // partner of the active participant, also highlighted
  selectedAttack: MapAttackDescriptor | null
  attackerRange: number
  attackerEffectiveLimit: number
  attackerMeleeRange: number  // 1 + reach*2
  attackerCaps: MovementCapabilities  // built by EncounterMap (real movement/RAM/CPU) for [Pass] landing checks
  reachableCells: Set<string>
  activePath: Vec3[]
  placingParticipantId: string | null
  draggableParticipantIds?: string[]   // placed tokens the viewer may press-and-drag to a new cell
  externalDragParticipantId?: string | null  // a HUD card currently being dragged over the map
  gmMoveParticipantId: string | null   // GM free-move: reposition this participant onto any valid tile
  npcMoveParticipantId: string | null
  chargeMode: 'before' | 'after' | null
  chargeMoveParticipantId: string | null
  showSpawnIndicators?: boolean
  selectableParticipantIds?: string[]
  eddySoulRules?: EddySoulRules
  radialOptions?: Record<string, MapRadialOptions>
}>()

const emit = defineEmits<{
  (e: 'unit-placed', participantId: string, position: Vec3): void
  // A drag ended on a cell that passed the placement rules (token dragged, or HUD card dropped).
  (e: 'unit-dragged', participantId: string, position: Vec3): void
  (e: 'unit-moved', participantId: string, position: Vec3, path: Vec3[]): void
  (e: 'cell-clicked', cell: Vec3): void
  (e: 'cell-draw', start: Vec3, end: Vec3): void
  (e: 'rotate-ramp', step: -1 | 1): void
  (e: 'wall-edit', wallId: string): void
  (e: 'wall-edit-at-edge', tile: Vec3, face: WallFace, mode?: string): void
  (e: 'wall-place', startTile: Vec3, endTile: Vec3, face: WallFace): void
  (e: 'voxel-edit', cell: Vec3, mode?: 'window' | 'spawn'): void
  (e: 'target-selected', participantId: string): void
  (e: 'area-attack-confirmed', targetParticipantIds: string[], areaShapeData: AreaShapeData | null): void
  (e: 'attack-cancelled'): void
  (e: 'charge-target-selected', attackerId: string, destination: Vec3, targetId: string | null): void
  (e: 'npc-action', participantId: string, action: 'move' | 'stance' | 'attack' | 'clash' | ClashRadialAction): void
  (e: 'player-action', participantId: string, action: 'move' | 'attack' | 'direct' | 'special-order' | 'stance' | 'digivolve' | 'mode-change' | 'clash' | ClashRadialAction): void
  (e: 'gm-move', participantId: string): void
  (e: 'gm-manage', participantId: string): void
  (e: 'gm-moved', participantId: string, position: Vec3): void
  (e: 'cell-hovered', cell: Vec3 | null): void
  (e: 'movement-cancelled'): void
  (e: 'wall-selected', wallId: string): void
  (e: 'map-changed'): void
  (e: 'door-toggle', doorId: string, isOpen: boolean): void
  (e: 'attack-selected', participantId: string, attackId: string, riders?: AttackRadialRider[]): void
  (e: 'attack-rider-selected', participantId: string, attackId: string, rider: AttackRadialRider): void
  (e: 'stance-selected', participantId: string, stance: Stance): void
  (e: 'action-selected', participantId: string, action: MapRadialChoiceAction, choiceId: string): void
}>()

// ── Participant display names matching encounter page getDisplayName logic ───
// The participant whose position is the attack origin — may differ from activeParticipantId
// when a tamer's partner digimon attacks on the tamer's turn.
const effectiveAttackerId = computed(() =>
  props.selectedAttack?.attackerParticipantId ?? props.activeParticipantId
)

const participantDisplayNames = computed(() => buildParticipantDisplayNames(
  props.participants,
  p => (p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId])?.name,
  p => ((p as CombatParticipant & { isEnemy?: boolean }).isEnemy ?? props.digimonMap[p.entityId]?.isEnemy) === true,
))

// ── Refs ───────────────────────────────────────────────────────────────────
const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const clickedHealthBar = ref<{ name: string; pct: number; current: number; max: number; screenX: number; screenY: number } | null>(null)
const pendingMovePos = ref<Vec3 | null>(null)
const movePendingScreen = ref<{ x: number; y: number } | null>(null)
const pendingMovePath = ref<Vec3[]>([])
const movingParticipantId = ref<string | null>(null)
const participantChoice = ref<{ anchor: Vec3; dims: FootprintDims; point: Vec3 } | null>(null)
const participantChoiceScreen = ref<{ x: number; y: number } | null>(null)
const npcRadialId = ref<string | null>(null)
const npcRadialScreen = ref<{ x: number; y: number } | null>(null)
const npcRadialParticipant = computed(() =>
  npcRadialId.value ? (props.participants.find(p => p.id === npcRadialId.value) ?? null) : null
)
const npcOutOfActions = computed(() => {
  const p = npcRadialParticipant.value
  return !p || (p.actionsRemaining?.simple || 0) < 1
})
// GM-only radial controls for any token, on any turn.
const gmRadialId = ref<string | null>(null)
const gmRadialScreen = ref<{ x: number; y: number } | null>(null)

const playerRadialId = ref<string | null>(null)
const playerRadialScreen = ref<{ x: number; y: number } | null>(null)
const playerRadialParticipantType = computed(() =>
  playerRadialId.value
    ? (props.participants.find(p => p.id === playerRadialId.value)?.type ?? null)
    : null
)
const radialTamerParticipant = computed(() =>
  playerRadialParticipantType.value === 'tamer'
    ? props.participants.find(p => p.id === playerRadialId.value) ?? null
    : null
)
const directDisabled = computed(() => {
  const t = radialTamerParticipant.value
  return !t || t.hasDirectedThisTurn || (t.actionsRemaining?.simple || 0) < 1
})
const radialDigimonParticipant = computed(() =>
  playerRadialParticipantType.value === 'digimon'
    ? props.participants.find(p => p.id === playerRadialId.value) ?? null
    : null
)
const radialDigimonPartnerTamer = computed(() => {
  const d = radialDigimonParticipant.value
  if (!d) return null
  const partnerId = props.digimonMap[d.entityId]?.partnerId
  if (!partnerId) return null
  return props.participants.find(p => p.type === 'tamer' && p.entityId === partnerId) ?? null
})
const digivolveRange = computed(() => props.eddySoulRules?.directRangeOverrides?.digivolve ?? 15)
const digivolveDisabled = computed(() => {
  const d = radialDigimonParticipant.value
  const t = radialDigimonPartnerTamer.value
  if (!d || !t) return true

  if ((t.actionsRemaining?.simple || 0) < 1) return true

  const dPos = props.participantPositions[d.id]
  const tPos = props.participantPositions[t.id]
  if (!dPos || !tPos) return true

  const dist = Math.max(Math.abs(dPos.x - tPos.x), Math.abs(dPos.y - tPos.y), Math.abs(dPos.z - tPos.z))
  return dist > digivolveRange.value
})
// Out of own actions: grays the shared player Move button (tamer or digimon) and the digimon Attack button.
const radialPlayerOutOfActions = computed(() => {
  const p = props.participants.find(pp => pp.id === playerRadialId.value)
  return !p || (p.actionsRemaining?.simple || 0) < 1
})
// While a participant is in a clash, the radial menu shows only the clash actions valid for
// their role (controller / controlled / pending clash-check) instead of the normal action set.
function clashRadialButtons(p: CombatParticipant | null):
  | { action: ClashRadialAction, label: string, disabled: boolean }[]
  | 'controlled'
  | null
{
  const clash = p?.clash
  if (!clash) return null
  if (clash.clashCheckNeeded) {
    return [{ action: 'clash-check', label: 'Roll Clash Check', disabled: false }]
  }
  if (clash.isController) {
    const simple = p?.actionsRemaining?.simple || 0
    return [
      { action: 'clash-attack', label: 'Clash Attack', disabled: simple < 2 },
      { action: 'clash-pin', label: 'Pin', disabled: simple < 2 },
      { action: 'clash-throw', label: 'Throw', disabled: simple < 2 },
      { action: 'clash-move', label: 'Reposition', disabled: false },
      { action: 'clash-end', label: 'End Clash', disabled: false },
    ]
  }
  return 'controlled'
}
const npcClashButtons = computed(() => clashRadialButtons(npcRadialParticipant.value))
const radialPlayerClashButtons = computed(() =>
  clashRadialButtons(props.participants.find(pp => pp.id === playerRadialId.value) ?? null)
)
const hasModeChangeQuality = computed(() => {
  const d = radialDigimonParticipant.value
  if (!d) return false
  const qualities = props.digimonMap[d.entityId]?.qualities ?? []
  return qualities.some((q: any) => (q.id === 'mode-change' || q.id === 'mode-change-x0') && (q.ranks ?? 0) > 0)
})
// Mode Change costs the digimon's own action, but Mode Change X.0 Rank 2 grants up to 3 free swaps per combat.
// Mirrors canUseModeChangeSwap (app/utils/modeChange.ts), inverted; reads qualities from the Record-shaped prop.
const modeChangeDisabled = computed(() => {
  const d = radialDigimonParticipant.value
  if (!d) return true
  if ((d.actionsRemaining?.simple || 0) >= 1) return false
  const x0Rank = (props.digimonMap[d.entityId]?.qualities ?? [])
    .find((q: any) => q.id === 'mode-change-x0')?.ranks ?? 0
  if (props.eddySoulRules?.modeChangeFreeSwapsPerCombat && x0Rank >= 2) {
    return ((d as any).modeChangeFreeSwapsUsed ?? 0) >= 3
  }
  return true
})
// Doors the radial's unit stands beside — opening or closing one is a free action.
function radialDoorButtons(participantId: string | null): { id: string; isOpen: boolean; label: string }[] {
  const pos = participantId ? props.participantPositions[participantId] : null
  if (!props.map || !pos) return []
  const destroyed = new Set((props.destructibleStates ?? []).filter(s => s.currentWounds <= 0).map(s => s.structureId))
  const doors = doorsAdjacentTo(props.map, pos, getParticipantFootprintDims(participantId), destroyed)
  return doors.map((d, i) => ({
    id: d.id,
    isOpen: d.isOpen,
    label: `${d.isOpen ? 'Close' : 'Open'} Door${doors.length > 1 ? ` ${i + 1}` : ''}`,
  }))
}
const npcDoorButtons = computed(() => radialDoorButtons(npcRadialId.value))
const playerDoorButtons = computed(() => radialDoorButtons(playerRadialId.value))
const radialBounds = ref({ width: 0, height: 0 })
const radialParticipantId = computed(() => npcRadialId.value ?? playerRadialId.value ?? gmRadialId.value)
const radialScreen = computed(() => npcRadialScreen.value ?? playerRadialScreen.value ?? gmRadialScreen.value)
const radialTokenRadius = computed(() => {
  const overlay = radialParticipantId.value ? characterOverlays.value[radialParticipantId.value] : null
  return overlay ? overlay.w / 2 : 24
})

function participantCandidatesAt(anchor: Vec3, dims: FootprintDims): CombatParticipant[] {
  const cells = new Set(getFootprintCells(anchor, dims).map(vec3Key))
  return props.participants.filter(p => {
    const pos = props.participantPositions[p.id]
    return !p.inReserve && pos && footprintIntersectsArea(pos, getParticipantFootprintDims(p.id), cells)
  })
}

function participantChoiceOptions(): MapRadialItem[] {
  const choice = participantChoice.value
  if (!choice) return []
  return participantCandidatesAt(choice.anchor, choice.dims).map(p => {
    const info = p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId]
    const allegiance = props.myParticipantIds.includes(p.id) ? 'Your character' : p.isEnemy ? 'Enemy' : 'Ally'
    return {
      id: `participant:${p.id}`,
      label: participantDisplayNames.value[p.id] ?? info?.name ?? p.id,
      icon: p.type === 'tamer' ? 'T' : 'D',
      description: `${p.type === 'tamer' ? 'Tamer' : 'Digimon'} · ${allegiance}`,
    }
  })
}
const participantChoiceItems = computed(participantChoiceOptions)

function radialChoiceGroup(action: 'attack' | 'stance' | MapRadialChoiceAction, disabled: boolean): MapRadialItem {
  const options = radialParticipantId.value ? props.radialOptions?.[radialParticipantId.value] : undefined
  const choices = options?.[action === 'attack' ? 'attacks' : action === 'stance' ? 'stances' : action]
  const labels = { attack: 'Attack', stance: 'Stance', direct: 'Direct', digivolve: 'Digivolve', 'mode-change': 'Mode Change', 'special-order': 'Orders' }
  return {
    id: action,
    label: labels[action],
    icon: action,
    disabled,
    // An omitted options prop keeps the existing action event available to other map consumers.
    children: choices ? (choices.length ? choices.map(choice => ({ ...choice, id: `${action}:${choice.id}` })) : [
      { id: `empty:${action}`, label: 'No options', disabled: true },
    ]) : undefined,
  }
}

const radialItems = computed<MapRadialItem[]>(() => {
  const gmOptions: MapRadialItem[] = props.isDm ? [
    { id: 'gm-move', label: 'GM Move', icon: 'gm-move', description: 'Reposition freely', cost: 'Free' },
    { id: 'gm-manage', label: 'Manage', icon: 'manage', description: 'Wounds, effects and GM controls', cost: 'Free' },
  ] : []
  const participant = props.participants.find(p => p.id === radialParticipantId.value)
  if (gmRadialId.value || (props.isDm && (!participant || !canUseTurnRadial(participant)))) return gmOptions
  const isNpc = !!npcRadialId.value
  const clashButtons = isNpc ? npcClashButtons.value : radialPlayerClashButtons.value
  const outOfActions = isNpc ? npcOutOfActions.value : radialPlayerOutOfActions.value
  const items: MapRadialItem[] = []
  if (clashButtons === 'controlled') {
    items.push({ id: 'controlled', label: 'Controlled', icon: 'clash', disabled: true })
  } else if (clashButtons) {
    items.push(...clashButtons.map(button => ({ id: button.action, label: button.label, icon: 'clash', disabled: button.disabled })))
  } else {
    items.push({ id: 'move', label: 'Move', icon: 'move', disabled: outOfActions })
    if (isNpc || playerRadialParticipantType.value === 'digimon') {
      items.push(radialChoiceGroup('attack', outOfActions))
    } else if (playerRadialParticipantType.value === 'tamer') {
      items.push(
        radialChoiceGroup('direct', directDisabled.value),
        { ...radialChoiceGroup('special-order', false), icon: 'orders' },
      )
    }
    items.push(radialChoiceGroup('stance', outOfActions))
    if (!isNpc && hasModeChangeQuality.value) {
      items.push(radialChoiceGroup('mode-change', modeChangeDisabled.value))
    }
    items.push({ id: 'clash', label: 'Clash', icon: 'clash', disabled: outOfActions })
    const doors = isNpc ? npcDoorButtons.value : playerDoorButtons.value
    if (doors.length) items.push({ id: 'doors', label: 'Doors', icon: 'door', children: doors.map(door => ({
      id: `door:${door.id}`, label: door.label, icon: 'door', description: 'Free action',
    })) })
  }
  if (!isNpc && playerRadialParticipantType.value === 'digimon') {
    items.push(radialChoiceGroup('digivolve', digivolveDisabled.value))
  }
  if (isNpc && props.isDm && props.radialOptions?.[npcRadialId.value!]?.digivolve?.length) {
    items.push(radialChoiceGroup('digivolve', outOfActions))
  }
  items.push(...gmOptions)
  return withRadialActionCosts(items, participant, participant ? props.digimonMap?.[participant.entityId] : undefined, props.eddySoulRules, props.participants)
})

function closeRadial() {
  highlightDoor(null)
  if (participantChoice.value) setHoveredTarget(null)
  participantChoice.value = null
  participantChoiceScreen.value = null
  npcRadialId.value = null
  npcRadialScreen.value = null
  playerRadialId.value = null
  playerRadialScreen.value = null
  gmRadialId.value = null
  gmRadialScreen.value = null
}

function onParticipantChoiceHover(item: MapRadialItem | null) {
  const id = item?.id.startsWith('participant:') ? item.id.slice(12) : null
  setHoveredTarget(id && participantChoiceItems.value.some(choice => choice.id === item?.id) ? id : null)
}

function onParticipantChoice(item: MapRadialItem) {
  const choice = participantChoice.value
  if (!choice || !participantChoiceOptions().some(option => option.id === item.id)) return
  const point = new THREE.Vector3(choice.point.x, choice.point.y, choice.point.z)
  closeRadial()
  selectMapParticipant(item.id.slice(12), point)
}

function onRadialHover(item: MapRadialItem | null) {
  highlightDoor(item?.id.startsWith('door:') ? item.id.slice(5) : null)
}

function enabledRadialLeaf(items: MapRadialItem[], id: string): MapRadialItem | undefined {
  for (const item of items) {
    if (item.disabled) continue
    if (item.children) {
      const leaf = enabledRadialLeaf(item.children, id)
      if (leaf) return leaf
    } else if (item.id === id) return item
  }
}

function onRadialSelect(item: MapRadialItem) {
  const participantId = radialParticipantId.value
  // Re-check the live tree: a server update may have exhausted the parent action
  // or removed a choice while its submenu was open.
  const current = enabledRadialLeaf(radialItems.value, item.id)
  if (!participantId || !current) return
  if (current.attackId && current.attackRider) {
    emit('attack-rider-selected', participantId, current.attackId, current.attackRider)
  } else if (current.attackId && current.attackRiders) {
    closeRadial()
    emit('attack-selected', participantId, current.attackId, current.attackRiders)
  } else if (item.id.startsWith('attack:')) {
    closeRadial()
    emit('attack-selected', participantId, item.id.slice(7))
  } else if (item.id.startsWith('stance:')) {
    closeRadial()
    emit('stance-selected', participantId, item.id.slice(7) as Stance)
  } else if (['direct:', 'digivolve:', 'mode-change:', 'special-order:'].some(prefix => item.id.startsWith(prefix))) {
    const separator = item.id.indexOf(':')
    closeRadial()
    emit('action-selected', participantId, item.id.slice(0, separator) as MapRadialChoiceAction, item.id.slice(separator + 1))
  } else if (item.id.startsWith('door:')) {
    const door = props.map?.doors.find(door => door.id === item.id.slice(5))
    if (door) radialToggleDoor(door.id, !door.isOpen)
  } else if (item.id === 'gm-move') {
    gmMove(participantId)
  } else if (item.id === 'gm-manage') {
    if (props.isDm && props.participants.some(p => p.id === participantId)) {
      closeRadial()
      emit('gm-manage', participantId)
    }
  } else if (npcRadialId.value) {
    npcAction(item.id as Parameters<typeof npcAction>[0])
  } else if (playerRadialId.value) {
    playerRadialAction(item.id as Parameters<typeof playerRadialAction>[0])
  }
}
const moveStartPos = ref<Vec3 | null>(null)
const hoveredMoveScreen = ref<{ x: number; y: number } | null>(null)
const hoveredMoveDistance = ref<number>(0)
const movementGhost = ref<{ participantId: string; cell: Vec3; valid: boolean } | null>(null)
const movementGhostOverlay = ref<{ x: number; y: number; h: number; spriteUrl: string | null; initial: string; stance: Stance; valid: boolean } | null>(null)
const movementGapLabel = ref<{ x: number; y: number; text: string } | null>(null)
const movementGroundIndex = computed(() => buildMovementGroundIndex(props.map?.groundTiles ?? [], getMapVoxels(props.map)))
const npcMoveY = ref<number>(0)
const gmMoveY = ref<number>(0)
const aimedMoveParticipantId = computed(() => movingParticipantId.value ?? props.gmMoveParticipantId)
const aimedMoveY = computed(() => movingParticipantId.value ? npcMoveY.value : gmMoveY.value)

function getMoveAim() {
  const participantId = movingParticipantId.value ?? props.gmMoveParticipantId
  if (!participantId) return null
  const isGm = !movingParticipantId.value && !!props.gmMoveParticipantId
  return { participantId, isGm, y: isGm ? gmMoveY.value : npcMoveY.value }
}

function moveCellAt(event: MouseEvent, y: number): Vec3 | null {
  setMouseFromEvent(event)
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(y * TILE_SIZE + TILE_H))
  const target = new THREE.Vector3()
  return raycaster.ray.intersectPlane(plane, target) ? { x: Math.floor(target.x), y, z: Math.floor(target.z) } : null
}

function validGmMoveCell(cell: Vec3, participantId: string): boolean {
  const dims = getParticipantFootprintDims(participantId)
  if (footprintOccupied(cell, dims, participantId)) return false
  const map = props.map
  if (!map) return true
  return getFootprintCells(cell, dims).every(c => !mapVoxelBlocksMovement(map, c) &&
    !map.stairs.some(s => s.x === c.x && s.y === c.y && s.z === c.z))
}

function cancelMoveAim() {
  if (movingParticipantId.value) movingParticipantId.value = null
  else if (props.gmMoveParticipantId) emit('movement-cancelled')
  clearMapGroup(hoverGhostGroup)
  hoveredMoveScreen.value = null
  emit('cell-hovered', null)
}
const areaHighlightCells = ref<Array<{ x: number; y: number; z: number }>>([])
let lastAoeKey = ''

const blastCenterY = ref<number>(0)
const blastLosBlocked = ref<boolean>(false)
const lastBlastCenter = ref<Vec3 | null>(null)
// Snapshot of the params last used to compute areaHighlightCells, for re-deriving the AoE later.
const lastAreaShapeData = ref<AreaShapeData | null>(null)
// Any area shape is being aimed (blast + the directional shapes that share the blast aimer).
const isAreaTargeting = computed(() =>
  !!props.selectedAttack && getAreaShape(props.selectedAttack.tags) !== null
)
// Shapes whose elevation is aimed with the scroll wheel (everything except omnidirectional burst).
const usesVerticalAim = computed(() => {
  const s = props.selectedAttack ? getAreaShape(props.selectedAttack.tags) : null
  return s !== null && s !== 'burst'
})
// Last mouse event used to aim a directional area shape — replayed on scroll to re-pitch.
let lastAreaAimEvent: MouseEvent | null = null

// [Pass] two-step aiming: step 1 picks direction + movement length (up to Movement stat),
// step 2 extends along the now-locked direction by extra movement (up to RAM stat).
const passStep = ref<'movement' | 'extra' | null>(null)
let passLockedDir: Vec3 | null = null
let passMovementLength = 0
// Whether the current Pass aim has a reachable valid finishing landing (see isPassLandingValid).
let passLandingValid = true


// ── Three.js internals ─────────────────────────────────────────────────────
let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let controls: OrbitControls
let rafId = 0
let canvasDisposed = false
let terrain: ReturnType<typeof createMapTerrainChunks> | null = null
let overlaysDirty = true
let highlightsDirty = true
let reticulesDirty = true
let pendingPointerEvent: MouseEvent | null = null
let structureSources: unknown[] = []
let blendTextureCache: Map<string, THREE.CanvasTexture> = new Map()
let occludeRaycaster: THREE.Raycaster
let spriteGroups: Map<string, THREE.Group>  // participantId → group
const borderMaterials = new Map<string, THREE.LineBasicMaterial>()  // participantId → volume-outline material
// Participant whose volume outline is tinted green because a click under the cursor would target it.
let hoveredTargetId: string | null = null
let buildMeshes: THREE.Object3D[] = []
let wallMeshes: Array<{ mesh: THREE.Mesh; wallId: string; cell: Vec3 }> = []
let doorMeshes = new Map<string, THREE.Mesh>()  // doorId → door panel
// Game-rules line of sight (single-target reticules + area shapes), rebuilt with the scene.
let losIndex: LosIndex | null = null
let reticuleGroup: THREE.Group
let aoeGroup: THREE.Group
let passRangeGroup: THREE.Group
let passLandingGroup: THREE.Group
let movementHighlightGroup: THREE.Group
let pathHighlightGroup: THREE.Group
let hoverGhostGroup: THREE.Group
type EditHit =
  | { type: 'cell'; cell: Vec3 }
  | { type: 'wall'; wallId: string; cell: Vec3 }
  | { type: 'wall-edge'; tile: Vec3; face: WallFace }
  | { type: 'voxel'; cell: Vec3 }
let dragStartHit: EditHit | null = null
let rightDragActive = false
let rightDragLastX = 0
let azimuthTween: { from: number; to: number; start: number; duration: number } | null = null
const AZIMUTH_STEP = Math.PI / 4      // Q/E turn size
const AZIMUTH_TWEEN_MS = 220
const keysHeld = new Set<string>()
const clipY = ref(20)
const ghostWalls = ref(false)
const TILE_SIZE = 1
// Shared with the line-of-sight model (utils/lineOfSight.ts) so targeting matches what's drawn.
const { TILE_H, WALL_H, WINDOW_H, WINDOW_FRAME } = MAP_GEOMETRY
// tileCount = tiles occupied (floor footprint + volume box)
// imageScale = visual portrait size in world units (tiny/small/medium share 1-tile space but smaller images)
function getSizeParams(size: DigimonSize, gig?: { width: number; height: number; depth: number } | null) {
  switch (size) {
    case 'tiny':     return { tileCount: 1, imageScale: 0.5 }
    case 'small':    return { tileCount: 1, imageScale: 0.7 }
    case 'large':    return { tileCount: 2, imageScale: 2.0 }
    case 'huge':     return { tileCount: 3, imageScale: 3.0 }
    case 'gigantic': return { tileCount: gig?.width ?? 4, imageScale: gig?.width ?? 4.0 }
    default:         return { tileCount: 1, imageScale: 1.0 }  // medium
  }
}

function getParticipantSize(participantId: string): DigimonSize {
  const p = props.participants.find(p => p.id === participantId)
  return p?.type === 'digimon' ? (props.digimonMap[p.entityId]?.size ?? 'medium') : 'medium'
}

// Full 3D footprint dimensions for a participant; tamers and unknowns are 1×1×1.
function getParticipantFootprintDims(participantId: string | null | undefined): FootprintDims {
  if (!participantId) return { width: 1, height: 1, depth: 1 }
  const p = props.participants.find(pp => pp.id === participantId)
  if (!p || p.type !== 'digimon') return { width: 1, height: 1, depth: 1 }
  const dg = props.digimonMap[p.entityId]
  if (!dg) return { width: 1, height: 1, depth: 1 }
  return getFootprintDimensions(dg.size, dg.giganticDimensions)
}

// True if any cell of the full 3D box anchored at `anchor` is in the area cell set.
function footprintIntersectsArea(anchor: Vec3, dims: FootprintDims, cellSet: Set<string>): boolean {
  for (const c of getFootprintCells(anchor, dims))
    if (cellSet.has(`${c.x},${c.y},${c.z}`)) return true
  return false
}

// True if an attacker's full 3D box anchored at `attackerAnchor` is within `maxDist`
// (Chebyshev) of a target's full 3D box anchored at `targetAnchor`, for any pair of cells.
function meleeInRange(attackerAnchor: Vec3, targetAnchor: Vec3, attackerDims: FootprintDims, targetDims: FootprintDims, maxDist: number): boolean {
  for (const a of getFootprintCells(attackerAnchor, attackerDims)) {
    for (const t of getFootprintCells(targetAnchor, targetDims)) {
      const d = Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y), Math.abs(a.z - t.z))
      if (d <= maxDist) return true
    }
  }
  return false
}

// True if a footprint of `dims` anchored at `anchor` would overlap any other participant's
// footprint (excluding `excludeId`, the unit being moved).
function footprintOccupied(anchor: Vec3, dims: FootprintDims, excludeId: string): boolean {
  const moverSize = getParticipantSize(excludeId)
  return props.participants.some(p => {
    if (p.id === excludeId) return false
    if (sizeInteraction(moverSize, getParticipantSize(p.id)) === 'shared') return false
    const oPos = props.participantPositions[p.id]
    if (!oPos) return false
    const oCellSet = new Set(getFootprintCells(oPos, getParticipantFootprintDims(p.id)).map(c => `${c.x},${c.y},${c.z}`))
    return footprintIntersectsArea(anchor, dims, oCellSet)
  })
}

// A [Pass] landing is valid if the attacker's footprint at `anchor` doesn't overlap any
// other participant except a Tiny pairing, and the anchor cell itself is supported terrain/voxel/stairs (or
// open air the attacker can fly in, or jump into from `attackerPos`).
function isPassLandingValid(anchor: Vec3, dims: FootprintDims, attackerId: string, caps: MovementCapabilities, attackerPos: Vec3): boolean {
  if (footprintOccupied(anchor, dims, attackerId)) return false
  if (!props.map) return true
  return canLandOn(anchor, caps, props.map, new Set(), attackerPos)
}

// Whether ANY ram value in [0, ramMax] yields a valid landing for this (attackerPos, dir,
// movement). If false, the aim is "filtered": no amount of RAM repositioning can produce a
// legal finish, so it cannot be locked in (step 1) or confirmed (step 2) — though the hit-area
// pillar computed from `movement` remains valid for targeting enemies caught in it.
function anyPassLandingValid(attackerPos: Vec3, dir: Vec3, movement: number, ramMax: number, dims: FootprintDims, attackerId: string, caps: MovementCapabilities): boolean {
  for (let ram = 0; ram <= ramMax; ram++) {
    if (isPassLandingValid(computePassLanding(attackerPos, dir, movement, ram), dims, attackerId, caps, attackerPos)) return true
  }
  return false
}

// Renders the [Pass] landing footprint: green if a valid finish is reachable from here
// (using RAM if needed), red if filtered (no amount of RAM lands clear).
function renderPassLandingMarker(anchor: Vec3, dims: FootprintDims, valid: boolean) {
  clearMapGroup(passLandingGroup)
  const color = valid ? 0x33ff66 : 0xff3300
  for (const c of getFootprintCells(anchor, dims)) {
    const geo = new THREE.BoxGeometry(TILE_SIZE, 0.05, TILE_SIZE)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(c.x + 0.5, c.y * TILE_SIZE + TILE_H + 0.04, c.z + 0.5)
    passLandingGroup.add(mesh)
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(() => {
  initScene()
  buildMap()
  buildSprites()
  requestRender()

  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', queueKeyDown)
  window.addEventListener('keyup', onKeyUp)
  // Capture phase: must run before OrbitControls' own (bubble-phase) pointerdown so a token press
  // can switch the camera controls off before they start panning.
  canvasRef.value!.addEventListener('pointerdown', onTokenPointerDown, { capture: true })
  window.addEventListener('pointermove', onTokenPointerMove)
  window.addEventListener('pointerup', onTokenPointerUp)
  window.addEventListener('pointercancel', onTokenPointerCancel)
  canvasRef.value!.addEventListener('click', e => { onCanvasClick(e); invalidateFrame() })
  canvasRef.value!.addEventListener('mousemove', queueMouseMove)
  canvasRef.value!.addEventListener('mousedown', e => { onMouseDown(e); invalidateFrame() })
  canvasRef.value!.addEventListener('mouseup', e => { onMouseUp(e); invalidateFrame() })
  canvasRef.value!.addEventListener('mouseleave', onCanvasLeave)
  canvasRef.value!.addEventListener('contextmenu', e => e.preventDefault())
  // Capture before OrbitControls so aiming and ramp rotation consume the wheel without zooming.
  canvasRef.value!.addEventListener('wheel', queueCanvasWheel, { passive: false, capture: true })
})

onUnmounted(() => {
  canvasDisposed = true
  cancelAnimationFrame(rafId)
  rafId = 0
  pendingPointerEvent = null
  clearAoeHighlights()
  terrain?.dispose()
  disposeMapObjects(buildMeshes)
  for (const group of spriteGroups.values()) disposeMapObjects([group])
  for (const group of [hoverGhostGroup, movementHighlightGroup, pathHighlightGroup, reticuleGroup, passRangeGroup, passLandingGroup]) if (group) clearMapGroup(group)
  controls?.dispose()
  renderer?.dispose()
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', queueKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  canvasRef.value?.removeEventListener('pointerdown', onTokenPointerDown, { capture: true })
  canvasRef.value?.removeEventListener('wheel', queueCanvasWheel, { capture: true })
  window.removeEventListener('pointermove', onTokenPointerMove)
  window.removeEventListener('pointerup', onTokenPointerUp)
  window.removeEventListener('pointercancel', onTokenPointerCancel)
  tokenDrag.dispose()
  for (const tex of blendTextureCache.values()) tex.dispose()
  blendTextureCache.clear()
})

// ── Scene init ─────────────────────────────────────────────────────────────
function initScene() {
  const canvas = canvasRef.value!
  const container = containerRef.value!
  radialBounds.value = { width: container.clientWidth, height: container.clientHeight }

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.shadowMap.enabled = true

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.04)

  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 500)
  const cx = (props.map?.dimensions.width ?? 20) / 2
  const cz = (props.map?.dimensions.depth ?? 20) / 2
  camera.position.set(cx + 15, 18, cz + 15)
  camera.lookAt(cx, 0, cz)

  controls = new OrbitControls(camera, canvas)
  controls.enablePan = true
  controls.enableZoom = true
  controls.minPolarAngle = Math.PI / 3
  controls.maxPolarAngle = Math.PI / 3
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: undefined as any }
  controls.screenSpacePanning = false
  controls.target.set(cx, 0, cz)
  controls.update()
  controls.addEventListener('change', () => { overlaysDirty = true; requestRender(); emit('map-changed') })

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.55)
  scene.add(ambient)
  const sun = new THREE.DirectionalLight(0xffffff, 0.85)
  sun.position.set(30, 40, 20)
  sun.castShadow = true
  scene.add(sun)

  // Groups
  reticuleGroup = new THREE.Group()
  aoeGroup = new THREE.Group()
  passRangeGroup = new THREE.Group()
  passLandingGroup = new THREE.Group()
  movementHighlightGroup = new THREE.Group()
  pathHighlightGroup = new THREE.Group()
  hoverGhostGroup = new THREE.Group()
  scene.add(reticuleGroup, aoeGroup, passRangeGroup, movementHighlightGroup, pathHighlightGroup, hoverGhostGroup, passLandingGroup)

  spriteGroups = new Map()
  occludeRaycaster = new THREE.Raycaster()
  occludeRaycaster.near = 0.1

}

// ── Camera azimuth: free right-drag rotation + eased Q/E steps ──────────────
function setAzimuth(angle: number) {
  const dist = camera.position.distanceTo(controls.target)
  const polar = controls.getPolarAngle()
  camera.position.setFromSpherical(new THREE.Spherical(dist, polar, angle)).add(controls.target)
  controls.update()
}

// Right-drag rotates continuously — a full turn per viewport width, matching
// OrbitControls' own rotate speed. Dragging cancels any in-flight Q/E turn.
function applyRightDragRotation(dx: number) {
  const width = containerRef.value?.clientWidth || 1
  if (dx === 0) return
  azimuthTween = null
  setAzimuth(controls.getAzimuthalAngle() - (2 * Math.PI * dx) / width)
}

// Q/E turn to the next 45° multiple, eased rather than jumping. Chained
// presses queue off the pending target so repeats stay evenly spaced.
function stepAzimuth(delta: number) {
  const from = azimuthTween ? azimuthTween.to : controls.getAzimuthalAngle()
  const to = Math.round((from + delta) / AZIMUTH_STEP) * AZIMUTH_STEP
  azimuthTween = { from, to, start: performance.now(), duration: AZIMUTH_TWEEN_MS }
}

function tickAzimuthTween() {
  if (!azimuthTween) return
  const { from, to, start, duration } = azimuthTween
  const t = Math.min(1, (performance.now() - start) / duration)
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2   // easeInOutQuad
  setAzimuth(from + (to - from) * eased)
  if (t >= 1) azimuthTween = null
}

// ── Element blend texture ──────────────────────────────────────────────────
function makeBlendTexture(center: number, n?: number, s?: number, e?: number, w?: number): THREE.CanvasTexture {
  const key = `${center}:${n}:${s}:${e}:${w}`
  if (blendTextureCache.has(key)) return blendTextureCache.get(key)!

  const SIZE = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const toCSS = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`

  // Start fully transparent — only edge strips are painted
  ctx.clearRect(0, 0, SIZE, SIZE)

  const B = SIZE * 0.2  // blend zone: 20% of tile width from each edge
  const edges = [
    { color: n, x1: 0,    y1: 0,    x2: 0,        y2: B,        rx: 0,        ry: 0,        rw: SIZE, rh: B },
    { color: s, x1: 0,    y1: SIZE, x2: 0,        y2: SIZE - B, rx: 0,        ry: SIZE - B, rw: SIZE, rh: B },
    { color: w, x1: 0,    y1: 0,    x2: B,        y2: 0,        rx: 0,        ry: 0,        rw: B,    rh: SIZE },
    { color: e, x1: SIZE, y1: 0,    x2: SIZE - B, y2: 0,        rx: SIZE - B, ry: 0,        rw: B,    rh: SIZE },
  ]
  for (const edge of edges) {
    if (!edge.color || edge.color === center) continue
    const grad = ctx.createLinearGradient(edge.x1, edge.y1, edge.x2, edge.y2)
    grad.addColorStop(0, toCSS(edge.color) + '60')
    grad.addColorStop(1, toCSS(edge.color) + '00')
    ctx.fillStyle = grad
    ctx.fillRect(edge.rx, edge.ry, edge.rw, edge.rh)
  }

  const tex = new THREE.CanvasTexture(canvas)
  blendTextureCache.set(key, tex)
  return tex
}

// ── Map building ───────────────────────────────────────────────────────────
function releaseBlendTexture(texture: THREE.Texture) {
  for (const [key, cached] of blendTextureCache) if (cached === texture) blendTextureCache.delete(key)
  texture.dispose()
}

function buildMap() {
  losIndex = null
  if (!props.map) {
    terrain?.dispose(); terrain = null
    disposeMapObjects(buildMeshes)
    for (const object of buildMeshes) scene.remove(object)
    buildMeshes = []; wallMeshes = []; doorMeshes.clear(); structureSources = []
    invalidateFrame()
    return
  }
  const map = props.map
  const destroyedIds = new Set((props.destructibleStates ?? []).filter(s => s.currentWounds <= 0).map(s => s.structureId))

  if (!terrain) terrain = createMapTerrainChunks({ scene, tileHeight: TILE_H, makeBlendTexture, releaseBlendTexture })
  terrain.sync(map, { clipY: clipY.value, showSpawnIndicators: props.showSpawnIndicators !== false })
  const sources = [map.walls, map.windows, map.doors, map.ceilings, map.stairs, JSON.stringify(props.destructibleStates)]
  if (sources.every((source, i) => source === structureSources[i])) {
    lastAttackKey = ''
    invalidateFrame()
    return
  }
  structureSources = sources
  disposeMapObjects(buildMeshes)
  for (const object of buildMeshes) scene.remove(object)
  buildMeshes = []
  wallMeshes = []
  doorMeshes = new Map()
  highlightedDoorId = null

  // Walls — frame-only when a window or door is present
  const walledWindowIds = new Set(map.windows.map(w => w.wallId))
  const walledDoorIds   = new Set(map.doors.map(d => d.wallId))
  const { DOOR_H, DOOR_W, PILLAR_W } = MAP_GEOMETRY
  const DOOR_HDR = WALL_H - DOOR_H               // 0.1

  function addWallMesh(geo: THREE.BoxGeometry, mat: THREE.MeshLambertMaterial, wx: number, wy: number, wz: number, wallId: string, dx: number, dy: number, dz: number) {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(wx + dx, wy * TILE_SIZE + dy, wz + dz)
    m.userData = { type: 'wall', id: wallId, floorY: wy }
    scene.add(m)
    buildMeshes.push(m)
    return m
  }

  for (const wall of map.walls) {
    if (destroyedIds.has(wall.id)) continue
    const isNS = wall.face === 'north' || wall.face === 'south'
    const state = props.destructibleStates.find(s => s.structureId === wall.id)
    const woundPct = wall.woundBoxes !== undefined && state ? state.currentWounds / wall.woundBoxes : 1
    const color = wall.woundBoxes !== undefined
      ? new THREE.Color().setHSL(woundPct * 0.33, 0.8, 0.4)
      : new THREE.Color(0x556677)
    const mat = new THREE.MeshLambertMaterial({ color })
    const xOff = wall.face === 'east' ? 1 : wall.face === 'west' ? 0 : 0.5
    const zOff = wall.face === 'south' ? 1 : wall.face === 'north' ? 0 : 0.5
    const D = MAP_GEOMETRY.WALL_D  // wall depth

    if (walledWindowIds.has(wall.id)) {
      // Sill (bottom strip)
      const sillGeo = isNS ? new THREE.BoxGeometry(TILE_SIZE, WINDOW_FRAME, D) : new THREE.BoxGeometry(D, WINDOW_FRAME, TILE_SIZE)
      const sill = addWallMesh(sillGeo, mat, wall.x, wall.y, wall.z, wall.id, xOff, WINDOW_FRAME / 2, zOff)
      wallMeshes.push({ mesh: sill, wallId: wall.id, cell: { x: wall.x, y: wall.y, z: wall.z } })
      // Header (top strip)
      const hdrGeo = isNS ? new THREE.BoxGeometry(TILE_SIZE, WINDOW_FRAME, D) : new THREE.BoxGeometry(D, WINDOW_FRAME, TILE_SIZE)
      addWallMesh(hdrGeo, mat, wall.x, wall.y, wall.z, wall.id, xOff, WINDOW_FRAME + WINDOW_H + WINDOW_FRAME / 2, zOff)
    } else if (walledDoorIds.has(wall.id)) {
      // Left pillar
      if (isNS) {
        const pilGeo = new THREE.BoxGeometry(PILLAR_W, WALL_H, D)
        const leftPillar = addWallMesh(pilGeo, mat, wall.x, wall.y, wall.z, wall.id, xOff - DOOR_W / 2 - PILLAR_W / 2, WALL_H / 2, zOff)
        wallMeshes.push({ mesh: leftPillar, wallId: wall.id, cell: { x: wall.x, y: wall.y, z: wall.z } })
        addWallMesh(new THREE.BoxGeometry(PILLAR_W, WALL_H, D), mat, wall.x, wall.y, wall.z, wall.id, xOff + DOOR_W / 2 + PILLAR_W / 2, WALL_H / 2, zOff)
        if (DOOR_HDR > 0) addWallMesh(new THREE.BoxGeometry(DOOR_W, DOOR_HDR, D), mat, wall.x, wall.y, wall.z, wall.id, xOff, DOOR_H + DOOR_HDR / 2, zOff)
      } else {
        const pilGeo = new THREE.BoxGeometry(D, WALL_H, PILLAR_W)
        const leftPillar = addWallMesh(pilGeo, mat, wall.x, wall.y, wall.z, wall.id, xOff, WALL_H / 2, zOff - DOOR_W / 2 - PILLAR_W / 2)
        wallMeshes.push({ mesh: leftPillar, wallId: wall.id, cell: { x: wall.x, y: wall.y, z: wall.z } })
        addWallMesh(new THREE.BoxGeometry(D, WALL_H, PILLAR_W), mat, wall.x, wall.y, wall.z, wall.id, xOff, WALL_H / 2, zOff + DOOR_W / 2 + PILLAR_W / 2)
        if (DOOR_HDR > 0) addWallMesh(new THREE.BoxGeometry(D, DOOR_HDR, DOOR_W), mat, wall.x, wall.y, wall.z, wall.id, xOff, DOOR_H + DOOR_HDR / 2, zOff)
      }
    } else {
      // Plain wall — full mesh
      const geo = isNS ? new THREE.BoxGeometry(TILE_SIZE, WALL_H, D) : new THREE.BoxGeometry(D, WALL_H, TILE_SIZE)
      const mesh = addWallMesh(geo, mat, wall.x, wall.y, wall.z, wall.id, xOff, WALL_H / 2, zOff)
      wallMeshes.push({ mesh, wallId: wall.id, cell: { x: wall.x, y: wall.y, z: wall.z } })
    }
  }

  // Windows — glass panel in the opening
  for (const win of map.windows) {
    if (destroyedIds.has(win.id)) continue
    const wall = map.walls.find(w => w.id === win.wallId)
    if (!wall) continue
    const isNS = wall.face === 'north' || wall.face === 'south'
    const geo = isNS ? new THREE.BoxGeometry(TILE_SIZE, WINDOW_H, 0.05) : new THREE.BoxGeometry(0.05, WINDOW_H, TILE_SIZE)
    const mat = new THREE.MeshLambertMaterial({ color: 0x88ccff, transparent: true, opacity: 0.45, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    const xOff = wall.face === 'east' ? 1 : wall.face === 'west' ? 0 : 0.5
    const zOff = wall.face === 'south' ? 1 : wall.face === 'north' ? 0 : 0.5
    mesh.position.set(wall.x + xOff, wall.y * TILE_SIZE + WINDOW_FRAME + WINDOW_H / 2, wall.z + zOff)
    mesh.userData = { floorY: wall.y }
    scene.add(mesh)
    buildMeshes.push(mesh)
  }

  // Doors — panel sized to opening
  for (const door of map.doors) {
    const wall = map.walls.find(w => w.id === door.wallId)
    if (!wall) continue
    const isNS = wall.face === 'north' || wall.face === 'south'
    const PANEL_D = 0.08
    const geo = isNS ? new THREE.BoxGeometry(DOOR_W, DOOR_H, PANEL_D) : new THREE.BoxGeometry(PANEL_D, DOOR_H, DOOR_W)
    const mat = new THREE.MeshLambertMaterial({ color: door.isOpen ? 0x886644 : 0x553311 })
    const mesh = new THREE.Mesh(geo, mat)
    const xOff = wall.face === 'east' ? 1 : wall.face === 'west' ? 0 : 0.5
    const zOff = wall.face === 'south' ? 1 : wall.face === 'north' ? 0 : 0.5
    const py = wall.y * TILE_SIZE + DOOR_H / 2
    if (door.isOpen) {
      // Swung 90° on its hinge jamb into the wall's own cell, leaving the doorway clear.
      const hinge = PILLAR_W + PANEL_D / 2   // along the wall, from the cell's min-x/min-z edge
      const into = DOOR_W / 2                // away from the wall plane, into the cell
      mesh.rotation.y = Math.PI / 2
      if (isNS) mesh.position.set(wall.x + hinge, py, wall.z + zOff + (wall.face === 'north' ? into : -into))
      else mesh.position.set(wall.x + xOff + (wall.face === 'west' ? into : -into), py, wall.z + hinge)
    } else {
      mesh.position.set(wall.x + xOff, py, wall.z + zOff)
    }
    mesh.userData = { type: 'door', id: door.id, floorY: wall.y }
    scene.add(mesh)
    buildMeshes.push(mesh)
    doorMeshes.set(door.id, mesh)
  }

  // Ceilings
  for (const ceiling of map.ceilings) {
    if (destroyedIds.has(ceiling.id)) continue
    const geo = new THREE.BoxGeometry(TILE_SIZE, MAP_GEOMETRY.CEILING_H, TILE_SIZE)
    const state = props.destructibleStates.find(s => s.structureId === ceiling.id)
    const woundPct = ceiling.woundBoxes !== undefined && state ? state.currentWounds / ceiling.woundBoxes : 1
    const color = new THREE.Color().setHSL(woundPct * 0.25, 0.5, 0.45)
    const mat = new THREE.MeshLambertMaterial({ color })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(ceiling.x + 0.5, ceiling.y * TILE_SIZE + TILE_SIZE + MAP_GEOMETRY.CEILING_H / 2, ceiling.z + 0.5)
    mesh.userData = { type: 'ceiling', id: ceiling.id, floorY: ceiling.y }
    scene.add(mesh)
    buildMeshes.push(mesh)
  }

  // Stairs and their drawing preview share exactly the same three-step geometry.
  for (const stair of map.stairs) {
    const mesh = new THREE.Mesh(createStairGeometry(stairDirectionForFace(stair.face)), new THREE.MeshLambertMaterial({ color: 0x887766 }))
    mesh.position.set(stair.x + 0.5, stair.y * TILE_SIZE + 0.5, stair.z + 0.5)
    mesh.userData = { floorY: stair.y }
    scene.add(mesh)
    buildMeshes.push(mesh)
  }

  // Apply current clip and ghost state after full rebuild
  for (const obj of buildMeshes) {
    const fY = (obj as any).userData?.floorY
    if (fY !== undefined) obj.visible = fY <= clipY.value
  }
  if (ghostWalls.value) {
    for (const obj of buildMeshes) {
      const type = (obj as any).userData?.type
      if (type !== 'wall' && type !== 'ceiling') continue
      const mat = (obj as THREE.Mesh).material as THREE.MeshLambertMaterial
      if (!mat) continue
      mat.transparent = true
      mat.opacity = 0.2
      mat.needsUpdate = true
    }
  }

  // Built from map data (not meshes), so the Y-clip/ghost view aids never change targeting.
  lastAttackKey = ''  // re-check reticules against the new geometry (doors, edits)
  invalidateFrame()
}

// ── Character footprints + HTML token overlays ───────────────────────────────

const characterOverlays = ref<Record<string, { x: number; y: number; w: number; h: number; spriteUrl: string | null; initial: string; stance: Stance; zIndex: number; woundFilter: 'yellow' | 'red' | null }>>({})
const reticuleParticipantIds = ref<string[]>([])

function buildSprites() {
  for (const [, group] of spriteGroups) { scene.remove(group); disposeMapObjects([group]) }
  spriteGroups.clear()
  borderMaterials.clear()

  for (const p of props.participants) {
    const pos = props.participantPositions[p.id]
    if (!pos) continue

    const size: DigimonSize = p.type === 'digimon' ? (props.digimonMap[p.entityId]?.size ?? 'medium') : 'medium'
    const gig = p.type === 'digimon' ? props.digimonMap[p.entityId]?.giganticDimensions : null
    const { tileCount } = getSizeParams(size, gig)

    const footprint = tileCount * TILE_SIZE
    const centerOffset = (tileCount - 1) * 0.5

    const group = new THREE.Group()
    group.position.set(pos.x + 0.5 + centerOffset, pos.y * TILE_SIZE + TILE_H + 0.005, pos.z + 0.5 + centerOffset)
    group.userData = { participantId: p.id }

    const charHeight = tileCount * TILE_SIZE

    // Floor shadow disc
    const shadowGeo = new THREE.CircleGeometry(footprint * 0.42, 24)
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat)
    shadowMesh.rotation.x = -Math.PI / 2
    group.add(shadowMesh)

    // Invisible volume hitbox — makes the character clickable from any angle
    const hitboxGeo = new THREE.BoxGeometry(footprint * 0.9, charHeight, footprint * 0.9)
    const hitboxMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
    const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat)
    hitboxMesh.position.y = charHeight / 2
    hitboxMesh.userData = { type: 'sprite', participantId: p.id }
    group.add(hitboxMesh)

    // Occupied volume outline
    const borderEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(footprint * 0.92, charHeight, footprint * 0.92))
    const borderMat = new THREE.LineBasicMaterial({ color: participantBorderColor(p.id), depthTest: false })
    borderMaterials.set(p.id, borderMat)
    const borderLines = new THREE.LineSegments(borderEdges, borderMat)
    borderLines.position.y = charHeight / 2
    group.add(borderLines)

    scene.add(group)
    spriteGroups.set(p.id, group)
  }
}

// Volume-outline color: green while hovered as a valid target, red while targetable (has a reticule),
// orange for whose turn it is.
function participantBorderColor(participantId: string): number {
  if (participantId === hoveredTargetId) return 0x33ff66
  if (reticuleParticipantIds.value.includes(participantId)) return 0xff2222
  const isActive = participantId === props.activeParticipantId || participantId === props.secondaryActiveParticipantId
  return isActive ? 0xff8800 : 0x334466
}

// Moves the green hover outline to `participantId` (null clears it), recoloring only the two affected outlines.
function setHoveredTarget(participantId: string | null) {
  if (participantId === hoveredTargetId) return
  const prev = hoveredTargetId
  hoveredTargetId = participantId
  for (const id of [prev, participantId]) {
    if (id) borderMaterials.get(id)?.color.setHex(participantBorderColor(id))
  }
}

// Re-applies participantBorderColor to every outline (e.g. when the targetable set changes).
function refreshBorderColors() {
  for (const [id, mat] of borderMaterials) mat.color.setHex(participantBorderColor(id))
}

function updateCharacterOverlays() {
  const overlays: typeof characterOverlays.value = {}
  const wallOccluders = wallMeshes.filter(w => w.mesh.visible).map(w => w.mesh)
  const wallByMesh = new Map(wallMeshes.map(entry => [entry.mesh, entry]))
  const windowWallIds = new Set((props.map?.windows ?? []).map(w => w.wallId))

  // Camera right vector from world matrix column 0 — used to measure footprint
  // width in screen space the same way Three.js measures the 3D shadow disc.
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)

  for (const p of props.participants) {
    const pos = props.participantPositions[p.id]
    if (!pos) continue
    const info = p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId]
    const size: DigimonSize = p.type === 'digimon' ? (props.digimonMap[p.entityId]?.size ?? 'medium') : 'medium'
    const gig = p.type === 'digimon' ? props.digimonMap[p.entityId]?.giganticDimensions : null
    const { tileCount, imageScale } = getSizeParams(size, gig)
    const centerOffset = (tileCount - 1) * 0.5
    const cx = pos.x + 0.5 + centerOffset
    const cz = pos.z + 0.5 + centerOffset

    const charHeight = tileCount * TILE_SIZE
    const charMidY   = pos.y * TILE_SIZE + TILE_H + charHeight * 0.5
    const center     = new THREE.Vector3(cx, charMidY, cz)
    const distToChar = camera.position.distanceTo(center)

    // Occlusion: raycast camera → character mid-body, skip if any wall blocks.
    // Ghost Walls mode disables occlusion so tokens show through walls.
    if (!ghostWalls.value) {
      const dir        = center.clone().sub(camera.position).normalize()
      const occRay = occludeRaycaster
      occRay.set(camera.position, dir)
      occRay.near = 0
      occRay.far = distToChar - 0.1
      // Raycasting ignores Object3D.visible, so clipped-away geometry must be excluded by hand.
      const hits = occRay.intersectObjects(wallOccluders, false)
      const isOccluded = Boolean(terrain?.isOccluded(occRay)) || hits.some(hit => {
        const entry = wallByMesh.get(hit.object as THREE.Mesh)
        if (!entry) return true
        if (!windowWallIds.has(entry.wallId)) return true
        const floorY = entry.cell.y * TILE_SIZE
        const hitY   = hit.point.y
        if (hitY >= floorY + WINDOW_FRAME && hitY <= floorY + WINDOW_FRAME + WINDOW_H) return false
        return true
      })
      if (isOccluded) continue
    }

    const edge = center.clone().addScaledVector(camRight, imageScale * 0.45)
    const sc   = worldToScreen2D(center)
    const se   = worldToScreen2D(edge)
    if (!sc || !se) continue

    const screenRadius = Math.hypot(se.x - sc.x, se.y - sc.y)
    const h = Math.max(16, screenRadius * 2)

    const anyP = p as any
    const maxWounds = anyP.maxWounds ?? info?.woundBoxes ?? 0
    const currentWounds = anyP.currentWounds ?? info?.currentWounds ?? 0
    const remainingPct = maxWounds > 0 ? Math.max(0, 1 - currentWounds / maxWounds) : 1
    const woundFilter: 'yellow' | 'red' | null =
      remainingPct <= 0.25 ? 'red' : remainingPct <= 0.5 ? 'yellow' : null

    overlays[p.id] = {
      x: sc.x,
      y: sc.y - h / 2,
      w: h,
      h,
      spriteUrl: info?.spriteUrl ?? null,
      initial: (info?.name ?? '?')[0],
      stance: p.currentStance,
      zIndex: Math.round(1_000_000 - distToChar * 1000),
      woundFilter,
    }
  }
  characterOverlays.value = overlays
  updateMovementGhostOverlay()
}

function updateMovementGhostOverlay() {
  movementGhostOverlay.value = null
  movementGapLabel.value = null
  const ghost = movementGhost.value
  if (!ghost || getMoveAim()?.participantId !== ghost.participantId) return
  const participant = props.participants.find(participant => participant.id === ghost.participantId)
  if (!participant) return
  const info = participant.type === 'tamer' ? props.tamerMap[participant.entityId] : props.digimonMap[participant.entityId]
  const { imageScale } = getSizeParams(getParticipantSize(participant.id), participant.type === 'digimon' ? props.digimonMap[participant.entityId]?.giganticDimensions : undefined)
  const dims = getParticipantFootprintDims(participant.id)
  const center = movementPreviewCenter(ghost.cell, dims, dims.height * TILE_SIZE / 2)
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const screen = worldToScreen2D(center)
  const edge = worldToScreen2D(center.clone().addScaledVector(right, imageScale * 0.45))
  if (!screen || !edge) return
  const h = Math.max(16, Math.hypot(edge.x - screen.x, edge.y - screen.y) * 2)
  movementGhostOverlay.value = { x: screen.x, y: screen.y - h / 2, h, spriteUrl: info?.spriteUrl ?? null,
    initial: (info?.name ?? '?')[0]!, stance: participant.currentStance ?? 'neutral', valid: ghost.valid }
  const ground = movementGroundBelow(movementGroundIndex.value, ghost.cell, dims)
  if (ground !== null && ground >= ghost.cell.y) return
  const label = worldToScreen2D(movementPreviewCenter(ghost.cell, dims, ground === null ? -0.3 : -(ghost.cell.y - ground) * TILE_SIZE / 2))
  if (label) movementGapLabel.value = { ...label, text: ground === null ? 'No ground below' : `${ghost.cell.y - ground} m gap` }
}

function renderMovementGap(cell: Vec3, dims: FootprintDims) {
  const ground = movementGroundBelow(movementGroundIndex.value, cell, dims)
  if (ground === null || ground >= cell.y) return
  const top = movementPreviewCenter(cell, dims, 0.005)
  const bottom = top.clone()
  bottom.y = ground * TILE_SIZE + TILE_H + 0.005
  const geometry = new THREE.BufferGeometry().setFromPoints([top, bottom])
  const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0x8edbff, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }))
  line.computeLineDistances()
  hoverGhostGroup.add(line)
}

// Share the portrait's projected center, including large-token footprints and camera zoom.
function updateRadialScreen() {
  const choice = participantChoice.value
  participantChoiceScreen.value = choice ? worldToScreen2D(new THREE.Vector3(choice.point.x, choice.point.y, choice.point.z)) : null
  const id = radialParticipantId.value
  const overlay = id ? characterOverlays.value[id] : null
  const screen = overlay ? { x: overlay.x, y: overlay.y + overlay.h / 2 } : null
  npcRadialScreen.value = npcRadialId.value ? screen : null
  playerRadialScreen.value = playerRadialId.value ? screen : null
  gmRadialScreen.value = gmRadialId.value ? screen : null
}

// GM free-move: close the GM radial and tell the parent to enter reposition mode for `id`.
function gmMove(id: string) {
  closeRadial()
  emit('gm-move', id)
}

function playerRadialAction(action: 'move' | 'attack' | 'direct' | 'special-order' | 'stance' | 'digivolve' | 'mode-change' | 'clash' | ClashRadialAction) {
  if (!playerRadialId.value) return
  const id = playerRadialId.value
  closeRadial()
  emit('player-action', id, action)
}

// Tints the door a radial door button refers to, so neighbouring doors can be told apart.
let highlightedDoorId: string | null = null
function highlightDoor(doorId: string | null) {
  const tint = (id: string | null, hex: number) => {
    const mat = id ? doorMeshes.get(id)?.material : undefined
    if (mat instanceof THREE.MeshLambertMaterial) mat.emissive.setHex(hex)
  }
  tint(highlightedDoorId, 0x000000)
  highlightedDoorId = doorId
  tint(doorId, 0x664400)
  requestRender()
}

// Open/close a door from the radial (a free action), then close the radial like any other action.
function radialToggleDoor(doorId: string, isOpen: boolean) {
  closeRadial()
  emit('door-toggle', doorId, isOpen)
}

// ── Animation loop ─────────────────────────────────────────────────────────
function applyKeyMovement() {
  if (!keysHeld.size) return
  const speed = 0.12
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  forward.y = 0
  forward.normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
  const move = new THREE.Vector3()
  if (keysHeld.has('w') || keysHeld.has('W') || keysHeld.has('ArrowUp'))    move.addScaledVector(forward,  speed)
  if (keysHeld.has('s') || keysHeld.has('S') || keysHeld.has('ArrowDown'))  move.addScaledVector(forward, -speed)
  if (keysHeld.has('a') || keysHeld.has('A') || keysHeld.has('ArrowLeft'))  move.addScaledVector(right,   -speed)
  if (keysHeld.has('d') || keysHeld.has('D') || keysHeld.has('ArrowRight')) move.addScaledVector(right,    speed)
  if (keysHeld.has('z') || keysHeld.has('Z')) move.y -= speed
  if (keysHeld.has('x') || keysHeld.has('X')) move.y += speed
  if (move.lengthSq() === 0) return
  controls.target.add(move)
  camera.position.add(move)
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  if (e.key === 'Escape') {
    if (tokenDrag.abort()) return   // Esc ends a token drag in progress
    if (radialParticipantId.value || participantChoice.value) { closeRadial(); return }
    if (getMoveAim()) { cancelMoveAim(); return }
    if (areaHighlightCells.value.length > 0 || props.selectedAttack) { clearAoeState(); emit('attack-cancelled'); return }
  }
  if (e.key === 'q' || e.key === 'Q') { stepAzimuth(-AZIMUTH_STEP); return }
  if (e.key === 'e' || e.key === 'E') { stepAzimuth(+AZIMUTH_STEP); return }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault()
  keysHeld.add(e.key)
}

function onKeyUp(e: KeyboardEvent) {
  keysHeld.delete(e.key)
}

function requestRender() {
  if (canvasDisposed || !renderer || rafId) return
  rafId = requestAnimationFrame(animate)
}

function invalidateFrame() {
  overlaysDirty = true
  highlightsDirty = true
  reticulesDirty = true
  requestRender()
}

function queueMouseMove(event: MouseEvent) {
  pendingPointerEvent = event
  requestRender()
}

function onCanvasLeave() {
  pendingPointerEvent = null
  setHoveredTarget(null)
  if (!tokenDrag.isPressed()) {
    clearMapGroup(hoverGhostGroup)
    movementGhost.value = null
    movementGhostOverlay.value = null
    movementGapLabel.value = null
    hoveredMoveScreen.value = null
  }
  requestRender()
}

function queueCanvasWheel(event: WheelEvent) {
  onCanvasWheel(event)
  invalidateFrame()
}

function queueKeyDown(event: KeyboardEvent) {
  onKeyDown(event)
  requestRender()
}

function animate() {
  rafId = 0
  applyKeyMovement()
  tickAzimuthTween()
  controls.update()
  if (pendingPointerEvent) {
    const event = pendingPointerEvent
    pendingPointerEvent = null
    onMouseMove(event)
    reticulesDirty = true
  }
  if (pendingMovePos.value && overlaysDirty) {
    const v = new THREE.Vector3(pendingMovePos.value.x + 0.5, pendingMovePos.value.y + 1.5, pendingMovePos.value.z + 0.5)
    movePendingScreen.value = worldToScreen2D(v) ?? movePendingScreen.value
  }
  if (overlaysDirty) {
    overlaysDirty = false
    updateCharacterOverlays()
  }
  updateRadialScreen()
  if (highlightsDirty) {
    highlightsDirty = false
    updateMovementHighlights()
    updatePathHighlights()
  }
  if (reticulesDirty) {
    reticulesDirty = false
    updateReticules()
  }
  renderer.render(scene, camera)
  if (keysHeld.size || azimuthTween) requestRender()
}

function worldToScreen2D(v: THREE.Vector3): { x: number; y: number } | null {
  const container = containerRef.value
  if (!container) return null
  const projected = v.clone().project(camera)
  return {
    x: (projected.x + 1) / 2 * container.clientWidth,
    y: -(projected.y - 1) / 2 * container.clientHeight,
  }
}

// ── Movement highlights ────────────────────────────────────────────────────
let lastReachableKey = ''
function updateMovementHighlights() {
  const yFilter = movingParticipantId.value !== null ? npcMoveY.value : null
  const key = Array.from(props.reachableCells).sort().join('|') + (yFilter !== null ? `|y:${yFilter}` : '')
  if (key === lastReachableKey) return
  lastReachableKey = key

  clearMapGroup(movementHighlightGroup)
  for (const k of props.reachableCells) {
    const [x, y, z] = k.split(',').map(Number)
    if (yFilter !== null && y !== yFilter) continue
    const geo = new THREE.BoxGeometry(TILE_SIZE, 0.05, TILE_SIZE)
    const mat = new THREE.MeshBasicMaterial({ color: 0x2255ff, transparent: true, opacity: 0.35 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x + 0.5, y * TILE_SIZE + TILE_H + 0.02, z + 0.5)
    movementHighlightGroup.add(mesh)
  }
}

let lastPathKey = ''
// Paths store the footprint's minimum corner; previews follow the mover's center.
function movementPreviewCenter(anchor: Vec3, dims: FootprintDims, elevation: number): THREE.Vector3 {
  return new THREE.Vector3(anchor.x + dims.width / 2, anchor.y * TILE_SIZE + TILE_H + elevation, anchor.z + dims.depth / 2)
}

function updatePathHighlights() {
  const dims = getParticipantFootprintDims(movingParticipantId.value)
  const key = `${movingParticipantId.value}:${dims.width},${dims.height},${dims.depth}|` + props.activePath.map(v => vec3Key(v)).join('|')
  if (key === lastPathKey) return
  lastPathKey = key

  clearMapGroup(pathHighlightGroup)
  for (const v of props.activePath) {
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.6, 0.06, TILE_SIZE * 0.6)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.7 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(movementPreviewCenter(v, dims, 0.03))
    pathHighlightGroup.add(mesh)
  }
}

let lastAttackKey = ''
function updateReticules() {
  const aoeActive = areaHighlightCells.value.length > 0
  const attackerPos = effectiveAttackerId.value ? props.participantPositions[effectiveAttackerId.value] : null
  const attackerPosKey = attackerPos ? `${attackerPos.x},${attackerPos.y},${attackerPos.z}` : 'none'
  const key = [
    props.selectedAttack ? JSON.stringify(props.selectedAttack) : '',
    effectiveAttackerId.value ?? '',
    attackerPosKey,
    props.attackerEffectiveLimit,
    props.attackerRange,
    props.attackerMeleeRange,
    props.chargeMode,
    'aoe:' + (aoeActive ? lastAoeKey : ''),
    'area:' + isAreaTargeting.value,
    'selectable:' + (props.selectableParticipantIds?.join(',') ?? ''),
  ].join('|')
  if (key === lastAttackKey) return
  lastAttackKey = key

  clearMapGroup(reticuleGroup)
  const ids: string[] = []

  if (!props.selectedAttack || !attackerPos) {
    reticuleParticipantIds.value = props.selectableParticipantIds?.slice() ?? []
    return
  }

  const isMelee = props.selectedAttack.range === 'melee'
  const maxDist = isMelee ? props.attackerMeleeRange : props.attackerEffectiveLimit
  const isAreaAttack = props.selectedAttack.tags?.some((t: string) => t.startsWith('Area Attack')) ?? false
  const isMeleeSupportSingle = props.selectedAttack.type === 'support' && isMelee && !isAreaAttack

  // When AOE is active or an area shape is being aimed, only show reticules on participants inside the highlighted area.
  // For area shapes (even when LoS-blocked), never fall back to single-target range check so no stray reticules appear.
  const aoeCellSet = (aoeActive || isAreaTargeting.value)
    ? new Set(areaHighlightCells.value.map(c => `${c.x},${c.y},${c.z}`))
    : null
  const attackerDims = getParticipantFootprintDims(effectiveAttackerId.value)

  for (const p of props.participants) {
    const pos = props.participantPositions[p.id]
    if (!pos) continue
    if (p.id === effectiveAttackerId.value && !isMeleeSupportSingle) continue

    if (aoeCellSet) {
      // Show reticule if ANY of the target's footprint cells is in the AOE (big targets count if partially covered)
      if (!footprintIntersectsArea(pos, getParticipantFootprintDims(p.id), aoeCellSet)) continue
    } else if (isMelee) {
      // Melee: min Chebyshev distance across all footprint cell pairs (handles large digimon + diagonals)
      const targetDims = getParticipantFootprintDims(p.id)
      let inRange = meleeInRange(attackerPos, pos, attackerDims, targetDims, maxDist)
      if (!inRange && props.chargeMode === 'before') {
        for (const k of props.reachableCells) {
          if (meleeInRange(parseVec3Key(k), pos, attackerDims, targetDims, maxDist)) { inRange = true; break }
        }
      }
      if (!inRange) continue
    } else {
      // Ranged: 3D Euclidean distance from anchor to anchor, and some part of the target in view
      // (same blockers as area shapes: walls, floors, closed doors, all but water/air voxels)
      const dx = pos.x - attackerPos.x
      const dy = pos.y - attackerPos.y
      const dz = pos.z - attackerPos.z
      const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist3d > maxDist) continue
      const index = currentLosIndex()
      if (index && !canSeeFootprint(index, attackerPos, attackerDims, pos, getParticipantFootprintDims(p.id))) continue
    }

    ids.push(p.id)
  }

  reticuleParticipantIds.value = ids

  // Range rings on ground — for ranged single-target attacks AND area shapes (to show valid placement/reach zone)
  if (!isMelee && (!aoeCellSet || isAreaTargeting.value)) {
    const addRing = (radius: number, color: number) => {
      const geo = new THREE.RingGeometry(radius - 0.05, radius + 0.05, 64)
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(attackerPos.x + 0.5, attackerPos.y * TILE_SIZE + 0.05, attackerPos.z + 0.5)
      reticuleGroup.add(mesh)
    }
    addRing(props.attackerRange, 0x00ff00)
    addRing(props.attackerEffectiveLimit, 0xffaa00)
  }
}

// ── AOE highlight ──────────────────────────────────────────────────────────
// Resets the [Pass] two-step aiming state and clears its extra-movement range band.
function resetPassState() {
  passStep.value = null
  passLockedDir = null
  passMovementLength = 0
  passLandingValid = true
  if (passRangeGroup) clearMapGroup(passRangeGroup)
  if (passLandingGroup) clearMapGroup(passLandingGroup)
}

function clearAoeState() {
  areaHighlightCells.value = []
  lastAoeKey = ''
  lastAreaShapeData.value = null
  clearAoeHighlights()
  lastAttackKey = ''  // force reticule rebuild next frame
  resetPassState()
}

function clearAoeHighlights() {
  if (!aoeGroup) return
  for (const child of aoeGroup.children) {
    const object = child as THREE.Mesh | THREE.LineSegments
    object.geometry?.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material?.dispose()
  }
  aoeGroup.clear()
}

// Treat the complete area as one voxel volume: even the hit/blocked boundary has
// no internal faces or grid edges. Keep the existing colors on its exposed faces.
function renderAoeVolume(hitCells: Vec3[], blockedCells: Vec3[]) {
  const cells = new Map<string, { cell: Vec3; hit: boolean }>()
  for (const cell of blockedCells) cells.set(vec3Key(cell), { cell, hit: false })
  for (const cell of hitCells) cells.set(vec3Key(cell), { cell, hit: true })
  if (!cells.size) return

  const surface = buildVoxelSurface([...cells.values()].map(({ cell }) => cell))
  const cube = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE)
  const vertices = cube.getAttribute('position')
  const indices = cube.getIndex()!
  const hitPositions: number[] = [], blockedPositions: number[] = []
  const baseY = TILE_H + 0.01
  for (const [key, { cell, hit }] of cells) {
    const positions = hit ? hitPositions : blockedPositions
    for (const face of surface.exposedFaces.get(key) ?? []) {
      for (let i = 0; i < 6; i++) {
        const vertex = indices.getX(face * 6 + i)
        positions.push(
          cell.x * TILE_SIZE + TILE_SIZE / 2 + vertices.getX(vertex),
          cell.y * TILE_SIZE + baseY + TILE_SIZE / 2 + vertices.getY(vertex),
          cell.z * TILE_SIZE + TILE_SIZE / 2 + vertices.getZ(vertex),
        )
      }
    }
  }
  cube.dispose()

  for (const [positions, color] of [[hitPositions, 0xffaa00], [blockedPositions, 0xff3300]] as const) {
    if (!positions.length) continue
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false })
    aoeGroup.add(new THREE.Mesh(geometry, material))
  }

  const outlinePositions = surface.outlinePositions.map((value, i) => value * TILE_SIZE + (i % 3 === 1 ? baseY : 0))
  const outline = new THREE.BufferGeometry()
  outline.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3))
  aoeGroup.add(new THREE.LineSegments(outline, new THREE.LineBasicMaterial({
    color: 0xffcc55, transparent: true, opacity: 0.7, depthWrite: false,
  })))
}

function updateAoeHighlight(
  hitCells: Array<{ x: number; y: number; z: number }>,
  blockedCells: Array<{ x: number; y: number; z: number }> = [],
) {
  const key =
    hitCells.map(c => `H:${c.x},${c.y},${c.z}`).sort().join('|') +
    '|' +
    blockedCells.map(c => `X:${c.x},${c.y},${c.z}`).sort().join('|')
  if (key === lastAoeKey) return
  lastAoeKey = key
  areaHighlightCells.value = hitCells
  clearAoeHighlights()
  renderAoeVolume(hitCells, blockedCells)

  lastAttackKey = ''  // force reticule rebuild
}

// [Pass] step 2: highlight the band of cells reachable by extra movement (0..RAM) beyond the
// locked movement length, along the locked direction — a static preview of the max extension.
function renderPassRangeBand() {
  clearMapGroup(passRangeGroup)
  const attack = props.selectedAttack
  const attackerPos = effectiveAttackerId.value ? props.participantPositions[effectiveAttackerId.value] : null
  if (!attack || !attackerPos || !passLockedDir) return
  const dims = getParticipantFootprintDims(effectiveAttackerId.value)
  const minCells = computePassBeam(attackerPos, passLockedDir, passMovementLength, dims)
  const maxCells = computePassBeam(attackerPos, passLockedDir, passMovementLength + (attack.ram ?? 0), dims)
  const minSet = new Set(minCells.map(c => `${c.x},${c.y},${c.z}`))
  for (const c of maxCells) {
    if (minSet.has(`${c.x},${c.y},${c.z}`)) continue
    const geo = new THREE.BoxGeometry(TILE_SIZE, 0.05, TILE_SIZE)
    const mat = new THREE.MeshBasicMaterial({ color: 0x2255ff, transparent: true, opacity: 0.35 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(c.x + 0.5, c.y * TILE_SIZE + TILE_H + 0.02, c.z + 0.5)
    passRangeGroup.add(mesh)
  }
}

/**
 * Clamp a desired blast center (world XZ + integer Y level) so its 3D distance from the
 * attacker stays within the attacker's effective limit. Y consumes part of the budget first,
 * leaving the remainder for the horizontal (XZ) offset. Y may be negative (underground).
 */
function clampBlastCenter(attackerPos: Vec3, worldX: number, worldZ: number, desiredY: number): Vec3 {
  const limit = props.attackerEffectiveLimit
  // Y offset (in floor levels = metres) clamped to ±limit
  const dy = Math.max(-limit, Math.min(limit, desiredY - attackerPos.y))
  // Remaining horizontal budget after Y is spent
  const horizBudget = Math.sqrt(Math.max(0, limit * limit - dy * dy))
  let dx = worldX - (attackerPos.x + 0.5)
  let dz = worldZ - (attackerPos.z + 0.5)
  const distXZ = Math.sqrt(dx * dx + dz * dz)
  if (distXZ > horizBudget && distXZ > 0.01) {
    const s = horizBudget / distXZ
    dx *= s; dz *= s
  }
  return {
    x: Math.floor((attackerPos.x + 0.5) + dx),
    y: attackerPos.y + Math.round(dy),
    z: Math.floor((attackerPos.z + 0.5) + dz),
  }
}

/** Max integer Y offset (±) the blast center may have given the current horizontal offset. */
function maxBlastDy(attackerPos: Vec3, center: Vec3): number {
  const limit = props.attackerEffectiveLimit
  const dx = (center.x + 0.5) - (attackerPos.x + 0.5)
  const dz = (center.z + 0.5) - (attackerPos.z + 0.5)
  const distXZ = Math.sqrt(dx * dx + dz * dz)
  return Math.floor(Math.sqrt(Math.max(0, limit * limit - distXZ * distXZ)))
}

function adjustBlastY(step: number) {
  const attackerPos = effectiveAttackerId.value ? props.participantPositions[effectiveAttackerId.value] : null
  const center = lastBlastCenter.value
  if (!attackerPos || !center) {
    // No center aimed yet — just nudge Y within ±effectiveLimit of the attacker
    const lim = props.attackerEffectiveLimit
    const base = attackerPos?.y ?? 0
    blastCenterY.value = Math.max(base - lim, Math.min(blastCenterY.value + step, base + lim))
    return
  }
  const maxDy = maxBlastDy(attackerPos, center)
  blastCenterY.value = Math.max(attackerPos.y - maxDy, Math.min(blastCenterY.value + step, attackerPos.y + maxDy))
  renderBlastFromStoredCenter()
}

/**
 * Scroll-wheel elevation aim shared by all aimed area shapes. Blast moves its sphere centre;
 * the directional shapes (cone/close-blast/line/pass) nudge the aim-plane elevation within
 * ±effectiveLimit and re-run the last aim so the shape re-pitches in 3D.
 */
function adjustAimY(step: number) {
  const shape = props.selectedAttack ? getAreaShape(props.selectedAttack.tags) : null
  if (shape === 'blast') { adjustBlastY(step); return }
  // [Pass] step 2: direction (including pitch) is locked — scroll wheel has no effect.
  if (shape === 'pass' && passStep.value === 'extra') return
  const attackerPos = effectiveAttackerId.value ? props.participantPositions[effectiveAttackerId.value] : null
  const lim = props.attackerEffectiveLimit
  const base = attackerPos?.y ?? 0
  blastCenterY.value = Math.max(base - lim, Math.min(blastCenterY.value + step, base + lim))
  if (lastAreaAimEvent) computeAndRenderAoe(lastAreaAimEvent)
}

function renderBlastFromStoredCenter() {
  if (!lastBlastCenter.value) return
  const attackerPos = effectiveAttackerId.value ? props.participantPositions[effectiveAttackerId.value] : null
  if (!attackerPos) return
  const attack = props.selectedAttack
  if (!attack) return
  const center: Vec3 = { x: lastBlastCenter.value.x, y: blastCenterY.value, z: lastBlastCenter.value.z }
  lastBlastCenter.value = center
  const effectiveCenter = clipToLos(attackerPos, center)
  const dims = getParticipantFootprintDims(effectiveAttackerId.value)
  const cells = computeAreaCells(
    'blast', attack.range, attackerPos, { x: 0, y: 0, z: 0 },
    attack.bit, attack.ram ?? 0, attack.movement ?? 0,
    dims, effectiveCenter,
  )
  lastAreaShapeData.value = {
    shape: 'blast', rangeType: attack.range, attackerPos, dir: { x: 0, y: 0, z: 0 },
    bit: attack.bit, ram: attack.ram ?? 0, movement: attack.movement ?? 0,
    attackerDims: dims, blastCenter: effectiveCenter,
  }
  const { hitCells, blockedCells } = classifyCellsByLos(cells, effectiveCenter)
  updateAoeHighlight(hitCells, blockedCells)
}

// Line of sight between two cells' centres, against the map's blockers (utils/lineOfSight.ts —
// shared with single-target reticules so both always agree). No map → always clear.
function currentLosIndex(): LosIndex | null {
  if (!losIndex && props.map) losIndex = buildLosIndex(props.map, new Set((props.destructibleStates ?? []).filter(s => s.currentWounds <= 0).map(s => s.structureId)))
  return losIndex
}

function hasLineOfSight(from: Vec3, to: Vec3): boolean {
  const index = currentLosIndex()
  return !index || losClear(index, from, to)
}

// The cell where the line from→to first hits a blocker (or `to` if it's clear).
function clipToLos(from: Vec3, to: Vec3): Vec3 {
  const index = currentLosIndex()
  return index ? losClip(index, from, to) : to
}

function classifyCellsByLos(
  cells: Vec3[],
  losOrigin: Vec3,
): { hitCells: Vec3[]; blockedCells: Vec3[] } {
  const hitCells: Vec3[] = []
  const blockedCells: Vec3[] = []
  for (const c of cells) {
    if (hasLineOfSight(losOrigin, c)) hitCells.push(c)
    else blockedCells.push(c)
  }
  return { hitCells, blockedCells }
}

function computeAndRenderAoe(event: MouseEvent) {
  const attack = props.selectedAttack
  if (!attack) return
  const shape = getAreaShape(attack.tags)
  if (!shape) return

  const attackerPos = effectiveAttackerId.value ? props.participantPositions[effectiveAttackerId.value] : null
  if (!attackerPos) return

  const dims = getParticipantFootprintDims(effectiveAttackerId.value)

  // Blast: mouse controls XZ center position; scroll wheel controls Y (blastCenterY)
  if (shape === 'blast') {
    setMouseFromEvent(event)
    const planeY = blastCenterY.value * TILE_SIZE + TILE_H
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)
    const pt = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, pt)) return

    const blastCenter = clampBlastCenter(attackerPos, pt.x, pt.z, blastCenterY.value)

    lastBlastCenter.value = blastCenter
    const effectiveCenter = clipToLos(attackerPos, blastCenter)

    const cells = computeAreaCells(
      shape, attack.range, attackerPos, { x: 0, y: 0, z: 0 },
      attack.bit, attack.ram ?? 0, attack.movement ?? 0, dims, effectiveCenter,
    )
    lastAreaShapeData.value = {
      shape, rangeType: attack.range, attackerPos, dir: { x: 0, y: 0, z: 0 },
      bit: attack.bit, ram: attack.ram ?? 0, movement: attack.movement ?? 0,
      attackerDims: dims, blastCenter: effectiveCenter,
    }
    const { hitCells, blockedCells } = classifyCellsByLos(cells, effectiveCenter)
    updateAoeHighlight(hitCells, blockedCells)
    return
  }

  // Burst: omnidirectional from the whole footprint — no aiming.
  if (shape === 'burst') {
    const cells = computeAreaCells(
      shape, attack.range, attackerPos, { x: 0, y: 0, z: 0 },
      attack.bit, attack.ram ?? 0, attack.movement ?? 0, dims,
    )
    lastAreaShapeData.value = {
      shape, rangeType: attack.range, attackerPos, dir: { x: 0, y: 0, z: 0 },
      bit: attack.bit, ram: attack.ram ?? 0, movement: attack.movement ?? 0,
      attackerDims: dims,
    }
    const { hitCells, blockedCells } = classifyCellsByLos(cells, attackerPos)
    updateAoeHighlight(hitCells, blockedCells)
    return
  }

  // Directional shapes (cone / close-blast / line / pass): Blast-style 3D aim.
  // Mouse picks an XZ point on the plane at the current aim elevation (scroll-wheel `blastCenterY`);
  // the 3D direction runs from the attacker's footprint centre to that point, so the shape pitches up/down.
  lastAreaAimEvent = event
  setMouseFromEvent(event)
  const planeY = blastCenterY.value * TILE_SIZE + TILE_H
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)
  const pt = new THREE.Vector3()
  if (!raycaster.ray.intersectPlane(plane, pt)) return

  // World-space footprint centre — used only for the direction vector (frame-independent).
  const fcWorldX = attackerPos.x + dims.width / 2
  const fcWorldZ = attackerPos.z + dims.depth / 2
  let dir: Vec3 = { x: pt.x - fcWorldX, y: blastCenterY.value - attackerPos.y, z: pt.z - fcWorldZ }
  if (Math.sqrt(dir.x * dir.x + dir.z * dir.z) < 0.01 && Math.abs(dir.y) < 0.01) {
    dir = { x: 1, y: 0, z: 0 }
  }

  // [Pass]: two-step aim. Step 1 picks direction + movement length (clamped to Movement);
  // step 2 locks the direction and only extends along it by extra movement (clamped to RAM).
  if (shape === 'pass') {
    // LoS proxy: ray from the attacker toward the aim point, capped at the effective limit.
    // Tip is in cell-index space (hasLineOfSight adds the +0.5 cell-centre offset itself).
    const cisX = attackerPos.x + (dims.width - 1) / 2
    const cisZ = attackerPos.z + (dims.depth - 1) / 2
    const dlen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z)
    const cap = Math.min(dlen, props.attackerEffectiveLimit || dlen)
    const losTip = {
      x: Math.round(cisX + (dir.x / dlen) * cap),
      y: Math.round(attackerPos.y + (dir.y / dlen) * cap),
      z: Math.round(cisZ + (dir.z / dlen) * cap),
    }
    const los = hasLineOfSight(attackerPos, losTip)
    if (passStep.value !== 'extra') {
      if (passStep.value === null) passStep.value = 'movement'
      const movementLen = Math.min(dlen, attack.movement ?? 0)
      const cells = computeAreaCells(shape, attack.range, attackerPos, dir, attack.bit, 0, movementLen, dims)
      lastAreaShapeData.value = {
        shape, rangeType: attack.range, attackerPos, dir,
        bit: attack.bit, ram: 0, movement: movementLen,
        attackerDims: dims,
      }
      const caps = props.attackerCaps
      const landingAnchor = computePassLanding(attackerPos, dir, movementLen, 0)
      passLandingValid = anyPassLandingValid(attackerPos, dir, movementLen, attack.ram ?? 0, dims, effectiveAttackerId.value!, caps)
      renderPassLandingMarker(landingAnchor, dims, passLandingValid)
      updateAoeHighlight(los ? cells : [], los ? [] : cells)
      return
    } else {
      const nd = passLockedDir!
      const proj = dir.x * nd.x + dir.y * nd.y + dir.z * nd.z
      const extra = Math.max(0, Math.min(proj - passMovementLength, attack.ram ?? 0))
      const cells = computeAreaCells(shape, attack.range, attackerPos, nd, attack.bit, extra, passMovementLength, dims)
      lastAreaShapeData.value = {
        shape, rangeType: attack.range, attackerPos, dir: nd,
        bit: attack.bit, ram: extra, movement: passMovementLength,
        attackerDims: dims,
      }
      const caps = props.attackerCaps
      const landingAnchor = computePassLanding(attackerPos, nd, passMovementLength, extra)
      passLandingValid = isPassLandingValid(landingAnchor, dims, effectiveAttackerId.value!, caps, attackerPos)
      renderPassLandingMarker(landingAnchor, dims, passLandingValid)
      updateAoeHighlight(los ? cells : [], los ? [] : cells)
      return
    }
  }

  const cells = computeAreaCells(
    shape, attack.range, attackerPos, dir,
    attack.bit, attack.ram ?? 0, attack.movement ?? 0, dims,
  )
  lastAreaShapeData.value = {
    shape, rangeType: attack.range, attackerPos, dir,
    bit: attack.bit, ram: attack.ram ?? 0, movement: attack.movement ?? 0,
    attackerDims: dims,
  }
  const { hitCells, blockedCells } = classifyCellsByLos(cells, attackerPos)
  updateAoeHighlight(hitCells, blockedCells)
}

// ── Mouse interaction ──────────────────────────────────────────────────────
const mouse = new THREE.Vector2()
const raycaster = new THREE.Raycaster()

function getIntersection(event: MouseEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  scene.updateMatrixWorld(true)
  const candidates = [...spriteGroups.values(), ...buildMeshes].filter(object => object.visible)
  return [...(terrain?.pick(raycaster) ?? []), ...raycaster.intersectObjects(candidates, true)]
    .filter(hit => ['sprite', 'wall', 'door', 'ceiling', 'ground', 'space', 'voxel'].includes(hit.object.userData.type))
    .sort((a, b) => a.distance - b.distance)
}

function setMouseFromEvent(event: MouseEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
}

function planeCell(event: MouseEvent): Vec3 | null {
  setMouseFromEvent(event)
  const groundY = props.currentEditY * TILE_SIZE + TILE_H
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY)
  const target = new THREE.Vector3()
  if (!raycaster.ray.intersectPlane(plane, target)) return null
  return { x: Math.floor(target.x), y: props.currentEditY, z: Math.floor(target.z) }
}

function wallEdgeFromEvent(event: MouseEvent): { tile: Vec3; face: WallFace } | null {
  setMouseFromEvent(event)
  const groundY = props.currentEditY * TILE_SIZE + TILE_H
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY)
  const target = new THREE.Vector3()
  if (!raycaster.ray.intersectPlane(plane, target)) return null
  const tx = Math.floor(target.x), tz = Math.floor(target.z)
  const dx = target.x - tx, dz = target.z - tz
  const nearest = [
    { face: 'north' as WallFace, d: dz },
    { face: 'south' as WallFace, d: 1 - dz },
    { face: 'west'  as WallFace, d: dx },
    { face: 'east'  as WallFace, d: 1 - dx },
  ].sort((a, b) => a.d - b.d)[0]
  return { tile: { x: tx, y: props.currentEditY, z: tz }, face: nearest.face }
}

function voxelCellFromEvent(event: MouseEvent): Vec3 | null {
  const hits = getIntersection(event)
  const hit = hits.find(h => h.object.userData.type === 'voxel' || h.object.userData.type === 'voxel-spawn')
  const voxel = hit?.object.userData.voxel as { x: number; y: number; z: number } | undefined
  return voxel ? { x: voxel.x, y: voxel.y, z: voxel.z } : null
}

function getHoveredHit(event: MouseEvent): EditHit | null {
  const tool = props.activeTool
  if (tool === 'window') {
    const voxel = voxelCellFromEvent(event)
    if (voxel) return { type: 'voxel', cell: voxel }
    const we = wallEdgeFromEvent(event)
    if (!we) return null
    return { type: 'wall-edge', tile: we.tile, face: we.face }
  }
  if (tool === 'wall' || tool === 'door') {
    const we = wallEdgeFromEvent(event)
    if (!we) return null
    return { type: 'wall-edge', tile: we.tile, face: we.face }
  }
  if (tool === 'spawn') {
    const voxel = voxelCellFromEvent(event)
    if (voxel) return { type: 'voxel', cell: voxel }
  }
  if (tool === 'delete') {
    if (event.shiftKey || event.ctrlKey) {
      const we = wallEdgeFromEvent(event)
      if (!we) return null
      return { type: 'wall-edge', tile: we.tile, face: we.face }
    }
    const voxel = voxelCellFromEvent(event)
    if (voxel) return { type: 'cell', cell: voxel }
    const cell = planeCell(event)
    if (!cell) return null
    return { type: 'cell', cell }
  }
  const cell = planeCell(event)
  if (!cell) return null
  return { type: 'cell', cell }
}

function tilesBetween(start: Vec3, end: Vec3): Vec3[] {
  const cells: Vec3[] = []
  const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
  const minZ = Math.min(start.z, end.z), maxZ = Math.max(start.z, end.z)
  if (props.drawMode === 'line') {
    if (Math.abs(end.x - start.x) >= Math.abs(end.z - start.z)) {
      for (let x = minX; x <= maxX; x++) cells.push({ x, y: start.y, z: start.z })
    } else {
      for (let z = minZ; z <= maxZ; z++) cells.push({ x: start.x, y: start.y, z })
    }
  } else {
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++)
        cells.push({ x, y: start.y, z })
  }
  return cells
}

function makeWallGhostMesh(tile: Vec3, face: WallFace, color: number): THREE.Mesh {
  const isNS = face === 'north' || face === 'south'
  const xOff = face === 'east' ? 1 : face === 'west' ? 0 : 0.5
  const zOff = face === 'south' ? 1 : face === 'north' ? 0 : 0.5
  const geo = isNS ? new THREE.BoxGeometry(TILE_SIZE, WALL_H, 0.08) : new THREE.BoxGeometry(0.08, WALL_H, TILE_SIZE)
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(tile.x + xOff, tile.y * TILE_SIZE + WALL_H / 2, tile.z + zOff)
  return mesh
}


function makeTileGhostMesh(cell: Vec3, color: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(TILE_SIZE, TILE_H, TILE_SIZE)
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(cell.x + 0.5, cell.y * TILE_SIZE + TILE_H / 2, cell.z + 0.5)
  return mesh
}

function makeVoxelGhostMesh(cell: Vec3, color: number): THREE.Mesh {
  const voxel = props.activeTool === 'ramp'
    ? { shape: 'ramp' as const, rampDirection: props.rampDirection ?? 'north' }
    : props.activeTool === 'voxel' ? undefined
      : (props.map?.voxels ?? []).find(v => v.x === cell.x && v.y === cell.y && v.z === cell.z)
  const geo = createVoxelGeometry(voxel ?? {})
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(cell.x + 0.5, cell.y * TILE_SIZE + 0.5, cell.z + 0.5)
  return mesh
}

function makeStairGhostMesh(cell: Vec3, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(createStairGeometry(props.rampDirection ?? 'north'),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 }))
  mesh.position.set(cell.x + 0.5, cell.y * TILE_SIZE + 0.5, cell.z + 0.5)
  return mesh
}

function updateHoverGhost(event: MouseEvent) {
  const hit = ['voxel', 'ramp', 'stairs', 'add-ground', 'add-space', 'paint-element', 'ceiling'].includes(props.activeTool)
    ? planeCell(event) : [event.clientX, event.clientY, event.shiftKey, event.ctrlKey]
  const key = JSON.stringify([props.activeTool, props.drawMode, props.currentEditY, props.rampDirection, hit, dragStartHit, getMapGeometryRevision(props.map)])
  if (!mapPreviewChanged(hoverGhostGroup, key)) return
  clearMapGroup(hoverGhostGroup)
  if (props.activeTool === 'select' || !props.isDm) return
  const tool = props.activeTool

  if (tool === 'wall' || tool === 'window' || tool === 'door') {
    const color = tool === 'window' ? 0x88ccff : tool === 'door' ? 0x886644 : 0x00aaff
    if (tool === 'window') {
      const voxel = voxelCellFromEvent(event)
      if (voxel) {
        hoverGhostGroup.add(makeVoxelGhostMesh(voxel, color))
        return
      }
    }
    const we = wallEdgeFromEvent(event)
    if (!we) return
    if (dragStartHit?.type === 'wall-edge' && tool === 'wall') {
      for (const tile of tilesBetween(dragStartHit.tile, we.tile))
        hoverGhostGroup.add(makeWallGhostMesh(tile, dragStartHit.face, color))
    } else {
      hoverGhostGroup.add(makeWallGhostMesh(we.tile, we.face, color))
    }
  } else if (tool === 'spawn') {
    const voxel = voxelCellFromEvent(event)
    if (voxel) {
      hoverGhostGroup.add(makeVoxelGhostMesh(voxel, 0x00ff88))
      return
    }
    const cell = planeCell(event)
    if (!cell) return
    if (dragStartHit?.type === 'cell') {
      for (const tile of tilesBetween(dragStartHit.cell, cell))
        hoverGhostGroup.add(makeTileGhostMesh(tile, 0x00ff88))
    } else {
      hoverGhostGroup.add(makeTileGhostMesh(cell, 0x00ff88))
    }
  } else if (tool === 'delete') {
    if (event.shiftKey || event.ctrlKey) {
      const we = wallEdgeFromEvent(event)
      if (we) hoverGhostGroup.add(makeWallGhostMesh(we.tile, we.face, 0xff3333))
    } else {
      const voxel = voxelCellFromEvent(event)
      if (voxel) {
        hoverGhostGroup.add(makeVoxelGhostMesh(voxel, 0xff3333))
        return
      }
      const cell = planeCell(event)
      if (!cell) return
      if (dragStartHit?.type === 'cell') {
        for (const tile of tilesBetween(dragStartHit.cell, cell))
          hoverGhostGroup.add(makeTileGhostMesh(tile, 0xff3333))
      } else {
        hoverGhostGroup.add(makeTileGhostMesh(cell, 0xff3333))
      }
    }
  } else {
    const cell = planeCell(event)
    if (!cell) return
    const color = tool === 'voxel' || tool === 'ramp' || tool === 'stairs' ? 0x88ccff : 0x00aaff
    const makeGhost = tool === 'stairs' ? makeStairGhostMesh
      : tool === 'voxel' || tool === 'ramp' ? makeVoxelGhostMesh : makeTileGhostMesh
    if (dragStartHit?.type === 'cell' && (tool === 'add-ground' || tool === 'add-space' || tool === 'ceiling' || tool === 'paint-element' || tool === 'voxel' || tool === 'ramp' || tool === 'stairs')) {
      for (const tile of tilesBetween(dragStartHit.cell, cell))
        hoverGhostGroup.add(makeGhost(tile, color))
    } else {
      hoverGhostGroup.add(makeGhost(cell, color))
    }
  }
}

function onMouseMove(event: MouseEvent) {
  if (rightDragActive) {
    applyRightDragRotation(event.clientX - rightDragLastX)
    rightDragLastX = event.clientX
    return
  }

  // A token is being dragged: the pointer handlers own the preview, so skip hover raycasts.
  if (tokenDrag.isPressed()) return

  updateTargetHover(event)

  // Movement mode — ghost + distance label + path preview
  // Intersect the chosen movement height so the wheel controls the target floor,
  // preventing upper-floor geometry from blocking clicks on lower-floor tiles.
  const moveAim = getMoveAim()
  if (moveAim) {
    clearMapGroup(hoverGhostGroup)
    movementGhost.value = null
    movementGhostOverlay.value = null
    movementGapLabel.value = null
    hoveredMoveScreen.value = null
    const cell = moveCellAt(event, moveAim.y)
    if (cell) {
      const valid = moveAim.isGm ? validGmMoveCell(cell, moveAim.participantId) : props.reachableCells.has(vec3Key(cell))
      if (valid || moveAim.isGm) {
        const dims = getParticipantFootprintDims(moveAim.participantId)
        const ghostGeo = new THREE.CircleGeometry(TILE_SIZE * 0.42, 24)
        const ghostMat = new THREE.MeshBasicMaterial({ color: valid ? 0x2255ff : 0xff3333, transparent: true, opacity: 0.2, depthWrite: false })
        const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat)
        ghostMesh.scale.set(dims.width, dims.depth, 1)
        ghostMesh.rotation.x = -Math.PI / 2
        ghostMesh.position.copy(movementPreviewCenter(cell, dims, 0.01))
        hoverGhostGroup.add(ghostMesh)
        movementGhost.value = { participantId: moveAim.participantId, cell, valid }
        updateMovementGhostOverlay()
        renderMovementGap(cell, dims)
        const labelV = movementPreviewCenter(cell, dims, 0.6)
        hoveredMoveScreen.value = worldToScreen2D(labelV) ?? null
        if (moveAim.isGm) {
          const origin = props.participantPositions[moveAim.participantId]
          hoveredMoveDistance.value = origin ? Math.max(Math.abs(cell.x - origin.x), Math.abs(cell.y - origin.y), Math.abs(cell.z - origin.z)) : 0
        } else emit('cell-hovered', cell)
      } else if (!moveAim.isGm) {
        emit('cell-hovered', null)
      }
    } else if (!moveAim.isGm) {
      emit('cell-hovered', null)
    }
    return
  }

  // AOE aiming: update area highlight when an area attack is active (non-burst)
  if (props.selectedAttack) {
    const shape = getAreaShape(props.selectedAttack.tags)
    if (shape && shape !== 'burst') computeAndRenderAoe(event)
  }

  if (props.isDm && props.activeTool !== 'select') {
    updateHoverGhost(event)
  }
}

function onMouseDown(event: MouseEvent) {
  if (event.button === 2) {
    // Right click cancels movement mode or AOE targeting
    if (getMoveAim()) {
      cancelMoveAim()
      return
    }
    if (participantChoice.value) { closeRadial(); return }
    if (areaHighlightCells.value.length > 0 || props.selectedAttack) {
      clearAoeState()
      emit('attack-cancelled')
      return
    }
    rightDragActive = true
    rightDragLastX = event.clientX
    return
  }
  if (!props.isDm || props.activeTool === 'select') return
  dragStartHit = getHoveredHit(event)
}

function onMouseUp(event: MouseEvent) {
  if (event.button === 2) { rightDragActive = false; return }
  if (!props.isDm || props.activeTool === 'select' || !dragStartHit) return
  const endHit = getHoveredHit(event)
  const tool = props.activeTool
  if (dragStartHit.type === 'voxel') {
    if (tool === 'window' || tool === 'spawn') {
      emit('voxel-edit', dragStartHit.cell, tool)
    } else if (tool === 'delete') {
      emit('cell-draw', dragStartHit.cell, dragStartHit.cell)
    }
  } else if (dragStartHit.type === 'wall-edge') {
    if (tool === 'window' || tool === 'door') {
      emit('wall-edit-at-edge', dragStartHit.tile, dragStartHit.face)
    } else if (tool === 'delete') {
      if (event.shiftKey)     emit('wall-edit-at-edge', dragStartHit.tile, dragStartHit.face, 'delete-wall')
      else if (event.ctrlKey) emit('wall-edit-at-edge', dragStartHit.tile, dragStartHit.face, 'delete-fill')
    } else {
      const endTile = (endHit?.type === 'wall-edge') ? endHit.tile : dragStartHit.tile
      emit('wall-place', dragStartHit.tile, endTile, dragStartHit.face)
    }
  } else if (dragStartHit.type === 'cell' || dragStartHit.type === 'wall') {
    const startCell = dragStartHit.cell
    const endCell = (endHit?.type === 'cell' || endHit?.type === 'wall') ? endHit.cell : startCell
    emit('cell-draw', startCell, endCell)
  }
  dragStartHit = null
}

// Charge "before" mode: find the closest reachable anchor (or current position) from which
// `targetId` is in melee range, and emit charge-target-selected to move the attacker there.
// Returns true if a valid anchor was found and the move was emitted.
function tryChargeMove(targetId: string): boolean {
  const attackerId = effectiveAttackerId.value
  const attackerPos = attackerId ? props.participantPositions[attackerId] : null
  const targetPos = props.participantPositions[targetId]
  if (!attackerId || !attackerPos || !targetPos) return false
  const attackerDims = getParticipantFootprintDims(attackerId)
  const targetDims = getParticipantFootprintDims(targetId)
  const anchors: Vec3[] = [attackerPos, ...Array.from(props.reachableCells, parseVec3Key)]
  let best: Vec3 | null = null
  let bestDist = Infinity
  for (const anchor of anchors) {
    if (!meleeInRange(anchor, targetPos, attackerDims, targetDims, props.attackerMeleeRange)) continue
    if (footprintOccupied(anchor, attackerDims, attackerId)) continue
    const dist = Math.max(Math.abs(anchor.x - attackerPos.x), Math.abs(anchor.y - attackerPos.y), Math.abs(anchor.z - attackerPos.z))
    if (dist < bestDist) { bestDist = dist; best = anchor }
  }
  if (!best) return false
  emit('charge-target-selected', attackerId, best, targetId)
  return true
}

// The participant a click on these raycast hits would pick as a single-target attack/intercede target:
// a direct hit on a reticuled participant's character token (sprite hitbox) wins, else a reticuled
// participant whose footprint covers the clicked ground/voxel tile — so Large/Huge/Gigantic digimon
// can be targeted by clicking any footprint tile, not just the anchor.
function reticuleTargetFromHits(hits: THREE.Intersection[]): string | null {
  const singleTargetAttack = !!props.selectedAttack && !getAreaShape(props.selectedAttack.tags)

  const spriteHit = hits.find(h => h.object.userData.type === 'sprite')
  if (spriteHit && (singleTargetAttack || props.selectableParticipantIds?.length)) {
    const participantId: string = spriteHit.object.userData.participantId
    if (reticuleParticipantIds.value.includes(participantId)) return participantId
  }

  const surfaceHit = hits.find(h => h.object.userData.type === 'ground' || h.object.userData.type === 'space' || h.object.userData.type === 'voxel')
  if ((singleTargetAttack || (props.selectableParticipantIds?.length && !props.selectedAttack)) && surfaceHit) {
    const hitType = surfaceHit.object.userData.type
    const tile = surfaceHit.object.userData.tile as { y: number } | undefined
    const voxel = surfaceHit.object.userData.voxel as { x: number; y: number; z: number } | undefined
    const cell: Vec3 = hitType === 'voxel' && voxel
      ? { x: voxel.x, y: voxel.y + 1, z: voxel.z }
      : { x: Math.floor(surfaceHit.point.x), y: tile?.y ?? 0, z: Math.floor(surfaceHit.point.z) }
    const cellSet = new Set([`${cell.x},${cell.y},${cell.z}`])
    const targetParticipant = props.participants.find(p => {
      if (p.id === effectiveAttackerId.value) return false
      const pos = props.participantPositions[p.id]
      if (!pos) return false
      if (!reticuleParticipantIds.value.includes(p.id)) return false
      return footprintIntersectsArea(pos, getParticipantFootprintDims(p.id), cellSet)
    })
    if (targetParticipant) return targetParticipant.id
  }

  return null
}

// Tints green the volume outline of whichever participant a click at the cursor would target.
// Skips the raycast (clearing the tint) while nothing is targetable or onCanvasClick would handle
// the click before reaching target selection (map editing, movement, area aiming, placement/GM move).
function updateTargetHover(event: MouseEvent) {
  const canTarget = reticuleParticipantIds.value.length > 0
    && !movingParticipantId.value
    && !isAreaTargeting.value
    && !(props.isDm && props.activeTool !== 'select')
    && !props.placingParticipantId && !props.gmMoveParticipantId
  setHoveredTarget(canTarget ? reticuleTargetFromHits(getIntersection(event)) : null)
}

// Selects `participantId` as the attack/intercede target if it currently has a reticule.
// Returns true if the target was selected (caller should stop further click handling).
function tryReticuleTarget(participantId: string): boolean {
  if (!reticuleParticipantIds.value.includes(participantId)) return false
  if (props.chargeMode === 'before') {
    tryChargeMove(participantId)
  } else {
    emit('target-selected', participantId)
  }
  return true
}

// ── Placement validation + drag-to-place ────────────────────────────────────
// One rule set for every way of putting a character on the map: clicking a tile while armed, GM
// free-move, dragging a token already on the map, and dropping a HUD card onto the map. Players
// may only land on spawn areas, the GM anywhere; solid voxels block both and Tiny
// pairings are the only exception to occupied landing squares.
// The decision itself is utils/placementRules.ts `evaluatePlacement`; this just gathers its inputs.
const isPlacementSurface = (h: THREE.Intersection) =>
  h.object.userData.type === 'ground' || h.object.userData.type === 'space' || h.object.userData.type === 'voxel'

// The floor area a unit covers. Uses the same real width × depth as movement and occupancy
// (getParticipantFootprintDims), not the square tile count the sprite is drawn with, so a gigantic
// unit with unequal dimensions is validated over the cells it actually occupies.
function placementFootprint(participantId: string): PlacementFootprint {
  const { width, depth } = getParticipantFootprintDims(participantId)
  return { width, depth }
}

// Which cells a player may stand on, rebuilt only when the map changes (a drag asks about every
// footprint cell on every pointer move).
const isSpawnCell = computed(() => makeSpawnCellChecker(props.map?.groundTiles ?? [], getMapVoxels(props.map)))

// Resolves a surface hit into the cell `participantId` would land on and whether that is allowed.
// An invalid result still carries its cell so a drag can show where the drop would have gone.
function evaluatePlacementAt(surfaceHit: THREE.Intersection, participantId: string): PlacementEvaluation {
  return evaluatePlacement({
    hit: {
      type: surfaceHit.object.userData.type,
      tile: surfaceHit.object.userData.tile,
      voxel: surfaceHit.object.userData.voxel,
      point: surfaceHit.point,
    },
    isDm: props.isDm,
    participantId,
    size: getParticipantSize(participantId),
    footprint: placementFootprint(participantId),
    isBlocked: cell => !!props.map && mapVoxelBlocksMovement(props.map, cell),
    isSpawnCell: cell => isSpawnCell.value(cell),
    occupants: props.participants.map(p => {
      const position = props.participantPositions[p.id]
      return { id: p.id, position, size: getParticipantSize(p.id), footprint: position ? placementFootprint(p.id) : { width: 0, depth: 0 } }
    }),
  })
}

// Where a drop at the pointer would land `participantId`; null when the pointer isn't over the map.
function dropTargetAt(event: MouseEvent, participantId: string): PlacementEvaluation | null {
  const surfaceHit = getIntersection(event).find(isPlacementSurface)
  return surfaceHit ? evaluatePlacementAt(surfaceHit, participantId) : null
}

// Green footprint where the drop would land, red where it would be refused.
function showDropGhost(placement: PlacementEvaluation | null) {
  clearMapGroup(hoverGhostGroup)
  requestRender()
  if (!placement) return
  const color = placement.valid ? 0x00ff88 : 0xff3333
  for (let dx = 0; dx < placement.footprint.width; dx++) {
    for (let dz = 0; dz < placement.footprint.depth; dz++) {
      hoverGhostGroup.add(makeTileGhostMesh({ x: placement.cell.x + dx, y: placement.cell.y, z: placement.cell.z + dz }, color))
    }
  }
}

// ── Dragging a token that is already on the map ──
// Pointer events rather than mouse events so touch works too. The press is taken in the capture
// phase and OrbitControls is switched off before its own pointerdown runs: left mouse is mapped to
// PAN, so without that the camera would slide under the token being dragged.
// The gesture itself (threshold, camera lock, Escape, click suppression, re-checking the offer at
// the drop) lives in utils/tokenDrag.ts; this supplies its Three.js/DOM effects.
let suppressNextClick = false

// The `click` that follows a real drag's release would otherwise open a radial on whatever is
// under the cursor. Dropped on the next tick in case no click is ever dispatched (release outside
// the canvas).
function swallowNextClick() {
  suppressNextClick = true
  setTimeout(() => { suppressNextClick = false }, 0)
}

const tokenDrag = createTokenDragController<PointerEvent>({
  draggableIds: () => props.draggableParticipantIds,
  // A drag must not collide with any other mode that already owns the left button.
  allowed: () => {
    if (props.isDm && props.activeTool !== 'select') return false              // map editing
    if (getMoveAim() || props.chargeMode) return false                        // move / charge aiming
    if (props.selectedAttack || isAreaTargeting.value) return false            // attack aiming
    if (props.placingParticipantId || props.gmMoveParticipantId) return false  // click placement / GM free-move
    if (reticuleParticipantIds.value.length > 0) return false                  // picking a target
    return true
  },
  tokenAt: (event) => {
    const region = participantRegionFromHits(getIntersection(event))
    if (!region) return null
    const candidates = participantCandidatesAt(region.anchor, region.dims)
    return candidates.length === 1 ? candidates[0]!.id : null
  },
  preview: (event, participantId) => showDropGhost(dropTargetAt(event, participantId)),
  resolveDrop: (event, participantId) => {
    const placement = dropTargetAt(event, participantId)
    return placement?.valid ? placement.cell : null
  },
  commit: (participantId, cell) => emit('unit-dragged', participantId, cell),
  clearPreview: () => { if (hoverGhostGroup) clearMapGroup(hoverGhostGroup); requestRender() },
  lockCamera: () => { if (controls) controls.enabled = false },
  unlockCamera: () => { if (controls) controls.enabled = props.activeTool === 'select' },
  setCursor: (cursor) => { if (canvasRef.value) canvasRef.value.style.cursor = cursor },
  begin: () => { closeRadial(); clickedHealthBar.value = null; setHoveredTarget(null) },
  swallowNextClick,
})

// Window-level so a drag keeps tracking when the pointer leaves the canvas; the controller ignores
// anything that isn't part of a gesture it started.
const onTokenPointerDown = (e: PointerEvent) => tokenDrag.pointerDown(e)
const onTokenPointerMove = (e: PointerEvent) => tokenDrag.pointerMove(e)
const onTokenPointerUp = (e: PointerEvent) => tokenDrag.pointerUp(e)
const onTokenPointerCancel = () => tokenDrag.pointerCancel()

// ── Dropping a HUD card onto the map ──
// Native drag-and-drop: the drag starts in the HUD, outside the canvas, so OrbitControls never
// sees it. The id arrives through a prop because browsers hide dataTransfer contents during
// `dragover`, which is when the preview has to be drawn. The handlers sit on the container so a
// drop onto a label or overlay inside the map still counts.
function onExternalDragOver(event: DragEvent) {
  const participantId = props.externalDragParticipantId
  if (!participantId) return
  const placement = dropTargetAt(event, participantId)
  showDropGhost(placement)
  if (placement?.valid) {
    event.preventDefault()   // the only way to mark a spot as a legal drop target
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  } else if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'none'
  }
}

function onExternalDragLeave(event: DragEvent) {
  // dragleave also fires when crossing between children of the container; only react to really leaving it.
  const container = containerRef.value
  if (container && event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
  if (hoverGhostGroup) clearMapGroup(hoverGhostGroup)
  requestRender()
}

function onExternalDrop(event: DragEvent) {
  const participantId = props.externalDragParticipantId
  if (!participantId) return
  event.preventDefault()
  const placement = dropTargetAt(event, participantId)
  clearMapGroup(hoverGhostGroup)
  requestRender()
  if (placement?.valid) emit('unit-dragged', participantId, placement.cell)
}

function participantRegionFromHits(hits: THREE.Intersection[]): { anchor: Vec3; dims: FootprintDims; point: Vec3 } | null {
  const sprite = hits.find(hit => hit.object.userData.type === 'sprite' && props.participantPositions[hit.object.userData.participantId])
  if (sprite) {
    const id = sprite.object.userData.participantId as string
    return { anchor: { ...props.participantPositions[id] }, dims: getParticipantFootprintDims(id), point: { x: sprite.point.x, y: sprite.point.y, z: sprite.point.z } }
  }
  const surface = hits.find(isPlacementSurface)
  if (!surface) return null
  const { tile, voxel, type } = surface.object.userData
  const anchor = type === 'voxel' && voxel
    ? { x: voxel.x, y: voxel.y + 1, z: voxel.z }
    : { x: Math.floor(surface.point.x), y: tile?.y ?? 0, z: Math.floor(surface.point.z) }
  return { anchor, dims: { width: 1, height: 1, depth: 1 }, point: { x: surface.point.x, y: surface.point.y, z: surface.point.z } }
}

// Both direct clicks and the overlap chooser continue through the same selection
// rules: valid targets, GM actions, owned actions, or a character's health.
function canUseTurnRadial(participant: CombatParticipant): boolean {
  if (props.combatActive === false || participant.inReserve || !['tamer', 'digimon'].includes(participant.type)) return false
  if (participant.id === props.activeParticipantId) return true
  const active = props.participants.find(p => p.id === props.activeParticipantId && !p.inReserve)
  return participant.type === 'digimon' && active?.type === 'tamer'
    && props.digimonMap[participant.entityId]?.partnerId === active.entityId
}

function selectMapParticipant(participantId: string, point: THREE.Vector3) {
  const p = props.participants.find(p => p.id === participantId)
  if (!p || p.inReserve || !props.participantPositions[participantId]) return
  if (tryReticuleTarget(participantId)) return
  clickedHealthBar.value = null

  if (props.isDm) {
    const playerControlled = p.type === 'tamer' || !!props.digimonMap[p.entityId]?.partnerId
    const current = canUseTurnRadial(p) ? (playerControlled ? playerRadialId : npcRadialId) : gmRadialId
    const wasOpen = current.value === participantId
    closeRadial()
    if (!wasOpen) current.value = participantId
    updateRadialScreen()
    return
  }

  if (props.myParticipantIds.includes(participantId) && props.activeParticipantId !== null &&
    props.myParticipantIds.includes(props.activeParticipantId)) {
    const wasOpen = playerRadialId.value === participantId
    closeRadial()
    if (!wasOpen) playerRadialId.value = participantId
    updateRadialScreen()
    return
  }

  const info = p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId]
  if (!info) return
  closeRadial()
  const screen = worldToScreen2D(point)
  const currentWounds = p.currentWounds ?? info.currentWounds
  const maxWounds = p.maxWounds ?? info.woundBoxes
  clickedHealthBar.value = {
    name: participantDisplayNames.value[p.id] ?? info.name,
    pct: maxWounds > 0 ? Math.max(0, 1 - currentWounds / maxWounds) : 1,
    current: currentWounds, max: maxWounds,
    screenX: screen?.x ?? 0, screenY: (screen?.y ?? 0) - 80,
  }
}

function onCanvasClick(event: MouseEvent) {
  if (suppressNextClick) { suppressNextClick = false; return }
  if (props.isDm && props.activeTool !== 'select') return
  const hits = getIntersection(event)  // also updates raycaster for plane intersection below

  // Movement mode click — use the same aim plane as the hover preview.
  // Must run before the hits.length early-return so clicking empty space still works.
  const moveAim = getMoveAim()
  if (moveAim) {
    const cell = moveCellAt(event, moveAim.y)
    if (cell) {
      if (moveAim.isGm) {
        if (validGmMoveCell(cell, moveAim.participantId)) {
          clearMapGroup(hoverGhostGroup)
          hoveredMoveScreen.value = null
          emit('gm-moved', moveAim.participantId, cell)
        }
      } else if (props.reachableCells.has(vec3Key(cell))) {
        const pid = moveAim.participantId
        const isChargeAfter = pid === props.chargeMoveParticipantId
        if (!isChargeAfter || !footprintOccupied(cell, getParticipantFootprintDims(pid), pid)) {
          movingParticipantId.value = null
          clearMapGroup(hoverGhostGroup)
          hoveredMoveScreen.value = null
          emit('unit-moved', pid, cell, props.activePath)
        }
      }
    }
    return
  }

  // Charge "before" + area attack: first click picks the move destination from reachableCells.
  // onChargeTargetSelected moves the attacker and clears chargeMode, letting the normal AOE
  // aiming/placement flow take over from the new position on the next click.
  if (props.chargeMode === 'before' && props.selectedAttack && getAreaShape(props.selectedAttack.tags)) {
    const surfaceHit = hits.find(h => h.object.userData.type === 'ground' || h.object.userData.type === 'space' || h.object.userData.type === 'voxel')
    if (surfaceHit) {
      const hitType = surfaceHit.object.userData.type
      const tile = surfaceHit.object.userData.tile as { y: number } | undefined
      const voxel = surfaceHit.object.userData.voxel as { x: number; y: number; z: number } | undefined
      const cell: Vec3 = hitType === 'voxel' && voxel
        ? { x: voxel.x, y: voxel.y + 1, z: voxel.z }
        : { x: Math.floor(surfaceHit.point.x), y: tile?.y ?? 0, z: Math.floor(surfaceHit.point.z) }
      const attackerId = effectiveAttackerId.value
      if (attackerId && props.reachableCells.has(vec3Key(cell))) {
        const attackerDims = getParticipantFootprintDims(attackerId)
        if (!footprintOccupied(cell, attackerDims, attackerId)) {
          emit('charge-target-selected', attackerId, cell, null)
        }
      }
    }
    return
  }

  // AOE confirmation click (left click when area attack is active)
  if (props.selectedAttack && areaHighlightCells.value.length > 0) {
    const shape = getAreaShape(props.selectedAttack.tags)
    if (shape) {
      // [Pass]: block both the step1->step2 lock-in and the terminal confirm while no
      // landing (movement, possibly +RAM) is valid. Targeting via areaHighlightCells is
      // unaffected — only the attacker's own finishing move is gated.
      if (shape === 'pass' && !passLandingValid) return

      // [Pass] step 1: lock direction + movement length. Either move to step 2 (extra-movement
      // aiming) or, if the attacker has no RAM to spend, fall through and confirm immediately.
      if (shape === 'pass' && passStep.value !== 'extra' && lastAreaShapeData.value) {
        passLockedDir = normalize3(lastAreaShapeData.value.dir)
        passMovementLength = lastAreaShapeData.value.movement
        if ((props.selectedAttack.ram ?? 0) > 0) {
          passStep.value = 'extra'
          renderPassRangeBand()
          return
        }
      }

      const aoeCellSet = new Set(areaHighlightCells.value.map(c => `${c.x},${c.y},${c.z}`))
      const targetIds = props.participants
        .filter(p => {
          if (p.id === effectiveAttackerId.value) return false
          const pos = props.participantPositions[p.id]
          // A target is hit if ANY of its footprint cells falls in the area
          return pos && footprintIntersectsArea(pos, getParticipantFootprintDims(p.id), aoeCellSet)
        })
        .map(p => p.id)
      const areaShapeData = lastAreaShapeData.value
      clearAoeState()
      emit('area-attack-confirmed', targetIds, areaShapeData)
      return
    }
  }

  if (!hits.length) {
    clickedHealthBar.value = null
    return
  }

  const placementSurfaceHit = hits.find(isPlacementSurface)

  // Setup placement uses a valid tile/voxel surface. GM Move was handled above
  // on its unrestricted aim plane, which also permits open-air destinations.
  const placeId = props.placingParticipantId ?? props.gmMoveParticipantId
  if (placeId && placementSurfaceHit) {
    const placement = evaluatePlacementAt(placementSurfaceHit, placeId)
    if (!placement.valid) return
    if (props.placingParticipantId) emit('unit-placed', placeId, placement.cell)
    else emit('gm-moved', placeId, placement.cell)
    return
  }

  // Shared squares must be disambiguated before targeting, actions or health can
  // select whichever sprite happened to be first in the raycast.
  const region = participantRegionFromHits(hits)
  if (region) {
    const candidates = participantCandidatesAt(region.anchor, region.dims)
    if (candidates.length > 1) {
      closeRadial()
      clickedHealthBar.value = null
      participantChoice.value = region
      updateRadialScreen()
      return
    }
    if (candidates.length === 1) {
      selectMapParticipant(candidates[0]!.id, new THREE.Vector3(region.point.x, region.point.y, region.point.z))
      return
    }
  }

  // Single-target attack or intercede target selection (the same lookup drives the green hover outline)
  const reticuleTargetId = reticuleTargetFromHits(hits)
  if (reticuleTargetId && tryReticuleTarget(reticuleTargetId)) return

  // Click empty space — close health bar, NPC radial, player radial, GM radial, exit move mode
  clickedHealthBar.value = null
  closeRadial()
  if (!pendingMovePos.value) movingParticipantId.value = null
}

function onCanvasWheel(event: WheelEvent) {
  if (getMoveAim() || usesVerticalAim.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    onWheel(event)
    return
  }
  if (!props.isDm || (props.activeTool !== 'ramp' && props.activeTool !== 'stairs')) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.deltaY === 0) return
  emit('rotate-ramp', event.deltaY > 0 ? 1 : -1)
  // The parent owns the brush direction; redraw once its updated prop reaches this canvas.
  nextTick(() => {
    if (props.isDm && (props.activeTool === 'ramp' || props.activeTool === 'stairs')) updateHoverGhost(event)
  })
}

function onWheel(event: WheelEvent) {
  const aim = getMoveAim()
  if (aim) {
    if (aim.isGm) {
      const delta = event.deltaY > 0 ? -1 : 1
      gmMoveY.value += delta
      // Follow the free-move plane so raising it above the camera does not put
      // it behind the pointer ray and make the ghost disappear.
      if (camera && controls) {
        camera.position.y += delta
        controls.target.y += delta
        controls.update()
      }
    } else npcMoveY.value += event.deltaY > 0 ? -1 : 1
    onMouseMove(event)
    return
  }
  if (usesVerticalAim.value) {
    // This path handles scroll events that target overlay elements (HUD, log, etc.) instead of the canvas
    adjustAimY(event.deltaY > 0 ? -1 : 1)
  }
}

// ── Move confirmation ──────────────────────────────────────────────────────
function confirmMove() {
  if (!pendingMovePos.value || !movingParticipantId.value) return
  emit('unit-moved', movingParticipantId.value, pendingMovePos.value, pendingMovePath.value)
  pendingMovePos.value = null
  movePendingScreen.value = null
  movingParticipantId.value = null
  pendingMovePath.value = []
}

function cancelMove() {
  pendingMovePos.value = null
  movePendingScreen.value = null
  pendingMovePath.value = []
}

function npcAction(action: 'move' | 'stance' | 'attack' | 'clash' | ClashRadialAction) {
  const id = npcRadialId.value
  if (!id) return
  closeRadial()
  emit('npc-action', id, action)
}

// ── Resize ─────────────────────────────────────────────────────────────────
function onResize() {
  const container = containerRef.value
  if (!container) return
  radialBounds.value = { width: container.clientWidth, height: container.clientHeight }
  camera.aspect = container.clientWidth / container.clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(container.clientWidth, container.clientHeight)
  invalidateFrame()
}

// ── Watchers — rebuild scene on prop changes ───────────────────────────────
watch(() => props.map, () => { if (scene) buildMap() })
watch(() => props.destructibleStates, () => { if (scene) buildMap() }, { deep: true })
watch([
  () => props.participants, () => props.participantPositions, () => props.tamerMap, () => props.digimonMap,
  () => props.selectedAttack, () => props.selectableParticipantIds, () => props.activeParticipantId,
  () => props.secondaryActiveParticipantId, () => props.attackerRange, () => props.attackerEffectiveLimit,
  () => props.attackerMeleeRange, () => props.activePath, () => props.reachableCells,
  () => props.activeTool, () => props.rampDirection, () => props.currentEditY,
  () => props.chargeMode, () => props.chargeMoveParticipantId, () => props.npcMoveParticipantId,
  () => props.gmMoveParticipantId,
  movingParticipantId, pendingMovePos, npcMoveY, gmMoveY, areaHighlightCells, radialParticipantId, participantChoice,
], invalidateFrame, { deep: true })

// Snapshots recreate the entity maps even when only actions or the active turn changed.
// Compare the inputs used by buildSprites, leaving portrait/health/stance updates to the overlays.
function spriteGeometrySignature(): string {
  const layout = props.participants.flatMap(p => {
    const position = props.participantPositions[p.id]
    if (!position) return []
    const digimon = p.type === 'digimon' ? props.digimonMap[p.entityId] : undefined
    const { tileCount } = getSizeParams(digimon?.size ?? 'medium', digimon?.giganticDimensions)
    return [{
      id: p.id, type: p.type, entityId: p.entityId,
      x: position.x, y: position.y, z: position.z, tileCount,
    }]
  })
  return JSON.stringify(layout.sort((a, b) => a.id.localeCompare(b.id)))
}

function watchParticipantSprites() {
  watch(spriteGeometrySignature, () => {
    lastAttackKey = ''  // changed target positions, forms or footprints affect targeting
    if (scene) buildSprites()
  })
  watch([() => props.activeParticipantId, () => props.secondaryActiveParticipantId], () => {
    closeRadial()
    if (scene) refreshBorderColors()
  })
}

watchParticipantSprites()

watch([radialParticipantId, participantChoice], ([id, choice]) => { if (id || choice) keysHeld.clear() })
watch(() => participantChoiceItems.value.map(item => item.id).join(','), () => {
  if (participantChoice.value && participantChoiceItems.value.length < 2) closeRadial()
})
watch(() => props.participants.map(p => p.id).join(','), () => {
  if (radialParticipantId.value && !props.participants.some(p => p.id === radialParticipantId.value)) closeRadial()
})

// Outlines follow the targetable set (red), and the green hover drops once its participant stops
// being targetable (attack confirmed/cancelled, out of range)
watch(reticuleParticipantIds, ids => {
  if (hoveredTargetId && !ids.includes(hoveredTargetId)) hoveredTargetId = null
  refreshBorderColors()
  requestRender()
})

watch(() => props.reachableCells, () => { lastAttackKey = '' }, { deep: true })

watch(() => props.activeTool, (tool) => {
  if (tool !== 'select') closeRadial()
  if (controls) controls.enabled = (tool === 'select')
}, { immediate: true })

// A HUD drag that ends anywhere but a valid cell (dropped off the map, or Esc) leaves its preview
// behind, since `dragleave`/`drop` never fire for a refused spot.
watch(() => props.externalDragParticipantId, (id) => {
  if (!id && hoverGhostGroup) clearMapGroup(hoverGhostGroup)
  requestRender()
})

// Enter NPC movement mode when EncounterMap signals reachable cells are ready
watch(() => props.npcMoveParticipantId, id => {
  if (id) {
    movingParticipantId.value = id
    npcMoveY.value = props.participantPositions[id]?.y ?? 0
  } else if (!props.chargeMoveParticipantId) movingParticipantId.value = null
})

// Enter movement mode for the post-charge "Move After Attack" relocation step
watch(() => props.chargeMoveParticipantId, id => {
  if (id) {
    movingParticipantId.value = id
    npcMoveY.value = props.participantPositions[id]?.y ?? 0
  } else if (!props.npcMoveParticipantId) movingParticipantId.value = null
})

// GM repositioning uses its own aim plane, independent of movement capabilities
// and reachable cells. A stable participant id keeps the chosen Y across polls.
watch(() => props.gmMoveParticipantId, id => {
  if (!id) return
  movingParticipantId.value = null
  gmMoveY.value = props.participantPositions[id]?.y ?? 0
  closeRadial()
}, { immediate: true })

// Use actual A* path length (steps = meters) for the distance label
watch(() => props.activePath, (path) => {
  if (!getMoveAim()?.isGm) hoveredMoveDistance.value = path.length > 1 ? path.length - 1 : 0
})

// Track move start position; toggle zoom; clear ghost when movement mode ends
watch([movingParticipantId, () => props.gmMoveParticipantId], ([normalId, gmId], [previousNormalId]) => {
  const id = normalId ?? gmId
  if (id) {
    moveStartPos.value = props.participantPositions[id] ?? null
    if (controls) controls.enableZoom = false
  } else {
    moveStartPos.value = null
    hoveredMoveScreen.value = null
    hoveredMoveDistance.value = 0
    if (hoverGhostGroup) clearMapGroup(hoverGhostGroup)
    if (controls) controls.enableZoom = true
    emit('cell-hovered', null)
    if (previousNormalId) emit('movement-cancelled')
  }
})

watch(() => props.selectedAttack, (attack, prevAttack) => {
  if (attack) closeRadial()
  if (!attack) {
    clearAoeState()
    blastCenterY.value = 0
    blastLosBlocked.value = false
    lastBlastCenter.value = null
    lastAreaAimEvent = null
    return
  }
  const shape = getAreaShape(attack.tags)
  const prevShape = prevAttack ? getAreaShape(prevAttack.tags) : null
  // Initialise the aim elevation only when NEWLY entering an area shape — the parent poll loop
  // re-creates this prop object every few seconds, which must not reset the user's chosen height.
  if (shape !== null && shape !== prevShape) {
    const attackerPos = effectiveAttackerId.value ? props.participantPositions[effectiveAttackerId.value] : null
    blastCenterY.value = attackerPos?.y ?? 0
    blastLosBlocked.value = false
    lastBlastCenter.value = null
    lastAreaAimEvent = null
    resetPassState()
  }
  if (shape === 'burst') {
    // Burst has no direction — render immediately from the whole footprint.
    const attackerPos = effectiveAttackerId.value ? props.participantPositions[effectiveAttackerId.value] : null
    if (!attackerPos) return
    const cells = computeAreaCells(
      'burst', attack.range, attackerPos, { x: 0, y: 0, z: 0 },
      attack.bit, attack.ram ?? 0, attack.movement ?? 0, getParticipantFootprintDims(effectiveAttackerId.value),
    )
    const { hitCells, blockedCells } = classifyCellsByLos(cells, attackerPos)
    updateAoeHighlight(hitCells, blockedCells)
  }
}, { immediate: false })

watch(clipY, (y) => {
  for (const obj of buildMeshes) {
    const fY = (obj as any).userData?.floorY
    if (fY !== undefined) obj.visible = fY <= y
  }
  terrain?.setClipY(y)
  invalidateFrame()
})

watch(() => props.showSpawnIndicators, (show) => {
  terrain?.setSpawnVisible(show !== false)
  invalidateFrame()
})

watch(ghostWalls, (ghost) => {
  for (const obj of buildMeshes) {
    const type = (obj as any).userData?.type
    if (type !== 'wall' && type !== 'ceiling') continue
    const mat = (obj as THREE.Mesh).material as THREE.MeshLambertMaterial
    if (!mat) continue
    mat.transparent = true
    mat.opacity = ghost ? 0.2 : 1.0
    mat.needsUpdate = true
  }
  invalidateFrame()
})

// ── Helpers ────────────────────────────────────────────────────────────────
function healthBarClass(pct: number) {
  if (pct >= 1) return 'green'
  if (pct > 0.5) return 'yellow'
  if (pct > 0) return 'orange'
  return 'red'
}

// Expose for parent use
defineExpose({ movingParticipantId })
</script>

<style scoped>
.map-canvas-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.map-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.health-bar-popup {
  position: absolute;
  transform: translateX(-50%);
  background: rgba(10, 10, 20, 0.9);
  border: 1px solid #334;
  border-radius: 6px;
  padding: 6px 10px;
  min-width: 120px;
  pointer-events: none;
  z-index: 30;
}
.health-bar-name {
  font-size: 11px;
  color: #aabbcc;
  margin-bottom: 4px;
  text-align: center;
}
.health-bar-track {
  width: 100%;
  height: 8px;
  background: #223;
  border-radius: 4px;
  overflow: hidden;
}
.health-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.2s;
}
.health-bar-fill.green  { background: #22cc55; }
.health-bar-fill.yellow { background: #eab308; }
.health-bar-fill.orange { background: #f97316; }
.health-bar-fill.red    { background: #dd2222; }
.health-bar-label {
  font-size: 10px;
  color: #778;
  text-align: center;
  margin-top: 3px;
}
.move-confirm-popup {
  position: absolute;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 30;
}
.move-confirm-btn {
  padding: 6px 14px;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 600;
}
.move-confirm-btn.confirm { background: #22aa55; color: #fff; }
.move-confirm-btn.cancel  { background: #aa2222; color: #fff; }
.map-view-controls {
  position: absolute;
  bottom: calc(50px + var(--overlay-bottom, 10px));
  right: 10px;
  background: rgba(10, 12, 25, 0.85);
  border: 1px solid #334;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 25;
  pointer-events: auto;
}
.map-view-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #aabbcc;
}
.clip-input { width: 55px; background: #111420; border: 1px solid #445; border-radius: 3px; color: #aabbcc; padding: 1px 4px; font-size: 11px; }
.map-view-controls button {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid #445;
  border-radius: 4px;
  background: #1a1e30;
  color: #aabbcc;
  cursor: pointer;
}
.map-view-controls button.active {
  background: #2a3060;
  border-color: #6688cc;
  color: #cceeff;
}
.char-overlays {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
  /* Below the EncounterMap chrome overlays (combat log, HUD, etc. at z-index 20)
     so UI panels render over the 3D tokens, but above the WebGL canvas. */
  z-index: 15;
}
.char-token {
  position: absolute;
  transform: translateX(-50%);
  border-radius: 50%;
  overflow: hidden;
  border: 5px solid;
  box-shadow: 0 0 8px rgba(0,0,0,0.8);
}
.char-token-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
  display: block;
}
.char-token-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a3880;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}
.char-token-wound-filter {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.char-token-wound-filter.yellow {
  background: rgba(255, 255, 0, 0.2);
}
.char-token-wound-filter.red {
  background: rgba(255, 0, 0, 0.2);
}
.move-distance-label {
  position: absolute;
  transform: translate(-50%, -100%);
  background: rgba(10,20,60,0.88);
  color: #88aaff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  pointer-events: none;
  z-index: 28;
  white-space: nowrap;
}
</style>
