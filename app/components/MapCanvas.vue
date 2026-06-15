<template>
  <div ref="containerRef" class="map-canvas-container" @wheel.prevent="onWheel">
    <canvas ref="canvasRef" class="map-canvas" />
    <!-- Y-clip + ghost walls controls -->
    <div class="map-view-controls">
      <div class="map-view-row">
        <span>Y-clip</span>
        <input type="number" v-model.number="clipY" min="-5" max="20" step="1" class="clip-input" />
      </div>
      <button :class="{ active: ghostWalls }" @click="ghostWalls = !ghostWalls">Ghost Walls</button>
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
      <div
        v-for="(ov, pid) in characterOverlays"
        :key="pid"
        class="char-token"
        :style="{ left: ov.x + 'px', top: ov.y + 'px', width: ov.w + 'px', height: ov.h + 'px', borderColor: STANCE_COLORS[ov.stance], zIndex: ov.zIndex }"
      >
        <img v-if="ov.spriteUrl" :src="ov.spriteUrl" class="char-token-img" />
        <div v-else class="char-token-fallback">{{ ov.initial }}</div>
        <div v-if="ov.woundFilter" class="char-token-wound-filter" :class="ov.woundFilter" />
        <div v-if="reticuleParticipantIds.includes(String(pid))" class="target-reticule" />
      </div>
    </div>
    <!-- Movement distance label -->
    <div
      v-if="hoveredMoveScreen && movingParticipantId"
      class="move-distance-label"
      :style="{ left: hoveredMoveScreen.x + 'px', top: hoveredMoveScreen.y + 'px' }"
    >{{ hoveredMoveDistance }} m</div>
    <!-- NPC radial action menu -->
    <div
      v-if="npcRadialScreen && npcRadialId"
      class="npc-radial-menu"
      :style="{ left: npcRadialScreen.x + 'px', top: npcRadialScreen.y + 'px' }"
    >
      <button class="npc-radial-btn move"   :disabled="npcOutOfActions" @click="npcAction('move')">Move</button>
      <button class="npc-radial-btn stance" @click="npcAction('stance')">Stance</button>
      <button class="npc-radial-btn attack" :disabled="npcOutOfActions" @click="npcAction('attack')">Attack</button>
      <button class="npc-radial-btn clash"  :disabled="npcOutOfActions" @click="npcAction('clash')">Clash</button>
    </div>
    <!-- Player radial action menu -->
    <div
      v-if="playerRadialScreen && playerRadialId"
      class="npc-radial-menu"
      :style="{ left: playerRadialScreen.x + 'px', top: playerRadialScreen.y + 'px' }"
    >
      <button class="npc-radial-btn player move" :disabled="radialPlayerOutOfActions" @click="playerRadialMove()">Move</button>
      <template v-if="playerRadialParticipantType === 'tamer'">
        <button class="npc-radial-btn player direct" :disabled="directDisabled" @click="playerRadialAction('direct')">Direct</button>
        <button class="npc-radial-btn player orders" @click="playerRadialAction('special-order')">Orders</button>
        <button class="npc-radial-btn player stance tamer-stance" @click="playerRadialAction('stance')">Stance</button>
        <button class="npc-radial-btn player clash" :disabled="radialPlayerOutOfActions" @click="playerRadialAction('clash')">Clash</button>
      </template>
      <template v-else-if="playerRadialParticipantType === 'digimon'">
        <button class="npc-radial-btn player attack"    :disabled="radialPlayerOutOfActions" @click="playerRadialAction('attack')">Attack</button>
        <button class="npc-radial-btn player stance digimon-stance" @click="playerRadialAction('stance')">Stance</button>
        <button class="npc-radial-btn player digivolve" :disabled="digivolveDisabled" @click="playerRadialAction('digivolve')">Digivolve</button>
        <button v-if="hasModeChangeQuality" class="npc-radial-btn player mode-change" :disabled="modeChangeDisabled" @click="playerRadialAction('mode-change')">Mode Change</button>
        <button class="npc-radial-btn player clash" :disabled="radialPlayerOutOfActions" @click="playerRadialAction('clash')">Clash</button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type {
  GameMap, Vec3, CombatParticipant, ElementType, MapTool, DigimonSize,
  DestructibleState, WallFace, Stance, EddySoulRules,
} from '~/types'
import { ELEMENT_COLORS } from '~/types'
import { vec3Key, parseVec3Key } from '~/utils/mapGeometry'
import { getVoxelColor, getVoxelMaterialDefinition, getVoxelOpacity, mapVoxelBlocksMovement } from '~/utils/mapVoxels'
import { getAreaShape, computeAreaCells, computePassBeam, normalize3, computePassLanding } from '~/utils/areaShapes'
import type { AreaShapeData } from '~/utils/areaShapes'
import type { FootprintDims, MovementCapabilities } from '~/utils/movementRules'
import { getFootprintDimensions, getFootprintCells, canLandOn } from '~/utils/movementRules'
import { detectCapabilities } from '~/composables/useMapMovement'
import { STANCE_COLORS } from '~/utils/stanceModifiers'

// ── Props ──────────────────────────────────────────────────────────────────
const props = defineProps<{
  map: GameMap | null
  participants: CombatParticipant[]
  participantPositions: Record<string, Vec3>
  destructibleStates: DestructibleState[]
  tamerMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number }>
  digimonMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number; size: DigimonSize; giganticDimensions?: { width: number; height: number; depth: number } | null; partnerId?: string | null; qualities?: any[] }>
  activeTool: MapTool
  drawMode: 'line' | 'square' | 'cube'
  currentEditY: number
  isDm: boolean
  myParticipantIds: string[]  // participant IDs the current user controls
  activeParticipantId: string | null  // whose turn it is
  secondaryActiveParticipantId: string | null  // partner of the active participant, also highlighted
  selectedAttack: { tags: string[]; range: 'melee' | 'ranged'; type?: string; bit: number; movement?: number; ram?: number; sizeAboveLarge?: number; effectiveLimit?: number; meleeRange?: number; attackerParticipantId?: string | null } | null
  attackerRange: number
  attackerEffectiveLimit: number
  attackerMeleeRange: number  // 1 + reach*2
  reachableCells: Set<string>
  activePath: Vec3[]
  placingParticipantId: string | null
  npcMoveParticipantId: string | null
  chargeMode: 'before' | 'after' | null
  chargeMoveParticipantId: string | null
  showSpawnIndicators?: boolean
  selectableParticipantIds?: string[]
  eddySoulRules?: EddySoulRules
}>()

const emit = defineEmits<{
  (e: 'unit-placed', participantId: string, position: Vec3): void
  (e: 'unit-moved', participantId: string, position: Vec3, path: Vec3[]): void
  (e: 'cell-clicked', cell: Vec3): void
  (e: 'cell-draw', start: Vec3, end: Vec3): void
  (e: 'wall-edit', wallId: string): void
  (e: 'wall-edit-at-edge', tile: Vec3, face: WallFace, mode?: string): void
  (e: 'wall-place', startTile: Vec3, endTile: Vec3, face: WallFace): void
  (e: 'voxel-edit', cell: Vec3, mode?: 'window' | 'spawn'): void
  (e: 'target-selected', participantId: string): void
  (e: 'area-attack-confirmed', targetParticipantIds: string[], areaShapeData: AreaShapeData | null): void
  (e: 'attack-cancelled'): void
  (e: 'charge-target-selected', attackerId: string, destination: Vec3, targetId: string | null): void
  (e: 'npc-action', participantId: string, action: 'move' | 'stance' | 'attack' | 'clash'): void
  (e: 'player-action', participantId: string, action: 'move' | 'attack' | 'direct' | 'special-order' | 'stance' | 'digivolve' | 'mode-change' | 'clash'): void
  (e: 'cell-hovered', cell: Vec3 | null): void
  (e: 'movement-cancelled'): void
  (e: 'wall-selected', wallId: string): void
  (e: 'map-changed'): void
}>()

// ── Participant display names matching encounter page getDisplayName logic ───
// The participant whose position is the attack origin — may differ from activeParticipantId
// when a tamer's partner digimon attacks on the tamer's turn.
const effectiveAttackerId = computed(() =>
  props.selectedAttack?.attackerParticipantId ?? props.activeParticipantId
)

const participantDisplayNames = computed(() => {
  const nameGroups: Record<string, string[]> = {}
  for (const p of props.participants) {
    const info = p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId]
    if (!info) continue
    if (!nameGroups[info.name]) nameGroups[info.name] = []
    nameGroups[info.name].push(p.id)
  }
  for (const name in nameGroups) nameGroups[name].sort((a, b) => a.localeCompare(b))
  const result: Record<string, string> = {}
  for (const p of props.participants) {
    const info = p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId]
    if (!info) continue
    const group = nameGroups[info.name]
    result[p.id] = group.length > 1 ? `${info.name} ${group.indexOf(p.id) + 1}` : info.name
  }
  return result
})

// ── Refs ───────────────────────────────────────────────────────────────────
const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const clickedHealthBar = ref<{ name: string; pct: number; current: number; max: number; screenX: number; screenY: number } | null>(null)
const pendingMovePos = ref<Vec3 | null>(null)
const movePendingScreen = ref<{ x: number; y: number } | null>(null)
const pendingMovePath = ref<Vec3[]>([])
const movingParticipantId = ref<string | null>(null)
const npcRadialId = ref<string | null>(null)
const npcRadialScreen = ref<{ x: number; y: number } | null>(null)
const npcRadialParticipant = computed(() =>
  npcRadialId.value ? (props.participants.find(p => p.id === npcRadialId.value) ?? null) : null
)
const npcOutOfActions = computed(() => {
  const p = npcRadialParticipant.value
  return !p || (p.actionsRemaining?.simple || 0) < 1
})
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
const moveStartPos = ref<Vec3 | null>(null)
const hoveredMoveScreen = ref<{ x: number; y: number } | null>(null)
const hoveredMoveDistance = ref<number>(0)
const npcMoveY = ref<number>(0)
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
let rafId: number
let blendTextureCache: Map<string, THREE.CanvasTexture> = new Map()
let occludeRaycaster: THREE.Raycaster
let spriteGroups: Map<string, THREE.Group>  // participantId → group
let tileMeshes: THREE.Mesh[] = []
let buildMeshes: THREE.Object3D[] = []
let spawnMeshes: THREE.Object3D[] = []
let wallMeshes: Array<{ mesh: THREE.Mesh; wallId: string; cell: Vec3 }> = []
let voxelMeshes: THREE.Mesh[] = []
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
let isSnapping = false
let rightDragActive = false
let rightDragLastX = 0
let rightDragAccum = 0
const PIXELS_PER_SNAP = 50
const keysHeld = new Set<string>()
const clipY = ref(20)
const ghostWalls = ref(false)
const TILE_SIZE = 1
const TILE_H = 0.12
const WALL_H = 1
const WINDOW_H = 0.6
const WINDOW_FRAME = (WALL_H - WINDOW_H) / 2
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
  return props.participants.some(p => {
    if (p.id === excludeId) return false
    const oPos = props.participantPositions[p.id]
    if (!oPos) return false
    const oCellSet = new Set(getFootprintCells(oPos, getParticipantFootprintDims(p.id)).map(c => `${c.x},${c.y},${c.z}`))
    return footprintIntersectsArea(anchor, dims, oCellSet)
  })
}

// Movement capabilities of a Pass attacker, for landing-support validation (canFly etc.).
// Movement/RAM/CPU args only affect jumpRange/jumpHeight, which landing checks don't use.
function getAttackerCapabilities(participantId: string | null | undefined): MovementCapabilities {
  const empty: MovementCapabilities = { canFly: false, canJump: false, jumpRange: 0, jumpHeight: 0, canClimb: false, canSwim: false, canDig: false }
  if (!participantId) return empty
  const p = props.participants.find(pp => pp.id === participantId)
  if (!p || p.type !== 'digimon') return empty
  const dg = props.digimonMap[p.entityId]
  if (!dg) return empty
  return detectCapabilities(dg.qualities ?? [], 0, 0, 0)
}

// A [Pass] landing is valid if the attacker's footprint at `anchor` doesn't overlap any
// other participant, and the anchor cell itself is supported terrain/voxel/stairs (or
// open air the attacker can fly in).
function isPassLandingValid(anchor: Vec3, dims: FootprintDims, attackerId: string, caps: MovementCapabilities): boolean {
  if (footprintOccupied(anchor, dims, attackerId)) return false
  if (!props.map) return true
  return canLandOn(anchor, caps, props.map, new Set())
}

// Whether ANY ram value in [0, ramMax] yields a valid landing for this (attackerPos, dir,
// movement). If false, the aim is "filtered": no amount of RAM repositioning can produce a
// legal finish, so it cannot be locked in (step 1) or confirmed (step 2) — though the hit-area
// pillar computed from `movement` remains valid for targeting enemies caught in it.
function anyPassLandingValid(attackerPos: Vec3, dir: Vec3, movement: number, ramMax: number, dims: FootprintDims, attackerId: string, caps: MovementCapabilities): boolean {
  for (let ram = 0; ram <= ramMax; ram++) {
    if (isPassLandingValid(computePassLanding(attackerPos, dir, movement, ram), dims, attackerId, caps)) return true
  }
  return false
}

// Renders the [Pass] landing footprint: green if a valid finish is reachable from here
// (using RAM if needed), red if filtered (no amount of RAM lands clear).
function renderPassLandingMarker(anchor: Vec3, dims: FootprintDims, valid: boolean) {
  passLandingGroup.clear()
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
  animate()

  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  canvasRef.value!.addEventListener('click', onCanvasClick)
  canvasRef.value!.addEventListener('mousemove', onMouseMove)
  canvasRef.value!.addEventListener('mousedown', onMouseDown)
  canvasRef.value!.addEventListener('mouseup', onMouseUp)
  canvasRef.value!.addEventListener('contextmenu', e => e.preventDefault())
  // Intercept wheel on canvas directly so OrbitControls never zooms during movement or blast-aim mode
  canvasRef.value!.addEventListener('wheel', (e) => {
    if (movingParticipantId.value) {
      e.preventDefault()
      e.stopPropagation()
      npcMoveY.value = npcMoveY.value + (e.deltaY > 0 ? -1 : 1)
      return
    }
    if (usesVerticalAim.value) {
      e.preventDefault()
      e.stopPropagation()
      adjustAimY(e.deltaY > 0 ? -1 : 1)
    }
  }, { passive: false, capture: true })
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  renderer?.dispose()
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  for (const tex of blendTextureCache.values()) tex.dispose()
  blendTextureCache.clear()
})

// ── Scene init ─────────────────────────────────────────────────────────────
function initScene() {
  const canvas = canvasRef.value!
  const container = containerRef.value!

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
  controls.addEventListener('change', () => emit('map-changed'))
  controls.addEventListener('end', () => snapAzimuth(0))

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
  tileMeshes = []
  occludeRaycaster = new THREE.Raycaster()
  occludeRaycaster.near = 0.1

}

// ── Right-drag rotation (custom accumulation for snap-per-threshold) ──────
function applyRightDragRotation(dx: number) {
  rightDragAccum += dx
  const step = Math.PI / 4
  while (rightDragAccum >= PIXELS_PER_SNAP) {
    snapAzimuth(-step)
    rightDragAccum -= PIXELS_PER_SNAP
  }
  while (rightDragAccum <= -PIXELS_PER_SNAP) {
    snapAzimuth(+step)
    rightDragAccum += PIXELS_PER_SNAP
  }
}

// ── Camera rotation snap ───────────────────────────────────────────────────
function snapAzimuth(delta = 0) {
  if (isSnapping) return
  const step = Math.PI / 4  // 22.5°
  const current = controls.getAzimuthalAngle()
  const snapped = Math.round((current + delta) / step) * step
  if (delta === 0 && Math.abs(current - snapped) < 1e-6) return
  isSnapping = true
  const dist = camera.position.distanceTo(controls.target)
  const polar = controls.getPolarAngle()
  camera.position.setFromSpherical(new THREE.Spherical(dist, polar, snapped)).add(controls.target)
  controls.update()
  isSnapping = false
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
function buildMap() {
  if (!props.map) return
  const map = props.map
  const destroyedIds = new Set(props.destructibleStates.filter(s => s.currentWounds <= 0).map(s => s.structureId))

  // Ground tiles
  const tileIndex = new Map<string, number>()
  for (const t of map.groundTiles) {
    if (t.element !== 'void')
      tileIndex.set(`${t.x},${t.y},${t.z}`, ELEMENT_COLORS[t.element as ElementType] ?? 0x888888)
  }

  for (const tile of map.groundTiles) {
    const centerColor = ELEMENT_COLORS[tile.element as ElementType] ?? 0x888888
    const y = tile.y
    const nc = tileIndex.get(`${tile.x},${y},${tile.z - 1}`)
    const sc = tileIndex.get(`${tile.x},${y},${tile.z + 1}`)
    const wc = tileIndex.get(`${tile.x - 1},${y},${tile.z}`)
    const ec = tileIndex.get(`${tile.x + 1},${y},${tile.z}`)
    const hasBlend = tile.element !== 'void' && (
      (nc && nc !== centerColor) || (sc && sc !== centerColor) ||
      (wc && wc !== centerColor) || (ec && ec !== centerColor)
    )
    const geo = new THREE.BoxGeometry(TILE_SIZE, TILE_H, TILE_SIZE)
    const mat = new THREE.MeshLambertMaterial({ color: centerColor })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(tile.x + 0.5, tile.y * TILE_SIZE + TILE_H / 2, tile.z + 0.5)
    mesh.receiveShadow = true
    mesh.userData = { type: 'ground', tile, floorY: tile.y }
    scene.add(mesh)
    tileMeshes.push(mesh)
    buildMeshes.push(mesh)
    if (hasBlend) {
      const overlayGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE)
      const overlayMat = new THREE.MeshBasicMaterial({
        map: makeBlendTexture(centerColor, nc, sc, ec, wc),
        transparent: true,
        depthWrite: false,
      })
      const overlay = new THREE.Mesh(overlayGeo, overlayMat)
      overlay.rotation.x = -Math.PI / 2
      overlay.position.set(tile.x + 0.5, tile.y * TILE_SIZE + TILE_H + 0.001, tile.z + 0.5)
      overlay.userData = { floorY: tile.y }
      scene.add(overlay)
      buildMeshes.push(overlay)
    }
    const edgesGeo = new THREE.EdgesGeometry(geo)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
    const lines = new THREE.LineSegments(edgesGeo, lineMat)
    lines.position.copy(mesh.position)
    lines.userData = { floorY: tile.y }
    scene.add(lines)
    buildMeshes.push(lines)
    if (tile.isSpawnPoint) {
      const spawnGeo = new THREE.PlaneGeometry(TILE_SIZE * 0.7, TILE_SIZE * 0.7)
      const spawnMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.4, depthWrite: false })
      const spawnMesh = new THREE.Mesh(spawnGeo, spawnMat)
      spawnMesh.rotation.x = -Math.PI / 2
      spawnMesh.position.set(tile.x + 0.5, tile.y * TILE_SIZE + TILE_H + 0.003, tile.z + 0.5)
      spawnMesh.userData = { floorY: tile.y }
      spawnMesh.visible = props.showSpawnIndicators !== false
      scene.add(spawnMesh)
      buildMeshes.push(spawnMesh)
      spawnMeshes.push(spawnMesh)
    }
  }

  // Space tiles (wireframe outlines)
  for (const tile of map.spaceTiles) {
    const geo = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE)
    const mat = new THREE.MeshBasicMaterial({ color: 0x334455, wireframe: true, opacity: 0.25, transparent: true })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(tile.x + 0.5, tile.y * TILE_SIZE + 0.5, tile.z + 0.5)
    mesh.userData = { type: 'space', tile, floorY: tile.y }
    scene.add(mesh)
    buildMeshes.push(mesh)
  }

  // Voxels (full 1×1×1 terrain/cover blocks)
  for (const voxel of map.voxels ?? []) {
    const geo = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE)
    const opacity = getVoxelOpacity(voxel)
    const def = getVoxelMaterialDefinition(voxel)
    const mat = new THREE.MeshLambertMaterial({
      color: getVoxelColor(voxel),
      transparent: opacity < 1 || Boolean(def.transparent),
      opacity,
      depthWrite: opacity >= 1,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(voxel.x + 0.5, voxel.y * TILE_SIZE + 0.5, voxel.z + 0.5)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData = { type: 'voxel', voxel, floorY: voxel.y }
    scene.add(mesh)
    buildMeshes.push(mesh)
    voxelMeshes.push(mesh)

    const edgesGeo = new THREE.EdgesGeometry(geo)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    const edges = new THREE.LineSegments(edgesGeo, edgeMat)
    edges.position.copy(mesh.position)
    edges.userData = { floorY: voxel.y }
    scene.add(edges)
    buildMeshes.push(edges)

    if (voxel.isSpawnPoint) {
      const spawnGeo = new THREE.PlaneGeometry(TILE_SIZE * 0.72, TILE_SIZE * 0.72)
      const spawnMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.48, depthWrite: false })
      const spawnMesh = new THREE.Mesh(spawnGeo, spawnMat)
      spawnMesh.rotation.x = -Math.PI / 2
      spawnMesh.position.set(voxel.x + 0.5, voxel.y * TILE_SIZE + TILE_SIZE + 0.004, voxel.z + 0.5)
      spawnMesh.userData = { floorY: voxel.y, type: 'voxel-spawn', voxel }
      spawnMesh.visible = props.showSpawnIndicators !== false
      scene.add(spawnMesh)
      buildMeshes.push(spawnMesh)
      spawnMeshes.push(spawnMesh)
    }
  }

  // Walls — frame-only when a window or door is present
  const walledWindowIds = new Set(map.windows.map(w => w.wallId))
  const walledDoorIds   = new Set(map.doors.map(d => d.wallId))
  const DOOR_H   = WALL_H * 0.9
  const DOOR_W   = TILE_SIZE * 0.7
  const PILLAR_W = (TILE_SIZE - DOOR_W) / 2      // 0.15
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
    const D = 0.1  // wall depth

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
    const geo = isNS ? new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.08) : new THREE.BoxGeometry(0.08, DOOR_H, DOOR_W)
    const mat = new THREE.MeshLambertMaterial({ color: door.isOpen ? 0x886644 : 0x553311 })
    const mesh = new THREE.Mesh(geo, mat)
    const xOff = wall.face === 'east' ? 1 : wall.face === 'west' ? 0 : 0.5
    const zOff = wall.face === 'south' ? 1 : wall.face === 'north' ? 0 : 0.5
    mesh.position.set(wall.x + xOff, wall.y * TILE_SIZE + DOOR_H / 2, wall.z + zOff)
    if (door.isOpen) mesh.rotation.y = Math.PI / 2
    mesh.userData = { type: 'door', id: door.id, floorY: wall.y }
    scene.add(mesh)
    buildMeshes.push(mesh)
  }

  // Ceilings
  for (const ceiling of map.ceilings) {
    if (destroyedIds.has(ceiling.id)) continue
    const geo = new THREE.BoxGeometry(TILE_SIZE, 0.1, TILE_SIZE)
    const state = props.destructibleStates.find(s => s.structureId === ceiling.id)
    const woundPct = ceiling.woundBoxes !== undefined && state ? state.currentWounds / ceiling.woundBoxes : 1
    const color = new THREE.Color().setHSL(woundPct * 0.25, 0.5, 0.45)
    const mat = new THREE.MeshLambertMaterial({ color })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(ceiling.x + 0.5, ceiling.y * TILE_SIZE + TILE_SIZE + 0.05, ceiling.z + 0.5)
    mesh.userData = { type: 'ceiling', id: ceiling.id, floorY: ceiling.y }
    scene.add(mesh)
    buildMeshes.push(mesh)
  }

  // Stairs
  for (const stair of map.stairs) {
    const group = new THREE.Group()
    for (let step = 0; step < 3; step++) {
      const stepH = (step + 1) / 3
      const geo = new THREE.BoxGeometry(1, stepH, 1 / 3)
      const mat = new THREE.MeshLambertMaterial({ color: 0x887766 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(0, stepH / 2, (step - 1) * (1 / 3))
      group.add(mesh)
    }
    group.position.set(stair.x + 0.5, stair.y * TILE_SIZE, stair.z + 0.5)
    if (stair.face === 'north') group.rotation.y = Math.PI
    else if (stair.face === 'east') group.rotation.y = -Math.PI / 2
    else if (stair.face === 'west') group.rotation.y = Math.PI / 2
    group.userData = { floorY: stair.y }
    scene.add(group)
    buildMeshes.push(group)
  }

  // Apply current clip and ghost state after full rebuild
  for (const obj of buildMeshes) {
    const fY = (obj as any).userData?.floorY
    if (fY !== undefined) obj.visible = fY <= clipY.value
  }
  if (props.showSpawnIndicators === false) {
    for (const m of spawnMeshes) m.visible = false
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
}

// ── Character footprints + HTML token overlays ───────────────────────────────

const characterOverlays = ref<Record<string, { x: number; y: number; w: number; h: number; spriteUrl: string | null; initial: string; stance: Stance; zIndex: number; woundFilter: 'yellow' | 'red' | null }>>({})
const reticuleParticipantIds = ref<string[]>([])

function buildSprites() {
  for (const [, group] of spriteGroups) scene.remove(group)
  spriteGroups.clear()

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
    const isHighlighted = p.id === props.activeParticipantId || p.id === props.secondaryActiveParticipantId
    const borderEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(footprint * 0.92, charHeight, footprint * 0.92))
    const borderMat = new THREE.LineBasicMaterial({ color: isHighlighted ? 0xff8800 : 0x334466, depthTest: false })
    const borderLines = new THREE.LineSegments(borderEdges, borderMat)
    borderLines.position.y = charHeight / 2
    group.add(borderLines)

    scene.add(group)
    spriteGroups.set(p.id, group)
  }
}

function updateCharacterOverlays() {
  const overlays: typeof characterOverlays.value = {}

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
      const occRay     = new THREE.Raycaster(camera.position, dir, 0, distToChar - 0.1)
      const hits       = occRay.intersectObjects([...wallMeshes.map(w => w.mesh), ...voxelMeshes], false)
      const windowWallIds = new Set((props.map?.windows ?? []).map(w => w.wallId))
      const isOccluded = hits.some(hit => {
        if (voxelMeshes.includes(hit.object as THREE.Mesh)) return true
        const entry = wallMeshes.find(w => w.mesh === hit.object)
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
}

// Keep NPC radial menu pinned as camera moves
function updateNpcRadial() {
  if (!npcRadialId.value) return
  const p = props.participants.find(x => x.id === npcRadialId.value)
  const pos = p && props.participantPositions[p.id]
  if (pos) {
    const v = new THREE.Vector3(pos.x + 0.5, pos.y * TILE_SIZE + TILE_H + 2, pos.z + 0.5)
    npcRadialScreen.value = worldToScreen2D(v) ?? npcRadialScreen.value
  }
}

// Keep player radial menu pinned as camera moves
function updatePlayerRadial() {
  if (!playerRadialId.value) return
  const p = props.participants.find(x => x.id === playerRadialId.value)
  const pos = p && props.participantPositions[p.id]
  if (pos) {
    const v = new THREE.Vector3(pos.x + 0.5, pos.y * TILE_SIZE + TILE_H + 2, pos.z + 0.5)
    playerRadialScreen.value = worldToScreen2D(v) ?? playerRadialScreen.value
  }
}

function playerRadialMove() {
  if (!playerRadialId.value) return
  const id = playerRadialId.value
  playerRadialId.value = null
  playerRadialScreen.value = null
  // Let EncounterMap call computeReachable (same path as NPC move) so reachableCells is populated
  emit('player-action', id, 'move')
}

function playerRadialAction(action: 'move' | 'attack' | 'direct' | 'special-order' | 'stance' | 'digivolve' | 'mode-change' | 'clash') {
  if (!playerRadialId.value) return
  emit('player-action', playerRadialId.value, action)
  playerRadialId.value = null
  playerRadialScreen.value = null
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
  if (e.key === 'Escape') {
    if (areaHighlightCells.value.length > 0 || props.selectedAttack) { clearAoeState(); emit('attack-cancelled'); return }
  }
  if (e.key === 'q' || e.key === 'Q') { snapAzimuth(-Math.PI / 4); return }
  if (e.key === 'e' || e.key === 'E') { snapAzimuth(+Math.PI / 4); return }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault()
  keysHeld.add(e.key)
}

function onKeyUp(e: KeyboardEvent) {
  keysHeld.delete(e.key)
}

function animate() {
  rafId = requestAnimationFrame(animate)
  applyKeyMovement()
  controls.update()

  // Health bar screen position stays fixed after click — no update needed

  // Update pending move screen position
  if (pendingMovePos.value) {
    const v = new THREE.Vector3(pendingMovePos.value.x + 0.5, pendingMovePos.value.y + 1.5, pendingMovePos.value.z + 0.5)
    movePendingScreen.value = worldToScreen2D(v) ?? movePendingScreen.value
  }

  // HTML token overlays + NPC/player radial pin
  updateCharacterOverlays()
  updateNpcRadial()
  updatePlayerRadial()

  // Sync movement highlight with reactive data
  updateMovementHighlights()
  updatePathHighlights()
  updateReticules()

  renderer.render(scene, camera)
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

  movementHighlightGroup.clear()
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
function updatePathHighlights() {
  const key = props.activePath.map(v => vec3Key(v)).join('|')
  if (key === lastPathKey) return
  lastPathKey = key

  pathHighlightGroup.clear()
  for (const v of props.activePath) {
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.6, 0.06, TILE_SIZE * 0.6)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.7 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(v.x + 0.5, v.y * TILE_SIZE + TILE_H + 0.03, v.z + 0.5)
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
    'aoe:' + (aoeActive ? lastAoeKey : ''),
    'area:' + isAreaTargeting.value,
    'selectable:' + (props.selectableParticipantIds?.join(',') ?? ''),
  ].join('|')
  if (key === lastAttackKey) return
  lastAttackKey = key

  reticuleGroup.clear()
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

  for (const p of props.participants) {
    const pos = props.participantPositions[p.id]
    if (!pos) continue
    if (p.id === effectiveAttackerId.value && !isMeleeSupportSingle) continue

    if (aoeCellSet) {
      // Show reticule if ANY of the target's footprint cells is in the AOE (big targets count if partially covered)
      if (!footprintIntersectsArea(pos, getParticipantFootprintDims(p.id), aoeCellSet)) continue
    } else if (isMelee) {
      // Melee: min Chebyshev distance across all footprint cell pairs (handles large digimon + diagonals)
      const attackerDims = getParticipantFootprintDims(effectiveAttackerId.value)
      const targetDims = getParticipantFootprintDims(p.id)
      let inRange = meleeInRange(attackerPos, pos, attackerDims, targetDims, maxDist)
      if (!inRange && props.chargeMode === 'before') {
        for (const k of props.reachableCells) {
          if (meleeInRange(parseVec3Key(k), pos, attackerDims, targetDims, maxDist)) { inRange = true; break }
        }
      }
      if (!inRange) continue
    } else {
      // Ranged: 3D Euclidean distance from anchor to anchor
      const dx = pos.x - attackerPos.x
      const dy = pos.y - attackerPos.y
      const dz = pos.z - attackerPos.z
      const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist3d > maxDist) continue
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
  if (passRangeGroup) passRangeGroup.clear()
  if (passLandingGroup) passLandingGroup.clear()
}

function clearAoeState() {
  areaHighlightCells.value = []
  lastAoeKey = ''
  lastAreaShapeData.value = null
  if (aoeGroup) aoeGroup.clear()
  lastAttackKey = ''  // force reticule rebuild next frame
  resetPassState()
}

function updateAoeHighlight(cells: Array<{ x: number; y: number; z: number }>, opts?: { blocked?: boolean }) {
  const key = cells.map(c => `${c.x},${c.y},${c.z}`).sort().join('|') + (opts?.blocked ? ':blocked' : '')
  if (key === lastAoeKey) return
  lastAoeKey = key
  // When LoS is blocked, don't register cells as valid targets so click confirmation is suppressed
  areaHighlightCells.value = opts?.blocked ? [] : cells
  aoeGroup.clear()

  const color   = opts?.blocked ? 0xff3300 : 0xffaa00
  const opacity = opts?.blocked ? 0.35     : 0.7
  for (const c of cells) {
    const geo = new THREE.BoxGeometry(TILE_SIZE, 0.05, TILE_SIZE)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(c.x + 0.5, c.y * TILE_SIZE + TILE_H + 0.03, c.z + 0.5)
    aoeGroup.add(mesh)
  }

  lastAttackKey = ''  // force reticule rebuild
}

// [Pass] step 2: highlight the band of cells reachable by extra movement (0..RAM) beyond the
// locked movement length, along the locked direction — a static preview of the max extension.
function renderPassRangeBand() {
  passRangeGroup.clear()
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
  const los = hasLineOfSight(attackerPos, center)
  blastLosBlocked.value = !los
  const dims = getParticipantFootprintDims(effectiveAttackerId.value)
  const cells = computeAreaCells(
    'blast', attack.range, attackerPos, { x: 0, y: 0, z: 0 },
    attack.bit, attack.ram ?? 0, attack.movement ?? 0,
    dims, center,
  )
  lastAreaShapeData.value = {
    shape: 'blast', rangeType: attack.range, attackerPos, dir: { x: 0, y: 0, z: 0 },
    bit: attack.bit, ram: attack.ram ?? 0, movement: attack.movement ?? 0,
    attackerDims: dims, blastCenter: center,
  }
  updateAoeHighlight(cells, { blocked: !los })
}

function hasLineOfSight(from: Vec3, to: Vec3): boolean {
  const fromW = new THREE.Vector3(from.x + 0.5, from.y * TILE_SIZE + TILE_H + 0.5, from.z + 0.5)
  const toW   = new THREE.Vector3(to.x   + 0.5, to.y   * TILE_SIZE + TILE_H + 0.5, to.z   + 0.5)
  const dir = toW.clone().sub(fromW)
  const dist = dir.length()
  if (dist < 0.1) return true
  dir.normalize()
  const los = new THREE.Raycaster(fromW, dir, 0.1, dist - 0.1)
  // Filter to solid Mesh objects only — LineSegments (tile edges) have large default precision
  // and cause false LoS blocks for any ray passing within ~1 world unit of an edge.
  const solidMeshes = [...buildMeshes, ...voxelMeshes].filter(obj => obj instanceof THREE.Mesh)
  const hits = los.intersectObjects(solidMeshes, true)
  return hits.length === 0
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

    const los = hasLineOfSight(attackerPos, blastCenter)
    blastLosBlocked.value = !los
    lastBlastCenter.value = blastCenter

    const cells = computeAreaCells(
      shape, attack.range, attackerPos, { x: 0, y: 0, z: 0 },
      attack.bit, attack.ram ?? 0, attack.movement ?? 0, dims, blastCenter,
    )
    lastAreaShapeData.value = {
      shape, rangeType: attack.range, attackerPos, dir: { x: 0, y: 0, z: 0 },
      bit: attack.bit, ram: attack.ram ?? 0, movement: attack.movement ?? 0,
      attackerDims: dims, blastCenter,
    }
    updateAoeHighlight(cells, { blocked: !los })
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
    updateAoeHighlight(cells)
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

  // [Pass]: two-step aim. Step 1 picks direction + movement length (clamped to Movement);
  // step 2 locks the direction and only extends along it by extra movement (clamped to RAM).
  if (shape === 'pass') {
    if (passStep.value !== 'extra') {
      if (passStep.value === null) passStep.value = 'movement'
      const movementLen = Math.min(dlen, attack.movement ?? 0)
      const cells = computeAreaCells(shape, attack.range, attackerPos, dir, attack.bit, 0, movementLen, dims)
      lastAreaShapeData.value = {
        shape, rangeType: attack.range, attackerPos, dir,
        bit: attack.bit, ram: 0, movement: movementLen,
        attackerDims: dims,
      }
      const caps = getAttackerCapabilities(effectiveAttackerId.value)
      const landingAnchor = computePassLanding(attackerPos, dir, movementLen, 0)
      passLandingValid = anyPassLandingValid(attackerPos, dir, movementLen, attack.ram ?? 0, dims, effectiveAttackerId.value!, caps)
      renderPassLandingMarker(landingAnchor, dims, passLandingValid)
      updateAoeHighlight(cells, { blocked: !los })
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
      const caps = getAttackerCapabilities(effectiveAttackerId.value)
      const landingAnchor = computePassLanding(attackerPos, nd, passMovementLength, extra)
      passLandingValid = isPassLandingValid(landingAnchor, dims, effectiveAttackerId.value!, caps)
      renderPassLandingMarker(landingAnchor, dims, passLandingValid)
      updateAoeHighlight(cells, { blocked: !los })
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
  updateAoeHighlight(cells, { blocked: !los })
}

// ── Mouse interaction ──────────────────────────────────────────────────────
const mouse = new THREE.Vector2()
const raycaster = new THREE.Raycaster()

function getIntersection(event: MouseEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  return raycaster.intersectObjects(scene.children, true)
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
  if (tool === 'wall' || tool === 'stairs' || tool === 'door') {
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
  const geo = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE)
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(cell.x + 0.5, cell.y * TILE_SIZE + 0.5, cell.z + 0.5)
  return mesh
}

function updateHoverGhost(event: MouseEvent) {
  hoverGhostGroup.clear()
  if (props.activeTool === 'select' || !props.isDm) return
  const tool = props.activeTool

  if (tool === 'wall' || tool === 'stairs' || tool === 'window' || tool === 'door') {
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
    const color = tool === 'voxel' ? 0x88ccff : 0x00aaff
    const makeGhost = tool === 'voxel' ? makeVoxelGhostMesh : makeTileGhostMesh
    if (dragStartHit?.type === 'cell' && (tool === 'add-ground' || tool === 'add-space' || tool === 'ceiling' || tool === 'paint-element' || tool === 'voxel')) {
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

  // Movement mode — ghost + distance label + path preview
  // Use plane intersection at npcMoveY so scroll wheel controls the target floor,
  // preventing upper-floor geometry from blocking clicks on lower-floor tiles.
  if (movingParticipantId.value) {
    hoverGhostGroup.clear()
    hoveredMoveScreen.value = null
    setMouseFromEvent(event)
    const mvPlaneY = npcMoveY.value * TILE_SIZE + TILE_H
    const mvPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -mvPlaneY)
    const mvTarget = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(mvPlane, mvTarget)) {
      const cell: Vec3 = { x: Math.floor(mvTarget.x), y: npcMoveY.value, z: Math.floor(mvTarget.z) }
      if (props.reachableCells.has(vec3Key(cell))) {
        const p = props.participants.find(x => x.id === movingParticipantId.value)
        const size: DigimonSize = p?.type === 'digimon' ? (props.digimonMap[p.entityId]?.size ?? 'medium') : 'medium'
        const gig = p?.type === 'digimon' ? props.digimonMap[p.entityId]?.giganticDimensions : null
        const { tileCount } = getSizeParams(size, gig)
        const footprint = tileCount * TILE_SIZE
        const co = (tileCount - 1) * 0.5
        const ghostGeo = new THREE.CircleGeometry(footprint * 0.42, 24)
        const ghostMat = new THREE.MeshBasicMaterial({ color: 0x2255ff, transparent: true, opacity: 0.55, depthWrite: false })
        const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat)
        ghostMesh.rotation.x = -Math.PI / 2
        ghostMesh.position.set(cell.x + 0.5 + co, cell.y * TILE_SIZE + TILE_H + 0.01, cell.z + 0.5 + co)
        hoverGhostGroup.add(ghostMesh)
        const labelV = new THREE.Vector3(cell.x + 0.5, cell.y * TILE_SIZE + TILE_H + 0.6, cell.z + 0.5)
        hoveredMoveScreen.value = worldToScreen2D(labelV) ?? null
        emit('cell-hovered', cell)
      } else {
        emit('cell-hovered', null)
      }
    } else {
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
    if (movingParticipantId.value) {
      movingParticipantId.value = null
      hoverGhostGroup.clear()
      hoveredMoveScreen.value = null
      emit('cell-hovered', null)
      return
    }
    if (areaHighlightCells.value.length > 0 || props.selectedAttack) {
      clearAoeState()
      emit('attack-cancelled')
      return
    }
    rightDragActive = true
    rightDragLastX = event.clientX
    rightDragAccum = 0
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

function onCanvasClick(event: MouseEvent) {
  if (props.isDm && props.activeTool !== 'select') return
  const hits = getIntersection(event)  // also updates raycaster for plane intersection below

  // Movement mode click — use plane intersection at npcMoveY (consistent with hover).
  // Must run before the hits.length early-return so clicking empty space still works.
  if (movingParticipantId.value) {
    const mvPlaneY = npcMoveY.value * TILE_SIZE + TILE_H
    const mvPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -mvPlaneY)
    const mvTarget = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(mvPlane, mvTarget)) {
      const cell: Vec3 = { x: Math.floor(mvTarget.x), y: npcMoveY.value, z: Math.floor(mvTarget.z) }
      if (props.reachableCells.has(vec3Key(cell))) {
        const pid = movingParticipantId.value
        const isChargeAfter = pid === props.chargeMoveParticipantId
        if (!isChargeAfter || !footprintOccupied(cell, getParticipantFootprintDims(pid), pid)) {
          movingParticipantId.value = null
          hoverGhostGroup.clear()
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

  const placementSurfaceHit = hits.find(h => h.object.userData.type === 'ground' || h.object.userData.type === 'space' || h.object.userData.type === 'voxel')

  // Placement: a character is selected in the panel — clicking a tile/voxel places them
  if (props.placingParticipantId && placementSurfaceHit) {
    const hitType = placementSurfaceHit.object.userData.type
    const tile = placementSurfaceHit.object.userData.tile as { y: number; isSpawnPoint?: boolean } | undefined
    const voxel = placementSurfaceHit.object.userData.voxel as { x: number; y: number; z: number; isSpawnPoint?: boolean } | undefined
    if (!props.isDm) {
      if (hitType === 'voxel') {
        if (!voxel?.isSpawnPoint) return
      } else if (!tile?.isSpawnPoint) return
    }
    const cell: Vec3 = hitType === 'voxel' && voxel
      ? { x: voxel.x, y: voxel.y + 1, z: voxel.z }
      : { x: Math.floor(placementSurfaceHit.point.x), y: tile?.y ?? 0, z: Math.floor(placementSurfaceHit.point.z) }
    // Reject if any other placed participant occupies the same tile footprint
    const placing = props.participants.find(pp => pp.id === props.placingParticipantId)
    const placingSize: DigimonSize = placing?.type === 'digimon' ? (props.digimonMap[placing.entityId]?.size ?? 'medium') : 'medium'
    const placingGig = placing?.type === 'digimon' ? props.digimonMap[placing.entityId]?.giganticDimensions : null
    const { tileCount: pCount } = getSizeParams(placingSize, placingGig)
    for (let dx = 0; dx < pCount; dx++) {
      for (let dz = 0; dz < pCount; dz++) {
        if (props.map && mapVoxelBlocksMovement(props.map, { x: cell.x + dx, y: cell.y, z: cell.z + dz })) return
      }
    }
    const occupied = props.participants.some(p => {
      if (p.id === props.placingParticipantId) return false
      const oPos = props.participantPositions[p.id]
      if (!oPos || oPos.y !== cell.y) return false
      const oSize: DigimonSize = p.type === 'digimon' ? (props.digimonMap[p.entityId]?.size ?? 'medium') : 'medium'
      const oGig = p.type === 'digimon' ? props.digimonMap[p.entityId]?.giganticDimensions : null
      const { tileCount: oCount } = getSizeParams(oSize, oGig)
      // AABB overlap on XZ plane
      return cell.x < oPos.x + oCount && cell.x + pCount > oPos.x &&
             cell.z < oPos.z + oCount && cell.z + pCount > oPos.z
    })
    if (occupied) return
    emit('unit-placed', props.placingParticipantId, cell)
    return
  }

  const spriteHit = hits.find(h => h.object.userData.type === 'sprite')

  // Single-target attack or intercede target selection: a direct hit on a participant's
  // character token (sprite hitbox) takes priority over the ground/shadow-tile fallback below
  if (spriteHit && ((props.selectedAttack && !getAreaShape(props.selectedAttack.tags)) || props.selectableParticipantIds?.length)) {
    if (tryReticuleTarget(spriteHit.object.userData.participantId)) return
  }

  // Single-target attack or intercede target selection: clicking a ground/voxel tile within a valid target's footprint
  // Allows targeting Large/Huge/Gigantic digimon by clicking any footprint tile, not just the anchor
  if (((props.selectedAttack && !getAreaShape(props.selectedAttack.tags)) || (props.selectableParticipantIds?.length && !props.selectedAttack)) && placementSurfaceHit) {
    const hitType = placementSurfaceHit.object.userData.type
    const tile = placementSurfaceHit.object.userData.tile as { y: number } | undefined
    const voxel = placementSurfaceHit.object.userData.voxel as { x: number; y: number; z: number } | undefined
    const cell: Vec3 = hitType === 'voxel' && voxel
      ? { x: voxel.x, y: voxel.y + 1, z: voxel.z }
      : { x: Math.floor(placementSurfaceHit.point.x), y: tile?.y ?? 0, z: Math.floor(placementSurfaceHit.point.z) }
    const cellSet = new Set([`${cell.x},${cell.y},${cell.z}`])
    const targetParticipant = props.participants.find(p => {
      if (p.id === effectiveAttackerId.value) return false
      const pos = props.participantPositions[p.id]
      if (!pos) return false
      if (!reticuleParticipantIds.value.includes(p.id)) return false
      return footprintIntersectsArea(pos, getParticipantFootprintDims(p.id), cellSet)
    })
    if (targetParticipant) {
      if (tryReticuleTarget(targetParticipant.id)) return
    }
  }

  // Check sprite click
  if (spriteHit) {
    const participantId: string = spriteHit.object.userData.participantId
    const p = props.participants.find(p => p.id === participantId)
    if (!p) return

    // GM clicking an NPC — only show radial action menu when it's that NPC's active turn
    if (props.isDm && (p as any).isEnemy) {
      if (p.id === props.activeParticipantId) {
        npcRadialId.value = npcRadialId.value === p.id ? null : p.id
        return
      }
      // Non-active-turn enemy: fall through to show health bar overlay
    }

    const info = p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId]
    if (info && !props.myParticipantIds.includes(participantId)) {
      const screen = worldToScreen2D(spriteHit.point)
      const anyP = p as any
      const currentWounds = anyP.currentWounds ?? info.currentWounds
      const maxWounds = anyP.maxWounds ?? info.woundBoxes
      clickedHealthBar.value = {
        name: participantDisplayNames.value[p.id] ?? info.name,
        pct: maxWounds > 0 ? Math.max(0, 1 - currentWounds / maxWounds) : 1,
        current: currentWounds,
        max: maxWounds,
        screenX: screen?.x ?? event.clientX,
        screenY: (screen?.y ?? event.clientY) - 80,
      }
    }

    // Show radial for any owned participant when it's the player's turn
    if (props.myParticipantIds.includes(participantId) &&
        props.activeParticipantId !== null &&
        props.myParticipantIds.includes(props.activeParticipantId)) {
      if (playerRadialId.value === participantId) {
        playerRadialId.value = null
        playerRadialScreen.value = null
      } else {
        playerRadialId.value = participantId
        const pos = props.participantPositions[participantId]
        if (pos) {
          const v = new THREE.Vector3(pos.x + 0.5, pos.y * TILE_SIZE + TILE_H + 2, pos.z + 0.5)
          playerRadialScreen.value = worldToScreen2D(v) ?? null
        }
      }
    }
    return
  }

  // Click empty space — close health bar, NPC radial, player radial, exit move mode
  clickedHealthBar.value = null
  npcRadialId.value = null
  npcRadialScreen.value = null
  playerRadialId.value = null
  playerRadialScreen.value = null
  if (!pendingMovePos.value) movingParticipantId.value = null
}

function onWheel(event: WheelEvent) {
  if (movingParticipantId.value) {
    npcMoveY.value = npcMoveY.value + (event.deltaY > 0 ? -1 : 1)
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

function npcAction(action: 'move' | 'stance' | 'attack' | 'clash') {
  const id = npcRadialId.value
  if (!id) return
  npcRadialId.value = null
  npcRadialScreen.value = null
  emit('npc-action', id, action)
}

// ── Resize ─────────────────────────────────────────────────────────────────
function onResize() {
  const container = containerRef.value
  if (!container) return
  camera.aspect = container.clientWidth / container.clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(container.clientWidth, container.clientHeight)
}

// ── Watchers — rebuild scene on prop changes ───────────────────────────────
watch(() => props.map, () => {
  if (!scene) return
  buildMeshes.forEach(m => scene.remove(m))
  buildMeshes = []; tileMeshes = []; wallMeshes = []; voxelMeshes = []; spawnMeshes = []
  blendTextureCache = new Map()
  buildMap()
}, { deep: true })

watch(
  () => JSON.stringify(props.participantPositions),
  () => { if (scene) buildSprites() }
)

watch(() => props.digimonMap, () => { if (scene) buildSprites() }, { deep: true })
watch(() => props.tamerMap, () => { if (scene) buildSprites() }, { deep: true })

// Rebuild sprites when a participant's underlying entity changes (e.g.
// digivolve swaps entityId to a different Digimon record's sprite/stage),
// or when participants are added/removed.
watch(
  () => props.participants.map(p => `${p.id}:${p.entityId}`).join(','),
  () => { if (scene) buildSprites() }
)

watch(() => [props.activeParticipantId, props.secondaryActiveParticipantId], () => {
  if (scene) buildSprites()
})

watch(() => props.activeTool, (tool) => {
  if (controls) controls.enabled = (tool === 'select')
}, { immediate: true })

// Enter NPC movement mode when EncounterMap signals reachable cells are ready
watch(() => props.npcMoveParticipantId, id => {
  if (id) {
    movingParticipantId.value = id
    npcMoveY.value = props.participantPositions[id]?.y ?? 0
  }
})

// Enter movement mode for the post-charge "Move After Attack" relocation step
watch(() => props.chargeMoveParticipantId, id => {
  if (id) {
    movingParticipantId.value = id
    npcMoveY.value = props.participantPositions[id]?.y ?? 0
  }
})

// Use actual A* path length (steps = meters) for the distance label
watch(() => props.activePath, (path) => {
  hoveredMoveDistance.value = path.length > 1 ? path.length - 1 : 0
})

// Track move start position; toggle zoom; clear ghost when movement mode ends
watch(movingParticipantId, id => {
  if (id) {
    moveStartPos.value = props.participantPositions[id] ?? null
    if (controls) controls.enableZoom = false
  } else {
    moveStartPos.value = null
    hoveredMoveScreen.value = null
    hoveredMoveDistance.value = 0
    if (hoverGhostGroup) hoverGhostGroup.clear()
    if (controls) controls.enableZoom = true
    emit('cell-hovered', null)
    emit('movement-cancelled')
  }
})

watch(() => props.selectedAttack, (attack, prevAttack) => {
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
    updateAoeHighlight(cells)
  }
}, { immediate: false })

watch(clipY, (y) => {
  for (const obj of buildMeshes) {
    const fY = (obj as any).userData?.floorY
    if (fY !== undefined) obj.visible = fY <= y
  }
  if (props.showSpawnIndicators === false) {
    for (const m of spawnMeshes) m.visible = false
  }
})

watch(() => props.showSpawnIndicators, (show) => {
  for (const m of spawnMeshes) m.visible = show !== false
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
.target-reticule {
  position: absolute;
  width: 50%;
  height: 50%;
  top: 25%;
  left: 25%;
  border: 2px solid #ff2222;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 0 8px rgba(255, 34, 34, 0.7);
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
.npc-radial-menu { position: absolute; pointer-events: auto; z-index: 35; }
.npc-radial-btn {
  position: absolute;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  background: #1a2040;
  color: #fff;
  border: 1px solid #4466cc;
  transform: translateX(-50%);
}
.npc-radial-btn.move   { top: -38px; left: -55px; }
.npc-radial-btn.stance { top: -68px; left: 0; }
.npc-radial-btn.attack { top: -38px; left: 55px; }
.npc-radial-btn.clash  { top: 30px; left: 0; }
.npc-radial-btn:hover:not(:disabled)  { background: #2a3480; }
.npc-radial-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.npc-radial-btn.player { background: #0e2e1a; border-color: #44cc88; }
.npc-radial-btn.player.move   { top: -70px; left: 0; }
.npc-radial-btn.player.attack { top: -38px; left: 45px; }
.npc-radial-btn.player.digivolve { top: -38px; left: -45px; }
.npc-radial-btn.player.direct         { top: -24px; left: -66px; }
.npc-radial-btn.player.orders         { top: -24px; left: 66px; }
.npc-radial-btn.player.tamer-stance   { top: -75px; left: -107px; }
.npc-radial-btn.player.digimon-stance { top: 0; left: 0; }
.npc-radial-btn.player.mode-change    { top: -75px; left: 90px; }
.npc-radial-btn.player.clash          { top: 30px; left: 0; }
.npc-radial-btn.player:hover:not(:disabled)  { background: #1a4a30; }
.npc-radial-btn.player:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
