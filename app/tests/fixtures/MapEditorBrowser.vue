<template>
  <main>
    <MapToolbar :editor="editor" @action="action" />
    <MapCanvas ref="canvas" v-bind="canvasProps"
      @cell-draw="cellDraw" @brush-stroke="editor.applyBrushStroke"
      @area-selected="editor.setSelection" @material-picked="editor.pickMaterial"
      @rotate-ramp="editor.rotateRampDirection" @editor-action="action"
      @wall-place="editor.applyWallDraw" @wall-edit-at-edge="wallEdit"
      @voxel-edit="voxelEdit" />
  </main>
</template>

<script setup lang="ts">
// Real editor components and operations, with local map data and no API/account.
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import MapCanvas from '../../components/MapCanvas.vue'
import MapToolbar from '../../components/MapToolbar.vue'
import { useMapEditor } from '../../composables/useMapEditor'
import { updateMapContentBounds } from '../../utils/mapContentBounds'
import type { GameMap, Vec3, WallFace } from '../../types'

const empty = (id='browser-map') => ({ id, name:'Browser fixture', dimensions:{width:0,depth:0}, groundTiles:[],spaceTiles:[],voxels:[],walls:[],windows:[],doors:[],ceilings:[],stairs:[] }) as unknown as GameMap
const map = shallowRef(empty())
const editor = useMapEditor(map)
const canvas = ref<any>(null)
const canvasProps = computed(() => ({
  map:map.value, participants:[], participantPositions:{}, destructibleStates:[], tamerMap:{}, digimonMap:{},
  activeTool:editor.activeTool.value,drawMode:editor.drawMode.value,brushSize:editor.brushSize.value,roundBrush:editor.roundBrush.value,
  planeLock:editor.planeLock.value,selection:editor.selection.value,selectionPreview:editor.selectionPreview.value,
  stamp:editor.activeStamp.value,stampTurns:editor.stampTurns.value,roomHeight:editor.roomHeight.value,roomFloor:editor.roomFloor.value,
  currentEditY:editor.currentEditY.value,rampDirection:editor.rampDirection.value,isDm:true,myParticipantIds:[],
  activeParticipantId:null,secondaryActiveParticipantId:null,selectedAttack:null,attackerRange:0,attackerEffectiveLimit:0,attackerMeleeRange:1,
  attackerCaps:{} as any,reachableCells:new Set<string>(),activePath:[],placingParticipantId:null,gmMoveParticipantId:null,
  npcMoveParticipantId:null,chargeMode:null,chargeMoveParticipantId:null,
}))
function cellDraw(a:Vec3,b:Vec3) {
  const tool=editor.activeTool.value
  if(tool==='add-ground')editor.applyGroundDraw(a,b)
  else if(tool==='add-space')editor.applySpaceDraw(a,b)
  else if(tool==='voxel'||tool==='ramp')editor.applyVoxelDraw(a,b,tool==='ramp'?'ramp':'block')
  else if(tool==='stairs')editor.applyStairDraw(a,b)
  else if(tool==='ceiling')editor.applyCeilingDraw(a,b)
  else if(tool==='spawn')editor.applySpawnToggle(a,b)
  else if(tool==='paint-element')editor.applyPaintElement(a,b)
  else if(tool==='delete')editor.deleteAt(a,b)
  else if(tool==='room')editor.applyRoom(a,b)
  else if(tool==='stamp')editor.placeStamp(b)
}
function wallEdit(tile:Vec3,face:WallFace,mode?:string) {
  const wall=map.value.walls.find(w=>w.x===tile.x&&w.y===tile.y&&w.z===tile.z&&w.face===face)
  if(!wall)return
  if(mode==='delete-wall')editor.deleteWallAt(tile,face)
  else if(mode==='delete-fill')editor.deleteWallFillAt(tile,face)
  else if(editor.activeTool.value==='door')editor.applyDoor(wall.id)
  else if(editor.activeTool.value==='window')editor.applyWindow(wall.id)
}
function voxelEdit(cell:Vec3,tool?:string) {
  if(tool==='window')editor.applyVoxelWindow(cell)
  else if(tool==='spawn')editor.applySpawnToggle(cell,cell)
}
function action(value:string) {
  if(value==='undo')editor.undo()
  else if(value==='redo')editor.redo()
  else if(value==='move')editor.transformSelection()
  else if(value==='duplicate')editor.transformSelection(true)
  else if(value==='delete-selection')editor.deleteSelection()
  else canvas.value?.cameraAction(value)
}
onMounted(() => {
  editor.loadStamps()
  ;(window as any).mapEditor = {
    editor,map,get canvas(){return canvas.value},nextTick,
    async reset(content:Partial<GameMap>={},fit=true) {
      editor.selection.value=null
      editor.planeLock.value=false;editor.currentEditY.value=0;editor.brushSize.value=1;editor.drawMode.value='square'
      map.value={...empty(crypto.randomUUID()),...content}
      map.value.contentBounds=updateMapContentBounds(null,map.value)
      await nextTick()
      if(fit)canvas.value.cameraAction('fit')
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    },
    state:()=>JSON.parse(JSON.stringify(map.value)),
  }
})
</script>

<style>
*{box-sizing:border-box}html,body,#app{margin:0;width:100%;height:100%;background:#1a1a2e;font-family:Arial,sans-serif}
main{height:100%;display:flex;flex-direction:column;overflow:hidden}.map-canvas-container{flex:1;min-height:0}
</style>
