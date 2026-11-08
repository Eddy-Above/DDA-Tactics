<template>
  <!-- Minimised icon. While placement is active it carries the count of characters still to
       place and lights up when one is armed, so the HUD stays discoverable when collapsed. -->
  <button
    v-if="minimized"
    class="hud-icon"
    :class="{ armed: !!armedEntry }"
    :title="minimizedTitle"
    @click="minimized = false"
  >
    🖥
    <span v-if="unplacedCount > 0" class="hud-icon-badge">{{ unplacedCount }}</span>
  </button>

  <!-- Expanded HUD -->
  <div v-else class="player-hud" :class="{ placing: placementActive }">
    <div class="hud-header">
      <span class="hud-title">{{ isDm ? 'All Participants' : 'My Characters' }}</span>
      <button class="hud-min-btn" title="Minimise" @click="minimized = true">−</button>
    </div>

    <div class="hud-body">
      <!-- Player view: own tamer + digimon -->
      <template v-if="!isDm">
        <div v-for="entry in myEntries" :key="entry.id" class="hud-card" v-bind="placementBindings(entry.id)">
          <div class="hud-sprite">
            <img v-if="entry.spriteUrl" :src="entry.spriteUrl" :alt="entry.name" class="sprite-img" />
            <div v-else class="sprite-placeholder">{{ entry.name[0] }}</div>
          </div>
          <div class="hud-info">
            <div class="hud-name">{{ entry.name }}</div>
            <div class="hud-bar-track">
              <div
                class="hud-bar-fill"
                :class="woundClass(entry.currentWounds, entry.woundBoxes)"
                :style="{ width: woundPct(entry.currentWounds, entry.woundBoxes) + '%' }"
              />
            </div>
            <div class="hud-wound-label">{{ entry.woundBoxes - entry.currentWounds }} / {{ entry.woundBoxes }}</div>
          </div>
          <span
            v-if="isPlaceable(entry.id)"
            class="place-badge"
            :class="placedSet.has(entry.id) ? 'placed' : 'unplaced'"
            :title="placedSet.has(entry.id) ? 'On the map' : 'Not placed yet'"
          >{{ placedSet.has(entry.id) ? '✓' : '📍' }}</span>
          <div class="hud-actions" :title="`${entry.actionsRemaining.simple} action(s) remaining`">
            <span
              v-for="i in Math.max(2, entry.actionsRemaining.simple)"
              :key="i"
              class="action-dot"
              :class="i <= entry.actionsRemaining.simple ? 'unspent' : 'spent'"
            />
          </div>
        </div>
      </template>

      <!-- GM view: all participants compact -->
      <template v-else>
        <div v-for="entry in allEntries" :key="entry.id" class="hud-card compact" v-bind="placementBindings(entry.id)">
          <div class="hud-sprite small">
            <img v-if="entry.spriteUrl" :src="entry.spriteUrl" :alt="entry.name" class="sprite-img" />
            <div v-else class="sprite-placeholder small">{{ entry.name[0] }}</div>
          </div>
          <div class="hud-info">
            <div class="hud-name small">{{ entry.name }}</div>
            <div class="hud-bar-track thin">
              <div
                class="hud-bar-fill"
                :class="woundClass(entry.currentWounds, entry.woundBoxes)"
                :style="{ width: woundPct(entry.currentWounds, entry.woundBoxes) + '%' }"
              />
            </div>
            <div class="hud-wound-label" :aria-label="`${entry.actionsRemaining.simple} Simple Actions remaining`">{{ entry.actionsRemaining.simple }} Simple Action{{ entry.actionsRemaining.simple === 1 ? '' : 's' }} left</div>
          </div>
          <span
            v-if="isPlaceable(entry.id)"
            class="place-badge"
            :class="placedSet.has(entry.id) ? 'placed' : 'unplaced'"
            :title="placedSet.has(entry.id) ? 'On the map' : 'Not placed yet'"
          >{{ placedSet.has(entry.id) ? '✓' : '📍' }}</span>
        </div>
      </template>
    </div>

    <!-- Placement instructions: this HUD is the placement control, so they live here. -->
    <div v-if="placementActive" class="hud-hint">{{ placementHint }}</div>
  </div>
</template>

<script setup lang="ts">
import type { CombatParticipant } from '~/types'
import { buildParticipantDisplayNames } from '~/utils/participantDisplayNames'

const props = defineProps<{
  participants: CombatParticipant[]
  tamerMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number }>
  digimonMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number; isEnemy?: boolean }>
  isDm: boolean
  myTamerId: string | null
  myParticipantIds?: string[]
  // Placement: when active, cards in `placeableIds` become the placement control — click to arm
  // (then click a map tile) or drag a card onto the map. EncounterMap owns the state and the rules.
  placementActive?: boolean
  setupPlacement?: boolean      // setup/initiative: every card is offered; in combat only unplaced ones
  placeableIds?: string[]
  placedIds?: string[]          // participants that currently have a map position
  armedId?: string | null       // the character waiting for a tile click
}>()

const emit = defineEmits<{
  (e: 'select-placement', id: string): void
  (e: 'placement-drag-start', id: string): void
  (e: 'placement-drag-end'): void
}>()

const minimized = ref(false)

// A placement round (setup, or a unit deployed mid-combat) always opens the HUD: it is the only
// place to start placing from, so it must not stay tucked away behind the 🖥 icon.
watch(() => props.placementActive, (active) => { if (active) minimized.value = false })

interface HudEntry { id: string; name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number; actionsRemaining: { simple: number } }

const participantDisplayNames = computed(() => buildParticipantDisplayNames(
  props.participants,
  p => (p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId])?.name,
  p => ((p as CombatParticipant & { isEnemy?: boolean }).isEnemy ?? props.digimonMap[p.entityId]?.isEnemy) === true,
))

function makeEntry(p: CombatParticipant): HudEntry | null {
  const info = p.type === 'tamer' ? props.tamerMap[p.entityId] : props.digimonMap[p.entityId]
  if (!info) return null
  const anyP = p as any
  return {
    id: p.id,
    name: participantDisplayNames.value[p.id] ?? info.name,
    spriteUrl: info.spriteUrl,
    currentWounds: anyP.currentWounds ?? info.currentWounds,
    woundBoxes: anyP.maxWounds ?? info.woundBoxes,
    actionsRemaining: anyP.actionsRemaining ?? { simple: 2 },
  }
}

const myEntries = computed<HudEntry[]>(() => {
  if (props.myParticipantIds?.length) {
    return props.participants
      .filter(p => props.myParticipantIds!.includes(p.id))
      .map(makeEntry)
      .filter(Boolean) as HudEntry[]
  }
  if (!props.myTamerId) return []
  return props.participants
    .filter(p => p.type === 'tamer' && p.entityId === props.myTamerId)
    .map(makeEntry)
    .filter(Boolean) as HudEntry[]
})

const allEntries = computed<HudEntry[]>(() =>
  props.participants.map(makeEntry).filter(Boolean) as HudEntry[]
)

// ── Placement ───────────────────────────────────────────────────────────────
const visibleEntries = computed(() => (props.isDm ? allEntries.value : myEntries.value))
const placeableSet = computed(() => new Set(props.placementActive ? (props.placeableIds ?? []) : []))
const placedSet = computed(() => new Set(props.placedIds ?? []))

function isPlaceable(id: string): boolean {
  return placeableSet.value.has(id)
}

const armedEntry = computed(() =>
  props.placementActive && props.armedId
    ? visibleEntries.value.find(e => e.id === props.armedId) ?? null
    : null
)

const unplacedCount = computed(() =>
  visibleEntries.value.filter(e => placeableSet.value.has(e.id) && !placedSet.value.has(e.id)).length
)

const minimizedTitle = computed(() => {
  if (armedEntry.value) return `Placing ${armedEntry.value.name}`
  if (unplacedCount.value > 0) return `Show HUD — ${unplacedCount.value} to place`
  return 'Show HUD'
})

const placementHint = computed(() => {
  if (armedEntry.value) return `Click a tile to place ${armedEntry.value.name}`
  return props.setupPlacement
    ? 'Select a character, then click a tile, or drag it onto the map'
    : 'Select or drag a deployed character onto the map'
})

function onPlacementDragStart(e: DragEvent, id: string) {
  const dt = e.dataTransfer
  if (dt) {
    dt.setData('text/plain', id)   // Firefox won't start a drag without data
    dt.effectAllowed = 'move'
    const img = (e.currentTarget as HTMLElement | null)?.querySelector?.('img.sprite-img') as HTMLImageElement | null
    if (img && img.complete && img.naturalWidth > 0) dt.setDragImage(img, img.width / 2, img.height / 2)
  }
  emit('placement-drag-start', id)
}

// Bound onto a card with v-bind: only a placeable card is a button, a drag source and keyboard
// operable. Everything else stays inert so a placed unit mid-combat doesn't pretend to be pickable.
function placementBindings(id: string): Record<string, unknown> {
  if (!isPlaceable(id)) return {}
  return {
    class: { placeable: true, armed: props.armedId === id },
    role: 'button',
    tabindex: 0,
    draggable: true,
    onClick: () => emit('select-placement', id),
    onKeydown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      emit('select-placement', id)
    },
    onDragstart: (e: DragEvent) => onPlacementDragStart(e, id),
    onDragend: () => emit('placement-drag-end'),
  }
}

function woundPct(current: number, max: number) {
  if (max <= 0) return 100
  return Math.max(0, Math.round((1 - current / max) * 100))
}

function woundClass(current: number, max: number) {
  if (current === 0) return 'green'
  if (current < max / 2) return 'yellow'
  if (current < max) return 'orange'
  return 'red'
}
</script>

<style scoped>
.hud-icon {
  background: rgba(10, 12, 25, 0.88);
  border: 1px solid #334;
  border-radius: 50%;
  width: 36px; height: 36px;
  font-size: 18px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.hud-icon.armed { border-color: #f97316; }
.hud-icon-badge {
  position: absolute;
  top: -5px; right: -5px;
  min-width: 16px; height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #f97316;
  color: #1a1e30;
  font-size: 9px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.player-hud {
  background: rgba(10, 12, 25, 0.88);
  border: 1px solid #334;
  border-radius: 8px;
  width: 220px;
  max-height: 380px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* A full GM roster during setup needs more room than the status-only HUD. */
.player-hud.placing { max-height: min(60vh, 460px); }
.hud-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  border-bottom: 1px solid #334;
}
.hud-title { font-size: 12px; font-weight: 600; color: #aabbcc; }
.hud-min-btn { background: none; border: none; color: #778; cursor: pointer; font-size: 16px; line-height: 1; }
.hud-body { overflow-y: auto; flex: 1; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.hud-card {
  display: flex; align-items: center; gap: 8px; padding: 5px 4px;
  /* Reserved up front so arming a card doesn't shift the list by a pixel. */
  border: 1px solid transparent; border-radius: 6px;
}
.hud-card.compact { padding: 3px 2px; }
.hud-card.placeable { cursor: grab; transition: background 0.12s, border-color 0.12s; }
.hud-card.placeable:hover { background: #1a1e30; border-color: #334; }
.hud-card.placeable:active { cursor: grabbing; }
.hud-card.placeable:focus-visible { outline: 1px solid #f97316; outline-offset: 1px; }
.hud-card.armed, .hud-card.armed:hover { border-color: #f97316; background: #3a1a05; }
.place-badge { font-size: 10px; flex-shrink: 0; align-self: center; line-height: 1; }
.place-badge.placed { color: #22cc55; }
.hud-hint {
  font-size: 10px; color: #667; text-align: center;
  padding: 6px 8px; border-top: 1px solid #334;
}
.hud-sprite { width: 40px; height: 40px; border-radius: 4px; overflow: hidden; flex-shrink: 0; }
.hud-sprite.small { width: 28px; height: 28px; }
.sprite-img { width: 100%; height: 100%; object-fit: cover; }
.sprite-placeholder {
  width: 100%; height: 100%;
  background: #2233aa;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: #fff; font-weight: 700;
}
.sprite-placeholder.small { font-size: 12px; }
.hud-info { flex: 1; min-width: 0; }
.hud-name { font-size: 12px; color: #ccdde0; font-weight: 600; truncate: true; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud-name.small { font-size: 11px; }
.hud-bar-track { width: 100%; height: 7px; background: #223; border-radius: 4px; overflow: hidden; margin-top: 3px; }
.hud-bar-track.thin { height: 5px; }
.hud-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
.hud-bar-fill.green  { background: #22cc55; }
.hud-bar-fill.yellow { background: #eab308; }
.hud-bar-fill.orange { background: #f97316; }
.hud-bar-fill.red    { background: #dd2222; }
.hud-wound-label { font-size: 10px; color: #667; margin-top: 2px; }
.hud-actions { display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; align-self: center; }
.action-dot { width: 8px; height: 8px; border-radius: 50%; }
.action-dot.unspent { background: #eab308; }
.action-dot.spent { background: #445; }
</style>
