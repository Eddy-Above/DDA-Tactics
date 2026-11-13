<template>
  <div class="map-toolbar" aria-label="Map editor tools">
    <div class="tool-groups">
      <div v-for="group in groups" :key="group.name" class="tool-group">
        <span class="group-label">{{ group.name }}</span>
        <div class="tool-row">
          <button v-for="tool in group.tools" :key="tool.id" type="button" :class="{ active: e.activeTool.value === tool.id }" :aria-pressed="e.activeTool.value === tool.id" @click="e.selectTool(tool.id)">{{ tool.label }}</button>
        </div>
      </div>
      <details class="tool-group advanced">
        <summary>Volumes</summary>
        <div class="tool-row">
          <button type="button" :class="{active:e.activeTool.value==='add-space'}" @click="e.selectTool('add-space')">Volume</button>
          <select v-model="e.spaceType.value" aria-label="Volume type"><option value="water">Water</option><option value="earth">Earth</option><option value="air">Air (legacy)</option></select>
        </div>
      </details>
      <div class="tool-group history">
        <span class="group-label">History</span>
        <div class="tool-row"><button type="button" :disabled="!e.canUndo.value" title="Undo (Ctrl/Cmd+Z)" @click="$emit('action','undo')">Undo</button><button type="button" :disabled="!e.canRedo.value" title="Redo (Ctrl/Cmd+Shift+Z)" @click="$emit('action','redo')">Redo</button></div>
      </div>
    </div>
    <div class="tool-options">
      <strong>{{ activeLabel }}</strong>
      <label v-if="shapeTool">Shape <select v-model="e.drawMode.value"><option value="line">Line</option><option value="square">Rectangle</option><option value="circle">Circle</option><option value="cube">Box</option><option v-if="e.activeTool.value!=='spawn'" value="brush">Brush</option></select></label>
      <span v-if="shapeTool && e.drawMode.value==='cube'" class="hint">Hold Ctrl + drag up/down to change height; release Ctrl to draw horizontally.</span>
      <template v-if="shapeTool && e.drawMode.value==='brush'">
        <label>Size <input v-model.number="e.brushSize.value" type="number" min="1" max="32" /></label>
        <label><input v-model="e.roundBrush.value" type="checkbox" /> Round brush</label>
      </template>
      <label v-if="materialTool">Material <select v-model="e.elementBrush.value"><option v-for="material in materials" :key="material.id" :value="material.id">{{ material.label }}</option></select><span class="swatch" :style="{background: materialColor}" /></label>
      <label>Level Y <input v-model.number="e.currentEditY.value" type="number" step="1" /></label>
      <label v-if="['voxel','ramp','add-ground','ceiling','stairs','stamp'].includes(e.activeTool.value)"><input v-model="e.planeLock.value" type="checkbox" /> Lock to Y plane</label>
      <label v-if="['ramp','stairs'].includes(e.activeTool.value)">Uphill <select v-model="e.rampDirection.value"><option v-for="direction in directions" :key="direction" :value="direction" :selected="e.rampDirection.value===direction">{{ direction[0]!.toUpperCase()+direction.slice(1) }}</option></select></label>
      <span v-if="['ramp','stairs'].includes(e.activeTool.value)" class="hint">Scroll over map to rotate</span>
      <template v-if="e.activeTool.value==='room'">
        <label>Wall height <input v-model.number="e.roomHeight.value" type="number" min="1" max="64" /></label>
        <label><input v-model="e.roomFloor.value" type="checkbox" /> Include floor</label>
        <span class="hint">Drag a room; use Door or Window on its edges.</span>
      </template>
      <label v-if="e.activeTool.value==='area-select'"><input v-model="e.selectionAllHeights.value" type="checkbox" /> Select all heights</label>
      <span v-if="e.activeTool.value==='area-select'" class="hint">Hold Ctrl + drag up/down to choose a bounded height.</span>
      <span class="hint">Hold Space + drag to pan &middot; Q/E rotate &middot; Esc cancel</span>
    </div>
    <div v-if="e.selection.value" class="tool-options selection-options">
      <strong>Selection</strong>
      <label v-for="axis in axes" :key="axis">Move {{ axis.toUpperCase() }} <input v-model.number="e.selectionOffset.value[axis]" type="number" step="1" /></label>
      <label>Rotate <select v-model.number="e.selectionTurns.value"><option :value="0">0°</option><option :value="1">90°</option><option :value="2">180°</option><option :value="3">270°</option></select></label>
      <button type="button" @click="$emit('action','move')">Move / rotate</button>
      <button type="button" @click="$emit('action','duplicate')">Duplicate</button>
      <button type="button" @click="$emit('action','focus')">Focus</button>
      <button type="button" class="danger" @click="$emit('action','delete-selection')">Delete selection</button>
      <button type="button" @click="e.selection.value=null">Clear</button>
      <label>Stamp name <input v-model="e.stampName.value" class="stamp-name" placeholder="e.g. Forest tree" maxlength="80" /></label>
      <button type="button" @click="e.saveStamp()">Save stamp</button>
      <span v-if="e.selectionPreview.value?.moveError" role="status">Move: {{ e.selectionPreview.value.moveError }}</span>
    </div>
    <div v-if="e.activeTool.value==='stamp'" class="tool-options">
      <label>Stamp <select v-model="e.activeStampId.value"><option value="">Choose a stamp</option><option v-for="stamp in e.stamps.value" :key="stamp.id" :value="stamp.id">{{ stamp.name }}</option></select></label>
      <label>Rotation <select v-model.number="e.stampTurns.value"><option :value="0">0°</option><option :value="1">90°</option><option :value="2">180°</option><option :value="3">270°</option></select></label>
      <button type="button" :disabled="!e.activeStamp.value" @click="e.deleteStamp()">Remove stamp</button>
      <span class="hint">Select content and save a stamp to reuse it across maps in this browser.</span>
    </div>
    <p v-if="e.feedback.value" class="editor-feedback" role="status">{{ e.feedback.value }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { useMapEditor } from '~/composables/useMapEditor'
import type { MapTool } from '~/types'
import { BOX_DRAW_TOOLS } from '~/utils/mapBoxDrag'
import { MAP_VOXEL_MATERIALS, getVoxelMaterialDefinition } from '~/utils/mapVoxels'
const props = defineProps<{ editor: ReturnType<typeof useMapEditor> }>()
const e = props.editor
const materials = MAP_VOXEL_MATERIALS
const axes = ['x', 'y', 'z'] as const
const directions = ['north', 'east', 'south', 'west'] as const
defineEmits<{ (event: 'action', action: string): void }>()
const groups: Array<{ name: string; tools: Array<{ id: MapTool; label: string }> }> = [
  { name: 'Navigate & select', tools: [{ id: 'select', label: 'Pan' }, { id: 'area-select', label: 'Select area' }, { id: 'stamp', label: 'Stamps' }] },
  { name: 'Build', tools: [{ id: 'add-ground', label: 'Floor' }, { id: 'voxel', label: 'Block' }, { id: 'ramp', label: 'Ramp' }, { id: 'stairs', label: 'Stairs' }, { id: 'room', label: 'Room' }, { id: 'wall', label: 'Wall' }, { id: 'ceiling', label: 'Ceiling' }, { id: 'door', label: 'Door' }, { id: 'window', label: 'Window' }] },
  { name: 'Finish', tools: [{ id: 'paint-element', label: 'Paint' }, { id: 'eyedropper', label: 'Eyedropper' }, { id: 'spawn', label: 'Spawn' }, { id: 'delete', label: 'Erase' }] },
]
const activeLabel = computed(() => groups.flatMap(group => group.tools).find(tool => tool.id === e.activeTool.value)?.label ?? 'Volume')
const shapeTool = computed(() => BOX_DRAW_TOOLS.includes(e.activeTool.value))
const materialTool = computed(() => ['add-ground', 'paint-element', 'voxel', 'ramp'].includes(e.activeTool.value) || (e.activeTool.value === 'room' && e.roomFloor.value))
const materialColor = computed(() => '#' + getVoxelMaterialDefinition(e.elementBrush.value).color.toString(16).padStart(6, '0'))
</script>
<style scoped>
.map-toolbar{flex-shrink:0;max-height:38vh;overflow:auto;background:#131724;border-bottom:1px solid #343d52;padding:10px 12px;color:#d4dce9;font-size:12px}
.tool-groups,.tool-row,.tool-options{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.tool-groups{align-items:flex-start;gap:14px}.tool-group{display:flex;flex-direction:column;gap:5px}.group-label,summary{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#96a6bf}.history{margin-left:auto}.tool-options{padding-top:9px;margin-top:9px;border-top:1px solid #2c3447;gap:10px}.tool-options label{display:flex;align-items:center;gap:5px}.tool-options strong{color:#ffa94d;min-width:50px}.hint{color:#96a6bf;font-size:11px}.advanced{min-width:75px}.advanced summary{cursor:pointer;margin-bottom:5px}
button,select,input{background:#222c40;color:#e5ecf7;border:1px solid #42506a;border-radius:6px;padding:5px 8px;font:inherit}button{cursor:pointer}button:hover{background:#344664}button.active{background:#9a4616;border-color:#ff9f43;color:white}button:disabled{opacity:.4;cursor:not-allowed}button.danger{color:#ffb0b0}input[type=number]{width:64px}input[type=checkbox]{accent-color:#ef8b35}select{max-width:180px}.stamp-name{width:140px}.swatch{width:17px;height:17px;border-radius:4px;border:1px solid #a2afc2}.editor-feedback{margin:9px 0 0;color:#ffd493}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #ffa94d;outline-offset:2px}
</style>
