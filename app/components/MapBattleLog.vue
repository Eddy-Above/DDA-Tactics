<template>
  <div class="battle-log-panel" :class="{ collapsed }">
    <div class="log-header" @click="collapsed = !collapsed">
      <span class="log-title">⚔ Battle Log</span>
      <span class="log-toggle">{{ collapsed ? '▶' : '▼' }}</span>
    </div>

    <div v-if="!collapsed" ref="logBody" class="log-body">
      <div v-if="props.battleLogWasTrimmed" class="log-trimmed-note">
        Showing last {{ entries.length }} of {{ props.battleLogTotal }}
      </div>
      <div
        v-for="entry in filteredLog"
        :key="entry.id"
        class="log-entry"
        @click="entry._expanded = !entry._expanded"
      >
        <div class="entry-summary">
          <span class="entry-actor">{{ entry.actorName }}</span>
          <span class="entry-action">{{ entry.action }}</span>
          <span v-if="entry.target" class="entry-target">→ {{ entry.target }}</span>
        </div>
        <div class="entry-result" :class="entry.damage ? 'damage' : 'support'">
          {{ entry.result }}
        </div>
        <div v-if="entry._expanded && isDm" class="entry-detail">
          <div v-if="entry.damage !== null">Damage: <strong>{{ entry.damage }}</strong></div>
          <div v-for="fx in entry.effects" :key="fx" class="entry-effect">{{ fx }}</div>
        </div>
      </div>

      <div v-if="filteredLog.length === 0" class="log-empty">No events yet.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BattleLogEntry } from '~/types'

const props = defineProps<{
  battleLog: BattleLogEntry[]
  isDm: boolean
  npcEntityIds: Set<string>  // set of entity IDs that belong to NPCs
  battleLogTotal?: number
  battleLogWasTrimmed?: boolean
}>()

const collapsed = ref(false)
const logBody = ref<HTMLDivElement | null>(null)

// Entries with local expansion state
type ExtendedEntry = BattleLogEntry & { _expanded?: boolean }
const entries = ref<ExtendedEntry[]>([])

watch(() => props.battleLog, (log) => {
  entries.value = log.map(e => ({ ...e, _expanded: false }))
  nextTick(() => {
    if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight
  })
}, { immediate: true, deep: true })

const filteredLog = computed(() => {
  return entries.value.map(e => {
    const ext = e as any
    const damageDealt: number = ext.finalDamage ?? (typeof e.damage === 'number' ? e.damage : 0)
    const damageSuffix = damageDealt > 0 ? ` (${damageDealt} dmg)` : ''

    if (props.isDm) {
      return { ...e, result: e.result + damageSuffix }
    }

    const isNpcAction = props.npcEntityIds.has(e.actorId)
    const attackerIsNpc = ext.attackerParticipantId && props.npcEntityIds.has(ext.attackerParticipantId)

    if (isNpcAction || attackerIsNpc) {
      // Strip the dice pool+results prefix (e.g. "6d6 => [3,5,2,5,3,5] = ") but keep successes, Net, verdict
      const stripped = e.result.replace(/^\d+d6\s*=>\s*\[[^\]]*\]\s*=\s*/i, '')
      return { ...e, result: stripped + damageSuffix }
    }

    return { ...e, result: e.result + damageSuffix }
  })
})
</script>

<style scoped>
.battle-log-panel {
  background: rgba(10, 12, 25, 0.88);
  border: 1px solid #334;
  border-radius: 8px 8px 0 0;
  width: 280px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid #334;
  user-select: none;
}
.log-title { font-size: 13px; font-weight: 600; color: #ccdde0; }
.log-toggle { color: #778; font-size: 11px; }
.log-body { overflow-y: auto; flex: 1; padding: 6px 0; }
.log-entry {
  padding: 5px 12px;
  border-bottom: 1px solid #1a1d2e;
  cursor: pointer;
  transition: background 0.1s;
}
.log-entry:hover { background: rgba(40, 60, 90, 0.4); }
.entry-summary { font-size: 12px; color: #8899aa; }
.entry-actor { color: #66aadd; font-weight: 600; }
.entry-action { margin: 0 4px; }
.entry-target { color: #dd6655; }
.entry-result { font-size: 11px; margin-top: 2px; }
.entry-result.damage { color: #ff8877; }
.entry-result.support { color: #88ddaa; }
.entry-detail { margin-top: 4px; font-size: 11px; color: #778; }
.entry-effect { color: #aabb88; }
.log-empty { text-align: center; font-size: 12px; color: #556; padding: 16px; }
.log-trimmed-note { text-align: center; font-size: 10px; color: #556; padding: 4px 0 6px; }
.battle-log-panel.collapsed { max-height: none; }
</style>
