<template>
  <div v-if="campaignId" class="roll-log-panel">
    <button
      class="tab-toggle"
      :title="collapsed ? 'Show roll history' : 'Hide roll history'"
      @click="toggle"
    >
      <span class="tab-icon">🎲</span>
      <span class="tab-label">Rolls</span>
      <span v-if="collapsed && unseenCount > 0" class="unseen-badge">{{ unseenCount > 99 ? '99+' : unseenCount }}</span>
      <span class="tab-arrow">{{ collapsed ? '▶' : '◀' }}</span>
    </button>

    <div v-if="!collapsed" class="panel-drawer">
      <div class="drawer-header">
        <span class="drawer-title">Roll History</span>
        <select v-model="filterCharacter" class="char-filter">
          <option value="all">All characters</option>
          <option v-for="name in characterNames" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>

      <div class="drawer-body">
        <div v-if="filteredEntries.length === 0" class="drawer-empty">No rolls yet.</div>

        <template v-for="entry in filteredEntries" :key="entry.id">
          <div v-if="entry.kind === 'new-day'" class="new-day-row">
            🌅 New Day
          </div>
          <div v-else class="roll-row">
            <div class="roll-char">
              <div class="roll-avatar">
                <img v-if="entry.spriteUrl" :src="entry.spriteUrl" :alt="entry.characterName ?? ''">
                <div v-else class="avatar-placeholder">{{ (entry.characterName?.[0] ?? '?').toUpperCase() }}</div>
              </div>
              <div class="roll-char-name">{{ entry.characterName }}</div>
            </div>
            <div class="roll-info">
              <div class="roll-name-row">
                <span class="roll-name">{{ entry.rollName }}</span>
                <span class="roll-time">{{ relativeTime(entry.createdAt) }}</span>
              </div>
              <div class="roll-result" :class="{ passed: entry.passed === true, failed: entry.passed === false }">
                {{ entry.rolls.join(' + ') }} {{ entry.modifier >= 0 ? '+' : '' }}{{ entry.modifier }} = <strong>{{ entry.total }}</strong>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RollLogEntry, WebSocketMapMessage } from '~/types'
import { useMapWebSocket } from '~/composables/useMapWebSocket'

const route = useRoute()
const campaignId = computed(() => (route.params.campaignId as string) || null)

const collapsed = ref(true)
const entries = ref<RollLogEntry[]>([])
const unseenCount = ref(0)
const filterCharacter = ref<string>('all')
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

async function fetchEntries() {
  if (!campaignId.value) return
  try {
    const data = await $fetch<{ entries: RollLogEntry[] }>(`/api/campaigns/${campaignId.value}/rolls`)
    entries.value = data.entries
  } catch { /* keep whatever's already loaded */ }
}

const { onMessage } = useMapWebSocket(campaignId, 'campaigns')

onMessage((msg: WebSocketMapMessage) => {
  if (msg.type !== 'roll-logged' || msg.campaignId !== campaignId.value) return
  entries.value.unshift(msg.entry)
  if (entries.value.length > 50) entries.value.length = 50
  if (collapsed.value) unseenCount.value++
})

function toggle() {
  collapsed.value = !collapsed.value
  if (collapsed.value) {
    stopClock()
  } else {
    unseenCount.value = 0
    startClock()
  }
}

function startClock() {
  now.value = Date.now()
  if (clockTimer) return
  clockTimer = setInterval(() => { now.value = Date.now() }, 30_000)
}

function stopClock() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null }
}

const characterNames = computed(() => {
  const names = new Set<string>()
  for (const e of entries.value) {
    if (e.kind === 'roll' && e.characterName) names.add(e.characterName)
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b))
})

const filteredEntries = computed(() =>
  entries.value.filter((e) => e.kind === 'new-day' || filterCharacter.value === 'all' || e.characterName === filterCharacter.value)
)

function relativeTime(createdAt: string | Date): string {
  const ts = new Date(createdAt).getTime()
  const diffSec = Math.max(0, Math.floor((now.value - ts) / 1000))
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

watch(campaignId, (id, prev) => {
  if (id === prev) return
  entries.value = []
  filterCharacter.value = 'all'
  if (id) fetchEntries()
}, { immediate: true })

onUnmounted(stopClock)
</script>

<style scoped>
.roll-log-panel {
  position: fixed;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  z-index: 60;
  display: flex;
  align-items: flex-start;
}

.tab-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: rgba(10, 12, 25, 0.92);
  border: 1px solid #334;
  border-left: none;
  border-radius: 0 8px 8px 0;
  padding: 10px 6px;
  cursor: pointer;
  color: #ccdde0;
  position: relative;
}
.tab-toggle:hover { background: rgba(30, 40, 70, 0.92); }
.tab-icon { font-size: 18px; }
.tab-label { font-size: 10px; writing-mode: vertical-rl; text-orientation: mixed; letter-spacing: 1px; }
.tab-arrow { font-size: 10px; color: #778; }
.unseen-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  background: #dd2222;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}

.panel-drawer {
  background: rgba(10, 12, 25, 0.92);
  border: 1px solid #334;
  border-left: none;
  border-radius: 0 8px 8px 0;
  width: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #334;
}
.drawer-title { font-size: 13px; font-weight: 600; color: #ccdde0; white-space: nowrap; }
.char-filter {
  background: #1a1d2e;
  color: #ccdde0;
  border: 1px solid #334;
  border-radius: 4px;
  font-size: 11px;
  padding: 2px 4px;
  max-width: 140px;
}

/* Fixed to ~5 roll rows tall; the rest scroll into view */
.drawer-body { height: 360px; overflow-y: auto; }
.drawer-empty { text-align: center; font-size: 12px; color: #556; padding: 20px; }

.roll-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 72px;
  box-sizing: border-box;
  padding: 8px 12px;
  border-bottom: 1px solid #1a1d2e;
}
.roll-char { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 48px; flex-shrink: 0; }
.roll-avatar { width: 40px; height: 40px; border-radius: 4px; overflow: hidden; background: #223; }
.roll-avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: #2233aa; color: #fff; font-weight: 700; font-size: 16px;
}
.roll-char-name {
  font-size: 10px; color: #aabbcc; text-align: center; max-width: 48px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.roll-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.roll-name-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.roll-name { font-size: 12px; font-weight: 600; color: #ccdde0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.roll-time { font-size: 10px; color: #667; flex-shrink: 0; }
.roll-result { font-size: 11px; color: #8899aa; font-family: monospace; }
.roll-result strong { color: #fff; }
.roll-result.passed strong { color: #22cc55; }
.roll-result.failed strong { color: #dd2222; }

.new-day-row {
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: #f5a623;
  padding: 8px 12px;
  margin: 4px 0;
  border-top: 1px solid rgba(245, 166, 35, 0.4);
  border-bottom: 1px solid rgba(245, 166, 35, 0.4);
}
</style>
