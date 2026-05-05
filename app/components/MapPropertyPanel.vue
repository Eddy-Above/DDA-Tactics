<template>
  <div v-if="selected" class="property-panel">
    <div class="panel-header">
      <span class="panel-title">{{ selectedLabel }}</span>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>

    <div class="field-group">
      <label class="field-label">Wound Boxes</label>
      <div class="wound-row">
        <input
          v-model.number="woundBoxes"
          type="number"
          min="1"
          max="50"
          class="field-input"
          placeholder="Leave empty = unbreakable"
        />
        <button
          class="unbreakable-btn"
          :class="{ active: woundBoxes === null }"
          @click="woundBoxes = null"
        >Unbreakable</button>
      </div>
    </div>

    <div v-if="selected.type === 'stairs'" class="field-group">
      <label class="field-label">Direction</label>
      <select v-model="stairFace" class="field-input">
        <option value="north">North ↑</option>
        <option value="south">South ↓</option>
        <option value="east">East →</option>
        <option value="west">West ←</option>
      </select>
    </div>

    <button class="save-btn" @click="save">Save</button>
  </div>
</template>

<script setup lang="ts">
import type { WallFace } from '~/types'

interface SelectedStructure {
  type: 'wall' | 'window' | 'door' | 'ceiling' | 'stairs'
  id: string
  currentWoundBoxes?: number
  face?: WallFace
}

const props = defineProps<{ selected: SelectedStructure | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', id: string, type: string, woundBoxes: number | null, face?: WallFace): void
}>()

const woundBoxes = ref<number | null>(null)
const stairFace = ref<WallFace>('north')

watch(() => props.selected, (s) => {
  woundBoxes.value = s?.currentWoundBoxes ?? null
  stairFace.value = (s?.face ?? 'north') as WallFace
}, { immediate: true })

const selectedLabel = computed(() => {
  if (!props.selected) return ''
  const labels: Record<string, string> = { wall: 'Wall', window: 'Window', door: 'Door', ceiling: 'Ceiling', stairs: 'Stairs' }
  return labels[props.selected.type] ?? props.selected.type
})

function save() {
  if (!props.selected) return
  emit('save', props.selected.id, props.selected.type, woundBoxes.value, stairFace.value)
}
</script>

<style scoped>
.property-panel {
  background: rgba(10, 12, 25, 0.92);
  border: 1px solid #334;
  border-radius: 8px;
  padding: 12px;
  min-width: 200px;
  color: #aabbcc;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.panel-title { font-size: 14px; font-weight: 600; color: #ccdde0; }
.close-btn { background: none; border: none; color: #778; cursor: pointer; font-size: 14px; }
.field-group { margin-bottom: 10px; }
.field-label { font-size: 11px; color: #778; display: block; margin-bottom: 4px; }
.field-input {
  width: 100%;
  background: #1a1d2e;
  border: 1px solid #334;
  border-radius: 4px;
  padding: 5px 8px;
  color: #aabbcc;
  font-size: 13px;
}
.wound-row { display: flex; gap: 6px; align-items: center; }
.unbreakable-btn {
  font-size: 11px;
  padding: 4px 8px;
  background: #223;
  border: 1px solid #445;
  border-radius: 4px;
  color: #8899aa;
  cursor: pointer;
  white-space: nowrap;
}
.unbreakable-btn.active { background: #2255aa; border-color: #4488ff; color: #fff; }
.save-btn {
  width: 100%;
  background: #2255aa;
  border: none;
  border-radius: 6px;
  padding: 7px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
}
.save-btn:hover { background: #3366cc; }
</style>
