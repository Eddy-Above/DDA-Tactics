<template>
  <!-- Minimised icon -->
  <button v-if="minimized" class="hud-icon" title="Show HUD" @click="minimized = false">
    🖥
  </button>

  <!-- Expanded HUD -->
  <div v-else class="player-hud">
    <div class="hud-header">
      <span class="hud-title">{{ isDm ? 'All Participants' : 'My Characters' }}</span>
      <button class="hud-min-btn" title="Minimise" @click="minimized = true">−</button>
    </div>

    <div class="hud-body">
      <!-- Player view: own tamer + digimon -->
      <template v-if="!isDm">
        <div v-for="entry in myEntries" :key="entry.id" class="hud-card">
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
            <div class="hud-wound-label">{{ entry.currentWounds }} / {{ entry.woundBoxes }}</div>
          </div>
        </div>
      </template>

      <!-- GM view: all participants compact -->
      <template v-else>
        <div v-for="entry in allEntries" :key="entry.id" class="hud-card compact">
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
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CombatParticipant } from '~/types'

const props = defineProps<{
  participants: CombatParticipant[]
  tamerMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number }>
  digimonMap: Record<string, { name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number }>
  isDm: boolean
  myTamerId: string | null
  myParticipantIds?: string[]
}>()

const minimized = ref(false)

interface HudEntry { id: string; name: string; spriteUrl?: string | null; currentWounds: number; woundBoxes: number }

// Compute display names matching the encounter page's getDisplayName logic:
// group by name, sort each group by participant ID, number if duplicates exist
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
.hud-card { display: flex; align-items: center; gap: 8px; padding: 5px 4px; }
.hud-card.compact { padding: 3px 2px; }
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
</style>
