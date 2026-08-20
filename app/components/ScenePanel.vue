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

        <div class="scene-stage">
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
            <label class="scene-label">Image URL</label>
            <input v-model="formUrl" class="scene-input" placeholder="https://..." />
            <label class="scene-label">Caption (optional)</label>
            <input v-model="formCaption" class="scene-input" placeholder="The Ruined Temple" />
            <div class="scene-form-actions">
              <button class="scene-btn scene-btn-primary" :disabled="saving" @click="save">Show</button>
              <button class="scene-btn" :disabled="saving" @click="clear">Clear</button>
              <button class="scene-btn" :disabled="saving" @click="editing = false">Cancel</button>
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
import type { WebSocketMapMessage } from '~/types'
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
const formUrl = ref('')
const formCaption = ref('')

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

const { onMessage } = useMapWebSocket(campaignId, 'campaigns')

onMessage((msg: WebSocketMapMessage) => {
  if (msg.type !== 'scene-updated' || msg.campaignId !== campaignId.value) return
  sceneImageUrl.value = msg.sceneImageUrl
  sceneImageCaption.value = msg.sceneImageCaption
  imageError.value = false
  if (collapsed.value) unseen.value = true
})

function toggle() {
  collapsed.value = !collapsed.value
  if (!collapsed.value) unseen.value = false
  else closeSubpanels()
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
  formUrl.value = sceneImageUrl.value ?? ''
  formCaption.value = sceneImageCaption.value ?? ''
  editing.value = true
}

async function save() {
  if (!campaignId.value || !formUrl.value.trim()) return
  saving.value = true
  try {
    const data = await $fetch<{ sceneImageUrl: string | null; sceneImageCaption: string | null }>(
      `/api/campaigns/${campaignId.value}/scene`,
      { method: 'PUT', body: { imageUrl: formUrl.value.trim(), caption: formCaption.value.trim() || null } },
    )
    sceneImageUrl.value = data.sceneImageUrl
    sceneImageCaption.value = data.sceneImageCaption
    imageError.value = false
    editing.value = false
  } finally {
    saving.value = false
  }
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
  sceneImageUrl.value = null
  sceneImageCaption.value = null
  editing.value = false
  unseen.value = false
  collapsed.value = true
  closeSubpanels()
  if (id) fetchScene()
}, { immediate: true })

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
  max-width: 360px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
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
