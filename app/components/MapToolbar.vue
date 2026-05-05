<template>
  <div class="map-toolbar">
    <!-- Tool buttons -->
    <div class="toolbar-section">
      <div v-for="tool in tools" :key="tool.id" class="tool-wrapper">
        <button
          class="tool-btn"
          :class="{ active: activeTool === tool.id }"
          :title="tool.hint ? undefined : tool.label"
          @click="$emit('select-tool', tool.id)"
        >
          {{ tool.icon }}
        </button>
        <div v-if="tool.hint" class="tool-tooltip">
          <strong>{{ tool.label }}</strong>
          <span v-for="line in tool.hint" :key="line"><kbd>{{ line.key }}</kbd> {{ line.desc }}</span>
        </div>
      </div>
    </div>

    <!-- Draw mode (when applicable) -->
    <div v-if="showDrawMode" class="toolbar-section">
      <button
        v-for="mode in drawModes"
        :key="mode.id"
        class="mode-btn"
        :class="{ active: drawMode === mode.id }"
        :title="mode.label"
        @click="$emit('set-draw-mode', mode.id)"
      >{{ mode.label }}</button>
    </div>

    <!-- Y-level indicator -->
    <div class="toolbar-section y-level">
      <button class="mode-btn" @click="$emit('change-y', -1)">▼</button>
      <span class="y-label">↕ Y: {{ currentEditY }}</span>
      <button class="mode-btn" @click="$emit('change-y', 1)">▲</button>
    </div>

    <!-- Element picker (paint tool) -->
    <div v-if="activeTool === 'paint-element'" class="toolbar-section element-picker">
      <button
        v-for="el in elements"
        :key="el.id"
        class="element-btn"
        :class="{ active: elementBrush === el.id }"
        :style="{ background: el.color }"
        :title="el.label"
        @click="$emit('set-element', el.id)"
      >
        <span class="element-label">{{ el.short }}</span>
      </button>
    </div>

    <!-- Undo / Redo -->
    <div class="toolbar-section">
      <button class="tool-btn" :disabled="!canUndo" title="Undo" @click="$emit('undo')">↩</button>
      <button class="tool-btn" :disabled="!canRedo" title="Redo" @click="$emit('redo')">↪</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MapTool, ElementType } from '~/types'

defineProps<{
  activeTool: MapTool
  drawMode: 'line' | 'square' | 'cube'
  elementBrush: ElementType
  currentEditY: number
  canUndo: boolean
  canRedo: boolean
}>()

defineEmits<{
  (e: 'select-tool', tool: MapTool): void
  (e: 'set-draw-mode', mode: 'line' | 'square' | 'cube'): void
  (e: 'set-element', el: ElementType): void
  (e: 'change-y', delta: number): void
  (e: 'undo'): void
  (e: 'redo'): void
}>()

const tools: Array<{ id: MapTool; icon: string; label: string; hint?: { key: string; desc: string }[] }> = [
  { id: 'select',        icon: '↖',  label: 'Select' },
  { id: 'add-ground',    icon: '⬛',  label: 'Add Ground' },
  { id: 'add-space',     icon: '🔲',  label: 'Add Space' },
  { id: 'paint-element', icon: '🎨',  label: 'Paint Element' },
  { id: 'wall',          icon: '🧱',  label: 'Wall' },
  { id: 'window',        icon: '🪟',  label: 'Window' },
  { id: 'door',          icon: '🚪',  label: 'Door' },
  { id: 'stairs',        icon: '🪜',  label: 'Stairs' },
  { id: 'spawn',  icon: '🟢', label: 'Spawn Point' },
  { id: 'delete', icon: '🗑', label: 'Delete', hint: [
    { key: 'Click',       desc: '— delete tile' },
    { key: 'Shift+click', desc: '— delete wall' },
    { key: 'Ctrl+click',  desc: '— remove window / door' },
  ]},
]

const drawModes = [
  { id: 'line',   label: 'Line' },
  { id: 'square', label: 'Square' },
  { id: 'cube',   label: 'Cube' },
]

const showDrawMode = computed(() => {
  // These tools support draw mode selection
  return false // drawMode only shown for area tools — toolbar always shows it
})

const elements: Array<{ id: ElementType; label: string; short: string; color: string }> = [
  { id: 'void',      label: 'Void (Neutral)', short: 'Vd', color: '#555566' },
  { id: 'fire',      label: 'Fire',           short: 'Fr', color: '#ff4422' },
  { id: 'water',     label: 'Water',          short: 'Wt', color: '#2288ff' },
  { id: 'wind',      label: 'Wind',           short: 'Wn', color: '#88ddaa' },
  { id: 'ice',       label: 'Ice',            short: 'Ic', color: '#aaddff' },
  { id: 'thunder',   label: 'Thunder',        short: 'Th', color: '#ffdd00' },
  { id: 'wood',      label: 'Wood',           short: 'Wd', color: '#44aa44' },
  { id: 'earth',     label: 'Earth',          short: 'Ea', color: '#886644' },
  { id: 'darkness',  label: 'Darkness',       short: 'Dk', color: '#442266' },
  { id: 'steel',     label: 'Steel',          short: 'St', color: '#99aabb' },
  { id: 'light',     label: 'Light',          short: 'Lt', color: '#ffffcc' },
]
</script>

<style scoped>
.map-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: rgba(15, 15, 30, 0.88);
  border-bottom: 1px solid #334;
  padding: 6px 10px;
}
.toolbar-section {
  display: flex;
  align-items: center;
  gap: 4px;
  border-right: 1px solid #334;
  padding-right: 8px;
}
.toolbar-section:last-child { border-right: none; }
.tool-btn, .mode-btn {
  background: #223;
  border: 1px solid #445;
  color: #aabbcc;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.tool-btn:hover, .mode-btn:hover { background: #334; }
.tool-btn.active, .mode-btn.active { background: #2255aa; border-color: #4488ff; color: #fff; }
.tool-btn:disabled, .mode-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.y-level { gap: 6px; }
.y-label { font-size: 12px; color: #8899aa; min-width: 48px; text-align: center; }
.element-picker { flex-wrap: wrap; max-width: 220px; }
.element-btn {
  width: 28px; height: 28px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.element-btn.active { border-color: #fff; }
.element-label { font-size: 9px; color: rgba(255,255,255,0.8); font-weight: 700; }
.tool-wrapper {
  position: relative;
}
.tool-tooltip {
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(10, 12, 25, 0.95);
  border: 1px solid #445;
  border-radius: 6px;
  padding: 7px 10px;
  flex-direction: column;
  gap: 4px;
  white-space: nowrap;
  z-index: 100;
  pointer-events: none;
}
.tool-wrapper:hover .tool-tooltip { display: flex; }
.tool-tooltip strong {
  font-size: 11px;
  color: #ccd;
  margin-bottom: 2px;
}
.tool-tooltip span {
  font-size: 11px;
  color: #8899aa;
}
.tool-tooltip kbd {
  background: #2a2e45;
  border: 1px solid #556;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: #cce;
  font-family: inherit;
}
</style>
