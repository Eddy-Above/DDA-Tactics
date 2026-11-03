<template>
  <div v-if="campaignId" class="scene-panel">
    <button
      class="tab-toggle"
      :title="collapsed ? 'Show scene' : 'Hide scene'"
      @click="toggle"
    >
      <span class="tab-icon">🖼️</span>
      <span class="tab-label">Scene</span>
      <span v-if="collapsed && unseen" class="unseen-dot" />
      <span class="tab-arrow">{{ collapsed ? '◀' : '▶' }}</span>
    </button>

    <Teleport to="body">
      <div v-if="!collapsed" class="scene-fullscreen">
        <button class="scene-close" title="Close scene" @click="closeScene">✕</button>

        <button v-if="isDm" class="scene-edit-toggle" @click="toggleEditing">
          {{ editing ? 'Cancel Edit' : '✎ Edit Scene' }}
        </button>

        <template v-if="showNav">
          <button
            class="scene-nav scene-nav-prev"
            :disabled="prevTarget === null || saving"
            :title="navTitle('Previous', prevTarget)"
            @click="prevTarget !== null && showTab(prevTarget)"
          >‹</button>
          <button
            class="scene-nav scene-nav-next"
            :disabled="nextTarget === null || saving"
            :title="navTitle('Next', nextTarget)"
            @click="nextTarget !== null && showTab(nextTarget)"
          >›</button>
        </template>

        <div class="scene-stage" :class="{ 'has-nav': showNav }">
          <img
            v-if="sceneImageUrl && !imageError"
            :src="sceneImageUrl"
            :alt="sceneImageCaption ?? 'Scene'"
            class="scene-fs-image"
            @error="imageError = true"
          />
          <div v-else-if="sceneImageUrl && imageError" class="scene-empty">Failed to load scene image.</div>
          <div v-else class="scene-empty">
            <span v-if="isDm">No scene set. Click "Edit Scene" to add one.</span>
            <span v-else>No scene set.</span>
          </div>
          <p v-if="sceneImageCaption" class="scene-fs-caption">{{ sceneImageCaption }}</p>
        </div>

        <div v-if="isDm && editing" class="modal-backdrop" @click="editing = false">
          <div class="edit-panel" @click.stop>
            <template v-if="presetsLoaded">
              <div class="scene-tabs">
                <button
                  v-for="(p, i) in presets" :key="i" class="scene-tab"
                  :class="{ active: i === activeTab, empty: !p.imageUrl.trim() }"
                  :title="p.caption.trim() || p.imageUrl.trim() || 'Empty tab'"
                  @click="activeTab = i"
                >
                  {{ i + 1 }}
                  <span v-if="i === liveTab" class="scene-tab-live" title="Showing now" />
                </button>
                <button
                  v-if="presets.length < MAX_SCENE_PRESETS" class="scene-tab scene-tab-add"
                  title="Add a scene tab" @click="addTab"
                >+</button>
                <button
                  v-if="presets.length > 1" class="scene-tab-remove"
                  :title="`Remove tab ${activeTab + 1}`" @click="removeTab(activeTab)"
                >🗑</button>
              </div>
              <label class="scene-label">Image URL</label>
              <input v-model="activePreset.imageUrl" class="scene-input" placeholder="https://..." @input="queuePresetSave" />
              <label class="scene-label">Caption (optional)</label>
              <input v-model="activePreset.caption" class="scene-input" placeholder="The Ruined Temple" @input="queuePresetSave" />
            </template>
            <div v-else class="scene-empty">Loading scenes…</div>
            <div class="scene-form-actions">
              <button
                class="scene-btn scene-btn-primary"
                :disabled="saving || !presetsLoaded || !activePreset.imageUrl.trim()"
                @click="showTab(activeTab)"
              >Show</button>
              <button class="scene-btn" :disabled="saving" @click="clear">Clear</button>
              <button class="scene-btn" @click="editing = false">Close</button>
            </div>
          </div>
        </div>

        <button v-if="showCharacterButton" class="character-btn" @click="onCharacterButtonClick">
          {{ isDm ? '👥 Characters' : '👤 My Character' }}
        </button>

        <div v-if="isDm && showRoster" class="modal-backdrop" @click="showRoster = false">
          <div class="roster-panel" @click.stop>
            <div class="roster-header">
              <span>Characters</span>
              <button class="roster-close" @click="showRoster = false">✕</button>
            </div>
            <div v-if="rosterLoading" class="scene-empty" style="padding: 20px 0;">Loading…</div>
            <div v-else-if="rosterTamers.length === 0" class="scene-empty" style="padding: 20px 0;">No characters in this campaign yet.</div>
            <button
              v-for="t in rosterTamers" :key="t.id" class="roster-row"
              @click="pickRosterTamer(t.id)"
            >
              <div class="roster-avatar">
                <img v-if="t.spriteUrl" :src="t.spriteUrl" :alt="t.name" />
                <span v-else>👤</span>
              </div>
              <span class="roster-name">{{ t.name }}</span>
            </button>
          </div>
        </div>

        <CharacterSummaryPopup
          v-if="showCharacterPopup && activeCharacterTamerId"
          :tamer-id="activeCharacterTamerId"
          :campaign-id="campaignId"
          @close="showCharacterPopup = false"
        />
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { MAX_SCENE_PRESETS, type ScenePreset, type WebSocketMapMessage } from '~/types'
import type { Tamer } from '../server/db/schema'
import { useMapWebSocket } from '~/composables/useMapWebSocket'
import { useTamers } from '~/composables/useTamers'

const route = useRoute()
const campaignId = computed(() => (route.params.campaignId as string) || null)

const isDm = computed(() => {
  if (!campaignId.value) return false
  const cookie = useCookie(`campaign-dm-${campaignId.value}`)
  return !!cookie.value
})

const myTamerId = computed(() => {
  if (!campaignId.value || isDm.value) return null
  // A player reaching their own sheet directly (bookmarked/shared link into
  // /player/[tamerId] or a sub-route) never passes through the hub's
  // selection click, so the cookie below is often unset — especially for
  // unowned, shared-pool characters with no account tying them to a browser.
  // The route param is just as good an identity signal here as it is
  // everywhere else in the app (player/[tamerId].vue has no stronger check).
  const routeTamerId = route.params.tamerId as string | undefined
  if (routeTamerId) return routeTamerId
  const cookie = useCookie<string | null>(`player-tamer-id-${campaignId.value}`)
  return cookie.value || null
})

const collapsed = ref(true)
const unseen = ref(false)
const editing = ref(false)
const saving = ref(false)
const imageError = ref(false)

const sceneImageUrl = ref<string | null>(null)
const sceneImageCaption = ref<string | null>(null)

// GM-prepared scene tabs. `activeTab` is the one open in the editor; `cursor` is the
// one last shown, which the ◀ ▶ arrows step from. They're kept apart so prepping a
// later tab mid-session doesn't make Next skip ahead.
const presets = ref<ScenePreset[]>([emptyPreset()])
const presetsLoaded = ref(false)
const activeTab = ref(0)
const cursor = ref<number | null>(null)
const activePreset = computed(() => presets.value[activeTab.value] ?? presets.value[0])

function emptyPreset(): ScenePreset {
  return { imageUrl: '', caption: '' }
}

// Same normalization as scene.put.ts, so a tab matches the scene it put up.
function matchesLive(p: ScenePreset | undefined) {
  return !!p && !!sceneImageUrl.value
    && p.imageUrl.trim() === sceneImageUrl.value
    && (p.caption.trim() || null) === sceneImageCaption.value
}

// The tab whose scene is showing right now (the cursor wins if two tabs are identical).
const liveTab = computed<number | null>(() => {
  if (cursor.value !== null && matchesLive(presets.value[cursor.value])) return cursor.value
  const i = presets.value.findIndex(p => matchesLive(p))
  return i >= 0 ? i : null
})

// Picks the arrows up from whatever is showing (after a reload, or a co-GM's change).
// Nothing matches after Clear, so the cursor stays put and Next carries on from there.
function syncCursor() {
  if (liveTab.value !== null) cursor.value = liveTab.value
}

const storedTabs = computed(() => presets.value.flatMap((p, i) => (p.imageUrl.trim() ? [i] : [])))
const showNav = computed(() => isDm.value && presetsLoaded.value && storedTabs.value.length > 0)
const prevTarget = computed<number | null>(() => {
  const from = cursor.value
  if (from === null) return null
  return [...storedTabs.value].reverse().find(i => i < from) ?? null
})
const nextTarget = computed<number | null>(() => {
  const from = cursor.value ?? -1
  return storedTabs.value.find(i => i > from) ?? null
})

function navTitle(direction: string, target: number | null) {
  if (target === null) return `${direction} scene`
  const caption = presets.value[target]?.caption.trim()
  return `${direction} scene: ${target + 1}${caption ? ` – ${caption}` : ''}`
}

const showCharacterButton = computed(() => isDm.value || !!myTamerId.value)
const showCharacterPopup = ref(false)
const showRoster = ref(false)
const rosterLoading = ref(false)
const selectedRosterTamerId = ref<string | null>(null)

const { fetchTamers, tamers: rosterTamers } = useTamers()

const activeCharacterTamerId = computed<string | null>(() =>
  isDm.value ? selectedRosterTamerId.value : myTamerId.value
)

async function fetchScene() {
  if (!campaignId.value) return
  try {
    const data = await $fetch<{ sceneImageUrl: string | null; sceneImageCaption: string | null }>(
      `/api/campaigns/${campaignId.value}/scene`,
    )
    sceneImageUrl.value = data.sceneImageUrl
    sceneImageCaption.value = data.sceneImageCaption
    imageError.value = false
  } catch { /* keep whatever's already loaded */ }
}

// Tab autosave bookkeeping. editVersion/savedVersion stop a refetch from overwriting
// tabs the server hasn't confirmed yet, one PUT in flight at a time keeps saves in
// order, and `presetGen` bumps on campaign change so stale responses are ignored.
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveInFlight = false
let editVersion = 0
let savedVersion = 0
let presetGen = 0

// GM only: players never request the tabs (they're scenes nobody has been shown yet).
// Client only, too: on the server this runs after an await, where isDm's useCookie
// would have no Nuxt instance to read from.
async function fetchPresets() {
  const id = campaignId.value
  if (typeof window === 'undefined') return
  if (!id || !isDm.value || saveInFlight || editVersion !== savedVersion) return
  const gen = presetGen
  try {
    const data = await $fetch<{ presets: ScenePreset[] }>(`/api/campaigns/${id}/scene-presets`)
    if (gen !== presetGen || editVersion !== savedVersion) return
    presets.value = data.presets.length
      ? data.presets.map(p => ({ imageUrl: p?.imageUrl ?? '', caption: p?.caption ?? '' }))
      // No tabs saved yet: start tab 1 from the scene already showing (saved once edited).
      : [{ imageUrl: sceneImageUrl.value ?? '', caption: sceneImageCaption.value ?? '' }]
    activeTab.value = Math.min(activeTab.value, presets.value.length - 1)
    presetsLoaded.value = true
    syncCursor()
  } catch { /* keep whatever's already loaded */ }
}

function queuePresetSave() {
  if (!presetsLoaded.value) return
  editVersion++
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => flushPresetSave(), 600)
}

function flushPresetSave(id = campaignId.value) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (!id || saveInFlight || editVersion === savedVersion) return
  saveInFlight = true
  const gen = presetGen
  const version = editVersion
  $fetch(`/api/campaigns/${id}/scene-presets`, {
    method: 'PUT',
    body: { presets: presets.value.map(p => ({ ...p })) },
  })
    .then(() => { if (gen === presetGen) savedVersion = version })
    .catch(() => { /* stays unconfirmed: the next edit, Show or closing the editor retries */ })
    .finally(() => {
      if (gen !== presetGen) return
      saveInFlight = false
      // Edits made while this one was in flight go out now.
      if (editVersion !== version) flushPresetSave()
    })
}

const { onMessage } = useMapWebSocket(campaignId, 'campaigns')

onMessage((msg: WebSocketMapMessage) => {
  if (msg.type !== 'scene-updated' || msg.campaignId !== campaignId.value) return
  sceneImageUrl.value = msg.sceneImageUrl
  sceneImageCaption.value = msg.sceneImageCaption
  imageError.value = false
  if (isDm.value) syncCursor()
  if (collapsed.value) unseen.value = true
})

function toggle() {
  collapsed.value = !collapsed.value
  if (!collapsed.value) {
    unseen.value = false
    fetchPresets() // picks up tabs a co-GM (or this GM on another device) prepared
  } else closeSubpanels()
}

function closeScene() {
  collapsed.value = true
  closeSubpanels()
}

function closeSubpanels() {
  editing.value = false
  showCharacterPopup.value = false
  showRoster.value = false
}

function toggleEditing() {
  if (editing.value) { editing.value = false; return }
  if (!presetsLoaded.value) fetchPresets()
  // Open on the tab that's showing, if the current scene came from one.
  if (liveTab.value !== null) activeTab.value = liveTab.value
  editing.value = true
}

// Shows one tab to everyone. Used by the editor's Show button and the ◀ ▶ arrows.
async function showTab(i: number) {
  const preset = presets.value[i]
  if (!campaignId.value || !preset?.imageUrl.trim()) return
  saving.value = true
  try {
    flushPresetSave()
    const data = await $fetch<{ sceneImageUrl: string | null; sceneImageCaption: string | null }>(
      `/api/campaigns/${campaignId.value}/scene`,
      { method: 'PUT', body: { imageUrl: preset.imageUrl.trim(), caption: preset.caption.trim() || null } },
    )
    sceneImageUrl.value = data.sceneImageUrl
    sceneImageCaption.value = data.sceneImageCaption
    imageError.value = false
    cursor.value = i
    activeTab.value = i
    editing.value = false
  } finally {
    saving.value = false
  }
}

function addTab() {
  if (presets.value.length >= MAX_SCENE_PRESETS) return
  presets.value.push(emptyPreset())
  activeTab.value = presets.value.length - 1
  queuePresetSave()
}

function removeTab(i: number) {
  if (presets.value.length <= 1) return
  presets.value.splice(i, 1)
  activeTab.value = Math.min(activeTab.value > i ? activeTab.value - 1 : activeTab.value, presets.value.length - 1)
  // Removing the tab that's showing parks the cursor between its old neighbours
  // (i - 0.5), so ◀ and ▶ still go to the tabs either side of it.
  if (cursor.value !== null && cursor.value >= i) {
    cursor.value = cursor.value === i ? i - 0.5 : cursor.value - 1
  }
  queuePresetSave()
}

async function clear() {
  if (!campaignId.value) return
  saving.value = true
  try {
    await $fetch(`/api/campaigns/${campaignId.value}/scene`, { method: 'PUT', body: { imageUrl: null } })
    sceneImageUrl.value = null
    sceneImageCaption.value = null
    editing.value = false
  } finally {
    saving.value = false
  }
}

async function onCharacterButtonClick() {
  if (isDm.value) {
    showRoster.value = !showRoster.value
    if (showRoster.value && campaignId.value) {
      rosterLoading.value = true
      await fetchTamers(campaignId.value)
      rosterLoading.value = false
    }
  } else if (myTamerId.value) {
    showCharacterPopup.value = true
  }
}

function pickRosterTamer(id: string) {
  selectedRosterTamerId.value = id
  showRoster.value = false
  showCharacterPopup.value = true
}

watch(campaignId, (id, prev) => {
  if (id === prev) return
  // Save the old campaign's tabs before they're reset below.
  if (prev) flushPresetSave(prev)
  presetGen++
  saveInFlight = false
  editVersion = savedVersion = 0
  presets.value = [emptyPreset()]
  presetsLoaded.value = false
  activeTab.value = 0
  cursor.value = null
  sceneImageUrl.value = null
  sceneImageCaption.value = null
  editing.value = false
  unseen.value = false
  collapsed.value = true
  closeSubpanels()
  if (id) fetchScene().then(fetchPresets) // seeding tab 1 needs the live scene first
}, { immediate: true })

// Closing the editor any way (Close, backdrop, Esc, Cancel Edit, closing the scene) saves now.
watch(editing, (open) => {
  if (!open) flushPresetSave()
})

function escListener(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (showCharacterPopup.value) { showCharacterPopup.value = false; return }
  if (showRoster.value) { showRoster.value = false; return }
  if (editing.value) { editing.value = false; return }
  closeScene()
}

watch(collapsed, (isCollapsed) => {
  if (typeof window === 'undefined') return
  if (!isCollapsed) window.addEventListener('keydown', escListener)
  else window.removeEventListener('keydown', escListener)
})

onUnmounted(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', escListener)
  flushPresetSave()
})
</script>

<style scoped>
.scene-panel {
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  z-index: 60;
  display: flex;
  flex-direction: row-reverse;
  align-items: flex-start;
}

.tab-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: rgba(10, 12, 25, 0.92);
  border: 1px solid #334;
  border-right: none;
  border-radius: 8px 0 0 8px;
  padding: 10px 6px;
  cursor: pointer;
  color: #ccdde0;
  position: relative;
}
.tab-toggle:hover { background: rgba(30, 40, 70, 0.92); }
.tab-icon { font-size: 18px; }
.tab-label { font-size: 10px; writing-mode: vertical-rl; text-orientation: mixed; letter-spacing: 1px; }
.tab-arrow { font-size: 10px; color: #778; }
.unseen-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f5a623;
}

.scene-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: #05060d;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scene-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(10, 12, 25, 0.92);
  border: 1px solid #334;
  color: #ccdde0;
  font-size: 15px;
  cursor: pointer;
}
.scene-close:hover { border-color: #446; color: #fff; }

.scene-edit-toggle {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 2;
  background: rgba(10, 12, 25, 0.92);
  border: 1px solid #334;
  border-radius: 8px;
  color: #ccdde0;
  font-size: 12px;
  padding: 8px 14px;
  cursor: pointer;
}
.scene-edit-toggle:hover { border-color: #446; color: #fff; }

.scene-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 56px;
  height: 112px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 12, 25, 0.75);
  border: 1px solid #334;
  border-radius: 10px;
  color: #ccdde0;
  font-size: 44px;
  line-height: 1;
  cursor: pointer;
}
.scene-nav:hover:not(:disabled) { border-color: #f5a623; color: #fff; }
.scene-nav:disabled { opacity: 0.25; cursor: default; }
.scene-nav-prev { left: 16px; }
.scene-nav-next { right: 16px; }

.scene-stage {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  box-sizing: border-box;
}
.scene-stage.has-nav { padding-left: 88px; padding-right: 88px; }
.scene-fs-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; }
.scene-fs-caption { margin-top: 16px; color: #ccdde0; font-size: 15px; text-align: center; }
.scene-empty { color: #556; font-size: 14px; text-align: center; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3;
  background: rgba(5, 6, 15, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.edit-panel {
  background: rgba(15, 17, 32, 0.98);
  border: 1px solid #334;
  border-radius: 10px;
  width: 100%;
  max-width: 430px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.scene-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; }
.scene-tab {
  position: relative;
  min-width: 30px;
  background: #1a1d2e;
  border: 1px solid #334;
  border-radius: 6px;
  color: #aabbcc;
  font-size: 12px;
  padding: 5px 8px;
  cursor: pointer;
}
.scene-tab:hover { border-color: #446; }
.scene-tab.empty { color: #556; }
.scene-tab.active { background: #f5a623; border-color: #f5a623; color: #1a1e30; font-weight: 600; }
.scene-tab-add { color: #778; }
.scene-tab-live {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5a623;
}
.scene-tab.active .scene-tab-live { background: #1a1e30; }
.scene-tab-remove {
  margin-left: auto;
  background: none;
  border: none;
  color: #778;
  font-size: 13px;
  padding: 4px 6px;
  cursor: pointer;
}
.scene-tab-remove:hover { color: #fff; }
.scene-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #778; }
.scene-input {
  background: #1a1d2e;
  color: #ccdde0;
  border: 1px solid #334;
  border-radius: 4px;
  font-size: 12px;
  padding: 8px 10px;
}
.scene-input:focus { outline: none; border-color: #f5a623; }
.scene-form-actions { display: flex; gap: 6px; margin-top: 8px; }
.scene-btn {
  flex: 1;
  background: #1a1d2e;
  border: 1px solid #334;
  border-radius: 4px;
  color: #ccdde0;
  font-size: 12px;
  padding: 8px 0;
  cursor: pointer;
}
.scene-btn:hover:not(:disabled) { border-color: #446; }
.scene-btn:disabled { opacity: 0.5; cursor: default; }
.scene-btn-primary { background: #f5a623; border-color: #f5a623; color: #1a1e30; font-weight: 600; }
.scene-btn-primary:hover:not(:disabled) { background: #ffb84d; }

.character-btn {
  position: absolute;
  bottom: 20px;
  left: 20px;
  z-index: 2;
  background: rgba(10, 12, 25, 0.92);
  border: 1px solid #334;
  border-radius: 8px;
  color: #ccdde0;
  font-size: 13px;
  padding: 10px 16px;
  cursor: pointer;
}
.character-btn:hover { border-color: #f5a623; color: #fff; }

.roster-panel {
  background: rgba(15, 17, 32, 0.98);
  border: 1px solid #334;
  border-radius: 10px;
  width: 100%;
  max-width: 320px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px;
}
.roster-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: #ccdde0;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid #334;
}
.roster-close {
  background: none;
  border: none;
  color: #778;
  cursor: pointer;
  font-size: 13px;
}
.roster-close:hover { color: #fff; }
.roster-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  text-align: left;
}
.roster-row:hover { background: #1a1d2e; }
.roster-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: #223;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.roster-avatar img { width: 100%; height: 100%; object-fit: cover; }
.roster-name { font-size: 13px; color: #ccdde0; }
</style>
