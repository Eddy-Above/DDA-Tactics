<template>
  <Teleport to="body">
    <div class="csp-backdrop" @click="emit('close')">
      <div class="csp-card" @click.stop>
        <button class="csp-close" title="Close" @click="emit('close')">✕</button>

        <div v-if="loading" class="csp-loading">Loading…</div>
        <div v-else-if="!tamer" class="csp-loading">Character not found.</div>

        <template v-else>
          <div v-if="tabs.length > 1" class="csp-tabs">
            <button
              v-for="t in tabs" :key="t.id" class="csp-tab"
              :class="{ active: activeTab === t.id }"
              @click="activeTab = t.id"
            >{{ t.label }}</button>
          </div>

          <!-- Tamer tab -->
          <div v-if="activeTab === 'tamer'" class="csp-body">
            <div class="csp-header">
              <div class="csp-avatar">
                <img v-if="tamer.spriteUrl" :src="tamer.spriteUrl" :alt="tamer.name" @error="tamerAvatarError = true" v-show="!tamerAvatarError" />
                <span v-if="!tamer.spriteUrl || tamerAvatarError">👤</span>
              </div>
              <div class="csp-header-info">
                <h3 class="csp-name">{{ tamer.name }}</h3>
                <p class="csp-sub">Age {{ tamer.age }} • {{ campaignLevel }} campaign</p>
                <div class="csp-bar-row">
                  <span class="csp-bar-label">Wounds:</span>
                  <div class="csp-bar-track">
                    <div class="csp-bar-fill" :class="woundFillClass(tamer.currentWounds, tamerStats.woundBoxes)" :style="{ width: woundPct(tamer.currentWounds, tamerStats.woundBoxes) + '%' }" />
                  </div>
                  <span class="csp-bar-value">{{ tamerStats.woundBoxes - tamer.currentWounds }}/{{ tamerStats.woundBoxes }}</span>
                </div>
                <div class="csp-bar-row">
                  <span class="csp-bar-label">Inspiration:</span>
                  <span class="csp-insp">{{ currentInspiration }}/{{ tamerStats.maxInspiration }}</span>
                </div>
              </div>
            </div>

            <div class="csp-attrs">
              <div v-for="attr in attributeKeys" :key="attr" class="csp-attr-box">
                <div class="csp-attr-label">{{ attr }}</div>
                <div class="csp-attr-value">{{ totalAttribute(attr) }}</div>
              </div>
            </div>

            <div class="csp-derived">
              <span><span class="csp-d-label">Move:</span> {{ tamerStats.speed }}m</span>
              <span><span class="csp-d-label">Accuracy:</span> {{ tamerStats.accuracyPool }}</span>
              <span><span class="csp-d-label">Dodge:</span> {{ tamerStats.dodgePool }}</span>
              <span><span class="csp-d-label">Damage:</span> {{ tamerStats.damage }}</span>
              <span><span class="csp-d-label">Armor:</span> {{ tamerStats.armor }}</span>
            </div>

            <div v-if="tamer.torments && tamer.torments.length > 0" class="csp-torments">
              <h4 class="csp-section-title">Torments</h4>
              <div v-for="t in tamer.torments" :key="t.id" class="csp-torment">
                <div class="csp-torment-head">
                  <span class="csp-torment-name">{{ t.name }}</span>
                  <span class="csp-severity" :class="'sev-' + t.severity">{{ t.severity }}</span>
                </div>
                <div class="csp-torment-boxes">
                  <div class="csp-box-row">
                    <div
                      v-for="i in t.totalBoxes" :key="i" class="csp-box"
                      :class="i <= t.markedBoxes ? (i <= (t.cpMarkedBoxes ?? 0) ? 'marked-cp' : 'marked') : ''"
                    />
                  </div>
                  <span class="csp-torment-count">
                    {{ t.markedBoxes }}/{{ t.totalBoxes }}
                    <span v-if="t.markedBoxes < t.totalBoxes" class="csp-torment-roll">(Roll: -{{ t.totalBoxes - t.markedBoxes }})</span>
                    <span v-else class="csp-torment-overcome">(Overcome!)</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Digimon tab -->
          <div v-else-if="activeDigimon" class="csp-body">
            <div class="csp-header">
              <div class="csp-avatar">
                <img v-if="activeDigimon.spriteUrl" :src="activeDigimon.spriteUrl" :alt="activeDigimon.name" @error="digimonAvatarError = true" v-show="!digimonAvatarError" />
                <span v-if="!activeDigimon.spriteUrl || digimonAvatarError">🦖</span>
              </div>
              <div class="csp-header-info">
                <h3 class="csp-name">{{ activeDigimon.nickname || activeDigimon.name }}</h3>
                <p class="csp-sub">{{ activeDigimon.name }} • {{ activeDigimon.stage }} • {{ activeDigimon.attribute }}</p>
                <div class="csp-bar-row">
                  <span class="csp-bar-label">Wounds:</span>
                  <div class="csp-bar-track">
                    <div class="csp-bar-fill" :class="woundFillClass(activeDigimon.currentWounds, activeDigimonStats.woundBoxes)" :style="{ width: woundPct(activeDigimon.currentWounds, activeDigimonStats.woundBoxes) + '%' }" />
                  </div>
                  <span class="csp-bar-value">{{ activeDigimonStats.woundBoxes - activeDigimon.currentWounds }}/{{ activeDigimonStats.woundBoxes }}</span>
                </div>
              </div>
            </div>

            <div class="csp-attrs">
              <div class="csp-attr-box">
                <div class="csp-attr-label">ACC</div>
                <div class="csp-attr-value">{{ activeDigimonAccDmg.accuracy }}</div>
              </div>
              <div class="csp-attr-box">
                <div class="csp-attr-label">DMG</div>
                <div class="csp-attr-value">{{ activeDigimonAccDmg.damage }}</div>
              </div>
              <div class="csp-attr-box">
                <div class="csp-attr-label">DOD</div>
                <div class="csp-attr-value">{{ activeDigimonStats.dodge }}</div>
              </div>
              <div class="csp-attr-box">
                <div class="csp-attr-label">ARM</div>
                <div class="csp-attr-value">{{ activeDigimonStats.armor }}</div>
              </div>
              <div class="csp-attr-box">
                <div class="csp-attr-label">HP</div>
                <div class="csp-attr-value">{{ activeDigimonStats.health }}</div>
              </div>
            </div>

            <div class="csp-derived">
              <span><span class="csp-d-label">Move:</span> {{ activeDigimonStats.movement }}m</span>
              <span><span class="csp-d-label">BIT:</span> {{ activeDigimonStats.bit }}</span>
              <span><span class="csp-d-label">CPU:</span> {{ activeDigimonStats.cpu }}</span>
              <span><span class="csp-d-label">RAM:</span> {{ activeDigimonStats.ram }}</span>
            </div>
          </div>

          <div v-else class="csp-loading">No partner Digimon yet.</div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { Tamer, Digimon } from '../server/db/schema'
import { useTamers } from '~/composables/useTamers'
import { useDigimon } from '~/composables/useDigimon'
import { useEvolution } from '~/composables/useEvolution'
import { useCampaignContext } from '~/composables/useCampaignContext'

const props = defineProps<{
  tamerId: string
  campaignId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { fetchTamer, calculateDerivedStats: calcTamerStats } = useTamers()
const { fetchDigimonById, calculateDerivedStats: calcDigimonStats } = useDigimon()
const { fetchEvolutionLines, evolutionLines, getCurrentStage } = useEvolution()
const { campaignLevel, eddySoulRules, loadCampaign } = useCampaignContext()

const loading = ref(true)
const tamer = ref<Tamer | null>(null)
const partnerDigimon = ref<Digimon[]>([])
const activeTab = ref<'tamer' | string>('tamer')
const tamerAvatarError = ref(false)
const digimonAvatarError = ref(false)

const attributeKeys = ['agility', 'body', 'charisma', 'intelligence', 'willpower'] as const

const tabs = computed(() => [
  { id: 'tamer', label: tamer.value?.name ?? 'Tamer' },
  ...partnerDigimon.value.map((d) => ({ id: d.id, label: d.nickname || d.name })),
])

const activeDigimon = computed(() => partnerDigimon.value.find((d) => d.id === activeTab.value) ?? null)

const tamerStats = computed(() => {
  if (!tamer.value) return { woundBoxes: 2, speed: 0, accuracyPool: 0, dodgePool: 0, armor: 0, damage: 0, maxInspiration: 1 }
  return calcTamerStats(tamer.value, eddySoulRules.value)
})

const currentInspiration = computed(() => {
  if (!tamer.value) return 0
  return (tamer.value.inspiration ?? 1) + (tamer.value.grantedInspiration ?? 0) + (tamer.value.xpBonuses?.inspiration ?? 0)
})

function totalAttribute(attr: typeof attributeKeys[number]): number {
  if (!tamer.value) return 0
  const base = tamer.value.attributes[attr] || 0
  const bonus = tamer.value.xpBonuses?.attributes?.[attr] || 0
  return base + bonus
}

const activeDigimonStats = computed(() => {
  if (!activeDigimon.value) return { dodge: 0, armor: 0, health: 0, woundBoxes: 2, movement: 0, bit: 0, cpu: 0, ram: 0 }
  return calcDigimonStats(activeDigimon.value, eddySoulRules.value, false)
})

const activeDigimonAccDmg = computed(() => {
  if (!activeDigimon.value) return { accuracy: 0, damage: 0 }
  const d = activeDigimon.value as any
  const darkBonus = d.isDarkEvolution ? 2 : 0
  return {
    accuracy: d.baseStats.accuracy + (d.bonusStats?.accuracy || 0) + darkBonus,
    damage: d.baseStats.damage + (d.bonusStats?.damage || 0) + darkBonus,
  }
})

function woundPct(current: number, max: number): number {
  if (!max) return 0
  return Math.max(0, Math.min(100, ((max - current) / max) * 100))
}

function woundFillClass(current: number, max: number): string {
  if (current === 0) return 'ok'
  if (current < max / 2) return 'warn'
  if (current < max) return 'bad'
  return 'critical'
}

async function load() {
  loading.value = true
  tamer.value = null
  partnerDigimon.value = []
  activeTab.value = 'tamer'
  tamerAvatarError.value = false
  digimonAvatarError.value = false

  await loadCampaign()

  const [tamerResult] = await Promise.all([
    fetchTamer(props.tamerId),
    fetchEvolutionLines(props.tamerId, props.campaignId),
  ])
  tamer.value = tamerResult

  const currentIds = evolutionLines.value
    .map((line) => getCurrentStage(line)?.digimonId)
    .filter((id): id is string => !!id)

  const digimonResults = await Promise.all(currentIds.map((id) => fetchDigimonById(id)))
  partnerDigimon.value = digimonResults.filter((d): d is Digimon => !!d)

  loading.value = false
}

watch(() => props.tamerId, load, { immediate: true })
</script>

<style scoped>
.csp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(5, 6, 15, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.csp-card {
  position: relative;
  background: rgba(15, 17, 32, 0.98);
  border: 1px solid #334;
  border-radius: 12px;
  width: 100%;
  max-width: 460px;
  max-height: 85vh;
  overflow-y: auto;
  padding: 20px;
}
.csp-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #1a1d2e;
  border: 1px solid #334;
  color: #aabbcc;
  cursor: pointer;
  font-size: 13px;
}
.csp-close:hover { border-color: #446; color: #fff; }
.csp-loading { text-align: center; color: #778; padding: 40px 0; font-size: 13px; }

.csp-tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; padding-right: 30px; }
.csp-tab {
  background: #1a1d2e;
  border: 1px solid #334;
  border-radius: 6px;
  color: #aabbcc;
  font-size: 12px;
  padding: 5px 10px;
  cursor: pointer;
}
.csp-tab:hover { border-color: #446; }
.csp-tab.active { background: #f5a623; border-color: #f5a623; color: #1a1e30; font-weight: 600; }

.csp-header { display: flex; gap: 12px; margin-bottom: 16px; }
.csp-avatar {
  width: 64px; height: 64px; flex-shrink: 0;
  border-radius: 50%;
  background: #223;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  font-size: 28px;
}
.csp-avatar img { width: 100%; height: 100%; object-fit: cover; }
.csp-header-info { flex: 1; min-width: 0; }
.csp-name { font-size: 18px; font-weight: 700; color: #fff; margin: 0 0 2px; }
.csp-sub { font-size: 12px; color: #8899aa; margin: 0 0 8px; }

.csp-bar-row { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 4px; }
.csp-bar-label { color: #8899aa; flex-shrink: 0; }
.csp-bar-track { flex: 1; max-width: 120px; height: 6px; background: #223; border-radius: 3px; overflow: hidden; }
.csp-bar-fill { height: 100%; }
.csp-bar-fill.ok { background: #22cc55; }
.csp-bar-fill.warn { background: #eab308; }
.csp-bar-fill.bad { background: #f97316; }
.csp-bar-fill.critical { background: #dd2222; }
.csp-bar-value { color: #ccdde0; flex-shrink: 0; }
.csp-insp { color: #f5c542; font-weight: 600; }

.csp-attrs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 14px; }
.csp-attr-box { text-align: center; background: #1a1d2e; border-radius: 6px; padding: 6px 2px; }
.csp-attr-label { font-size: 9px; color: #778; text-transform: uppercase; }
.csp-attr-value { font-size: 15px; font-weight: 600; color: #fff; }

.csp-derived { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: #ccdde0; margin-bottom: 14px; }
.csp-d-label { color: #778; }

.csp-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #778; margin: 0 0 8px; padding-top: 10px; border-top: 1px solid #223; }
.csp-torment { background: #1a1d2e; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; }
.csp-torment-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.csp-torment-name { font-size: 13px; font-weight: 600; color: #fff; }
.csp-severity { font-size: 10px; padding: 1px 6px; border-radius: 4px; text-transform: capitalize; }
.sev-minor { background: rgba(234, 179, 8, 0.15); color: #eab308; }
.sev-major { background: rgba(249, 115, 22, 0.15); color: #f97316; }
.sev-terrible { background: rgba(221, 34, 34, 0.15); color: #dd2222; }
.csp-torment-boxes { display: flex; align-items: center; gap: 8px; }
.csp-box-row { display: flex; gap: 3px; }
.csp-box { width: 12px; height: 12px; border-radius: 3px; border: 1px solid #445; background: #223; }
.csp-box.marked { background: #a855f7; border-color: #c084fc; }
.csp-box.marked-cp { background: #eab308; border-color: #f5c542; }
.csp-torment-count { font-size: 11px; color: #8899aa; }
.csp-torment-roll { color: #eab308; }
.csp-torment-overcome { color: #22cc55; }
</style>
