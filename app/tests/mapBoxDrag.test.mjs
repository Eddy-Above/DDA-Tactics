import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { ref, shallowRef } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const boxModule=loadTypeScript('utils/mapBoxDrag.ts')
const {createMapBoxDrag,BOX_DRAW_TOOLS,supportsVerticalDrag}=boxModule
const {drawCells,cellKey}=loadTypeScript('utils/mapBuilder.ts')
const {useMapEditor}=loadTypeScript('composables/useMapEditor.ts')
const p=(x=0,y=0,z=0)=>({x,y,z})
const pointer=(clientX,clientY,ctrlKey=false)=>({clientX,clientY,ctrlKey,button:0})
const blank=()=>({id:'map',groundTiles:[],spaceTiles:[],voxels:[],walls:[],windows:[],doors:[],ceilings:[],stairs:[]})

test('Ctrl changes either vertical direction without changing the footprint and rebases horizontal movement on release',()=>{
  const drag=createMapBoxDrag(),pick=pointer=>p(pointer.clientX,0,pointer.clientY)
  drag.start(p(-4,2,7),pointer(-4,7))
  drag.update(pointer(-2,9),pick)
  drag.setControl(true)
  assert.deepEqual(drag.update(pointer(800,-63,true),pick),p(-2,3,9))
  // The end surface had Y=0; three upward levels now put its endpoint at Y=3.
  assert.equal(drag.heightAdjusted,true)
  drag.setControl(false)
  assert.deepEqual(drag.update(pointer(800,-63),pick),p(-2,3,9))
  assert.deepEqual(drag.update(pointer(802,-62),pick),p(0,3,10))
  drag.setControl(true)
  assert.deepEqual(drag.update(pointer(0,34,true),pick),p(0,-1,10))
  drag.setControl(false)
  assert.deepEqual(drag.update(pointer(0,34),pick),p(0,-1,10))
  drag.reset();assert.equal(drag.active,false);assert.equal(drag.heightAdjusted,false)
})

test('Ctrl held before pressing the mouse starts a vertical drag and no surface is needed while changing height',()=>{
  const drag=createMapBoxDrag()
  drag.start(p(-3,-2,8),pointer(100,100,true))
  assert.deepEqual(drag.update(pointer(400,148,true),()=>{throw Error('vertical drawing must not raycast')}),p(-3,-4,8))
  drag.setControl(false)
  assert.deepEqual(drag.update(pointer(400,148),()=>null),p(-3,-4,8),'a temporary empty ray keeps the chosen endpoint')
})

test('every Box tool and Select area share the same vertical modifier',()=>{
  assert.equal(BOX_DRAW_TOOLS.length,9)
  for(const tool of BOX_DRAW_TOOLS){assert.equal(supportsVerticalDrag(tool,'cube'),true);assert.equal(supportsVerticalDrag(tool,'square'),false)}
  assert.equal(supportsVerticalDrag('area-select','square'),true)
  for(const tool of ['select','wall','door','window','room','stamp','eyedropper'])assert.equal(supportsVerticalDrag(tool,'cube'),false)
})

test('native event prototype coordinates are retained for the initial vertical anchor',()=>{
  const drag=createMapBoxDrag()
  const event=Object.create({get clientX(){return 50},get clientY(){return 100},get ctrlKey(){return false}})
  drag.start(p(1,0,2),event)
  drag.setControl(true)
  assert.deepEqual(drag.update(pointer(500,28,true),()=>null),p(1,3,2))
})

function fixture(tool){
  const cells=drawCells(p(2,0,4),p(4,3,6),'cube'),map=shallowRef(blank()),boxDrag=createMapBoxDrag()
  if(['spawn','delete','paint-element'].includes(tool))map.value.voxels=[...cells.map(cell=>({...cell,materialId:'wood'})),{...p(100,20,100),materialId:'wood'}]
  const original=JSON.parse(JSON.stringify(map.value)),editor=useMapEditor(map),events=[]
  editor.selectTool(tool);editor.drawMode.value=tool==='area-select'?'square':'cube';editor.elementBrush.value='sand'
  const props={isDm:true,activeTool:tool,drawMode:editor.drawMode.value,planeLock:true}
  let handlers
  const deps={props,boxDrag,...boxModule,THREE,keysHeld:new Set(),controls:{enabled:true,mouseButtons:{}},spacePanning:ref(false),panGesture:false,
    dragStartHit:null,strokePoints:[],brushPreview:{cells:new Map(),bounds:null,invalid:false},rightDragActive:false,rightDragLastX:0,
    pendingPointerEvent:null,editorHint:ref(null),hoverGhostGroup:new THREE.Group(),
    canvasRef:ref({getBoundingClientRect:()=>({left:0,top:0,right:1000,bottom:1000})}),
    tokenDrag:{isPressed:()=>false,pointerCancel:()=>{}},getMoveAim:()=>null,participantChoice:ref(null),areaHighlightCells:ref([]),
    editorCell:event=>p(Math.round(event.clientX/24),0,Math.round(event.clientY/24)),voxelCellFromEvent:()=>null,
    wallEdgeFromEvent:()=>{throw Error('Ctrl Box erasing must not pick a wall fill')},
    requestRender:()=>{},swallowNextClick:()=>{},updateHoverGhost:event=>handlers.getHoveredHit(event),
    emit:(kind,...args)=>{
      events.push([kind,...args])
      if(kind==='area-selected'){editor.setSelection(...args);return}
      if(kind!=='cell-draw')return
      const operations={'add-ground':editor.applyGroundDraw,'add-space':editor.applySpaceDraw,'paint-element':editor.applyPaintElement,
        voxel:editor.applyVoxelDraw,ramp:(a,b)=>editor.applyVoxelDraw(a,b,'ramp'),stairs:editor.applyStairDraw,
        ceiling:editor.applyCeilingDraw,spawn:editor.applySpawnToggle,delete:editor.deleteAt}
      operations[tool](...args)
    },
  }
  handlers=loadPageFunctions('components/MapCanvas.vue',['getHoveredHit','boxCellFromPointer','onMouseDown','onMouseUp','queueMouseMove',
    'onKeyDown','onKeyUp','refreshBoxDragPreview','cancelEditorGesture','resetEditorInput','syncEditorCameraControls'],deps)
  return {boxDrag,props,map,editor,events,cells,original,...handlers}
}
function verticalGesture(h,release=true){
  h.onMouseDown(pointer(48,96))
  h.queueMouseMove(pointer(96,144))
  h.onKeyDown({key:'Control',ctrlKey:true,preventDefault:()=>{}})
  h.queueMouseMove(pointer(500,72,true))
  assert.deepEqual(h.boxDrag.end,p(4,3,6))
  if(release){h.onKeyUp({key:'Control'});h.onMouseUp(pointer(500,72))}
}
for(const tool of BOX_DRAW_TOOLS)test(`${tool}: the real canvas commits and undoes the Ctrl-expanded Box as one edit`,()=>{
  const h=fixture(tool);verticalGesture(h)
  assert.deepEqual(h.events.find(event=>event[0]==='cell-draw').slice(1),[p(2,0,4),p(4,3,6)])
  const collection={'add-ground':'groundTiles','add-space':'spaceTiles',stairs:'stairs',ceiling:'ceilings'}[tool]??'voxels'
  if(tool==='delete')assert.deepEqual(h.map.value.voxels,[{...p(100,20,100),materialId:'wood'}])
  else{
    const selected=h.map.value[collection].filter(cell=>cell.x<100)
    assert.deepEqual(new Set(selected.map(cellKey)),new Set(h.cells.map(cellKey)))
    if(tool==='spawn')assert.ok(selected.every(cell=>cell.isSpawnPoint))
    if(tool==='paint-element')assert.ok(selected.every(cell=>cell.materialId==='sand'))
  }
  assert.equal(h.editor.undo(),true);assert.deepEqual(JSON.parse(JSON.stringify(h.map.value)),h.original)
  assert.equal(h.editor.canUndo.value,false);assert.equal(h.boxDrag.active,false)
})
test('Ctrl Select area commits bounded height and turns off the all-heights option',()=>{
  const h=fixture('area-select')
  h.map.value={...h.map.value,voxels:[{...p(0,-20,0),materialId:'wood'},{...p(100,40,100),materialId:'wood'}]}
  verticalGesture(h)
  assert.deepEqual(h.editor.selection.value,{min:p(2,0,4),max:p(4,3,6)})
  assert.equal(h.editor.selectionAllHeights.value,false)
})
for(const cancellation of ['escape','blur','space'])test(`a Ctrl Box cancelled by ${cancellation} creates no edit`,()=>{
  const h=fixture('voxel');verticalGesture(h,false)
  if(cancellation==='escape')h.onKeyDown({key:'Escape'})
  else if(cancellation==='blur')h.resetEditorInput()
  else{h.onKeyDown({code:'Space',key:' ',preventDefault:()=>{}});h.onKeyUp({code:'Space',key:' '})}
  h.onMouseUp(pointer(500,72))
  assert.equal(h.map.value.voxels.length,0);assert.equal(h.editor.canUndo.value,false);assert.equal(h.boxDrag.active,false)
})
