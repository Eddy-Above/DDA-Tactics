import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import * as THREE from 'three'
import { shallowRef, ref } from 'vue'
import { loadTypeScript, loadPageFunctions } from './helpers/loadTypeScript.mjs'
const builder=loadTypeScript('utils/mapBuilder.ts')
const {useMapEditor}=loadTypeScript('composables/useMapEditor.ts')
const {getMapGeometryRevision}=loadTypeScript('utils/mapEdits.ts')
const {createMapTerrainChunks}=loadTypeScript('utils/mapTerrainChunks.ts')
const {getVoxelMaterialDefinition}=loadTypeScript('utils/mapVoxels.ts')
const point=(x=0,y=0,z=0)=>({x,y,z})
const makeMap=(extra={})=>({id:'map',groundTiles:[],spaceTiles:[],voxels:[],walls:[],windows:[],doors:[],ceilings:[],stairs:[],...extra})
const originalStorage=globalThis.localStorage
afterEach(()=>{if(originalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalStorage})

test('floor placement uses the selected full material and painting can change it',()=>{
  const map=shallowRef(makeMap()),editor=useMapEditor(map)
  editor.elementBrush.value='sand';editor.applyGroundDraw(point(-2),point())
  assert.equal(map.value.groundTiles.length,3)
  for(const tile of map.value.groundTiles){assert.equal(tile.materialId,'sand');assert.equal(tile.element,'earth')}
  editor.elementBrush.value='snow';editor.applyPaintElement(point(-1),point(-1))
  assert.equal(map.value.groundTiles[1].materialId,'snow');assert.equal(map.value.groundTiles[1].element,'ice')
  assert.equal(editor.undo(),true);assert.equal(map.value.groundTiles[1].materialId,'sand')
})

test('circles omit rectangle corners and brush strokes interpolate gaps as one undoable edit',()=>{
  const circle=builder.drawCells(point(-2,0,-2),point(2,0,2),'circle')
  assert.ok(circle.length<25&&circle.length>9)
  assert.ok(!circle.some(p=>p.x===-2&&p.z===-2))
  const map=shallowRef(makeMap()),editor=useMapEditor(map)
  editor.selectTool('voxel');editor.elementBrush.value='wood';editor.brushSize.value=3
  const revision=getMapGeometryRevision(map.value)
  editor.applyBrushStroke([point(-5),point(5)])
  assert.ok(getMapGeometryRevision(map.value)>revision)
  assert.equal(map.value.voxels.length,39)
  for(let x=-6;x<=6;x++)for(let z=-1;z<=1;z++)assert.ok(map.value.voxels.some(p=>p.x===x&&p.z===z))
  assert.equal(editor.undo(),true);assert.equal(map.value.voxels.length,0);assert.equal(editor.canUndo.value,false)
  editor.redo();assert.equal(map.value.voxels.length,39)
})

test('room tool makes walls at every configured height, leaves floors optional, and undoes as one operation',()=>{
  const map=shallowRef(makeMap()),editor=useMapEditor(map)
  editor.roomHeight.value=3;editor.applyRoom(point(-2,4,-1),point(1,4,2))
  assert.equal(map.value.walls.length,48);assert.equal(map.value.groundTiles.length,0)
  assert.deepEqual([...new Set(map.value.walls.map(w=>w.y))],[4,5,6])
  editor.undo();assert.equal(map.value.walls.length,0)
  editor.roomFloor.value=true;editor.elementBrush.value='wood';editor.applyRoom(point(),point(1,0,1))
  assert.equal(map.value.groundTiles.length,4);assert.ok(map.value.groundTiles.every(p=>p.materialId==='wood'))
  editor.undo();assert.equal(map.value.walls.length,0);assert.equal(map.value.groundTiles.length,0)
})

function structure(){return makeMap({
  voxels:[{...point(-2,1,-3),materialId:'wood',shape:'ramp',rampDirection:'north'}],
  walls:[{...point(-2,0,-3),id:'wall',face:'north',woundBoxes:4}],
  doors:[{id:'door',wallId:'wall',isOpen:true}],windows:[{id:'window',wallId:'wall',woundBoxes:2}],
  stairs:[{...point(-1,0,-3),id:'stairs',face:'west'}],
})}

test('selection rotation and duplication preserve attachments, properties, and fresh IDs; undo restores exact content',()=>{
  const initial=structure(),map=shallowRef(initial),editor=useMapEditor(map)
  editor.setSelection(point(-2,0,-3),point(-1,0,-3))
  editor.selectionOffset.value={x:10,y:2,z:4};editor.selectionTurns.value=1
  assert.equal(editor.transformSelection(true),true)
  assert.equal(map.value.walls.length,2);assert.equal(map.value.voxels.length,2)
  const wall=map.value.walls.find(w=>w.id!=='wall')
  assert.equal(wall.face,'east');assert.equal(wall.woundBoxes,4)
  assert.deepEqual(point(wall.x,wall.y,wall.z),point(8,2,1))
  const door=map.value.doors.find(p=>p.id!=='door');assert.equal(door.wallId,wall.id);assert.equal(door.isOpen,true)
  assert.equal(map.value.windows.find(p=>p.id!=='window').wallId,wall.id)
  assert.equal(map.value.voxels.find(p=>p.x===8).rampDirection,'east')
  assert.equal(map.value.stairs.find(p=>p.id!=='stairs').face,'south')
  editor.undo();for(const key of ['voxels','walls','windows','doors','stairs'])assert.deepEqual(map.value[key],initial[key])
})

test('move and delete selection are atomic and a colliding duplicate never destroys existing content',()=>{
  const map=shallowRef(structure()),editor=useMapEditor(map)
  editor.setSelection(point(-2,0,-3),point(-1,0,-3))
  assert.equal(editor.transformSelection(true),false);assert.match(editor.feedback.value,/overlaps/)
  editor.selectionOffset.value={x:4,y:0,z:0};assert.equal(editor.transformSelection(false),true)
  assert.equal(map.value.walls.length,1);assert.equal(map.value.walls[0].x,2)
  editor.deleteSelection();assert.equal(map.value.walls.length,0);assert.equal(map.value.doors.length,0)
  editor.undo();assert.equal(map.value.walls.length,1);assert.equal(map.value.doors.length,1)
})

test('saved stamps persist across editor instances and place rotated independent linked structures',()=>{
  const store=new Map();globalThis.localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)}
  const map=shallowRef(structure()),editor=useMapEditor(map)
  editor.setSelection(point(-2,0,-3),point(-1,0,-3));editor.stampName.value='Tree and wall';editor.saveStamp()
  const next=shallowRef(makeMap()),other=useMapEditor(next);other.loadStamps()
  assert.equal(other.stamps.value.length,1);other.activeStampId.value=other.stamps.value[0].id
  other.stampTurns.value=2;assert.equal(other.placeStamp(point(-50,-4,100)),true)
  assert.equal(next.value.walls[0].face,'south');assert.equal(next.value.doors[0].wallId,next.value.walls[0].id)
  assert.equal(other.placeStamp(point(-50,-4,100)),false)
  other.undo();assert.equal(next.value.walls.length,0)
})

test('surface building follows hit normals while plane lock and paint use their intended cells',()=>{
  const props={activeTool:'voxel',currentEditY:0,planeLock:false}
  const hit={object:{userData:{type:'voxel',voxel:point(-4,7,3)},matrixWorld:new THREE.Matrix4()},face:{normal:new THREE.Vector3(1,0,0)}}
  const {editorCell}=loadPageFunctions('components/MapCanvas.vue',['editorCell'],{props,dragStartHit:null,getIntersection:()=>[hit],planeCell:()=>point(1,0,1)})
  assert.deepEqual(editorCell({}),point(-3,7,3))
  hit.face.normal.set(0,1,0);assert.deepEqual(editorCell({}),point(-4,8,3))
  props.activeTool='paint-element';assert.deepEqual(editorCell({}),point(-4,7,3))
  props.planeLock=true;assert.deepEqual(editorCell({}),point(1,0,1))
})

test('Space panning preserves the active tool, ignores text inputs, and resets safely on blur',()=>{
  const props={isDm:true,activeTool:'voxel'},spacePanning=ref(false),keysHeld=new Set(),controls={enabled:true,mouseButtons:{}}
  const deps={THREE,props,spacePanning,keysHeld,controls,panGesture:false,dragStartHit:null,strokePoints:[],rightDragActive:false,editorHint:ref(null),hoverGhostGroup:new THREE.Group(),requestRender:()=>{},swallowNextClick:()=>{},emit:()=>{}}
  const h=loadPageFunctions('components/MapCanvas.vue',['syncEditorCameraControls','cancelEditorGesture','resetEditorInput','onKeyDown','onKeyUp'],deps)
  let prevented=false
  h.onKeyDown({code:'Space',key:' ',preventDefault:()=>{prevented=true}})
  assert.equal(spacePanning.value,true);assert.equal(controls.mouseButtons.LEFT,THREE.MOUSE.PAN);assert.equal(prevented,true)
  h.onKeyUp({code:'Space',key:' '});assert.equal(spacePanning.value,false);assert.equal(props.activeTool,'voxel')
  h.onKeyDown({code:'Space',key:' ',target:{closest:()=>({})}});assert.equal(spacePanning.value,false)
  h.onKeyDown({code:'Space',key:' ',preventDefault:()=>{}});h.resetEditorInput();assert.equal(spacePanning.value,false)
})

test('floor material colour survives rendering and adjacent materials blend within the original lit mesh',()=>{
  const scene=new THREE.Scene(),manager=createMapTerrainChunks({scene,tileHeight:.12})
  manager.sync(makeMap({groundTiles:[{...point(),element:'earth',materialId:'sand',terrain:'normal'},{...point(1),element:'wood',materialId:'wood',terrain:'normal'}]}))
  const meshes=[...manager.chunks.values()].flatMap(group=>group.children).filter(object=>object.isInstancedMesh)
  assert.equal(meshes.length,1);assert.equal(meshes[0].count,2)
  const colour=new THREE.Color();meshes[0].getColorAt(0,colour);assert.equal(colour.getHex(),getVoxelMaterialDefinition('sand').color)
  assert.equal(meshes[0].material.isMeshLambertMaterial,true);assert.equal(meshes[0].material.emissive.getHex(),0)
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader}
  meshes[0].material.onBeforeCompile(shader,{})
  assert.equal(shader.uniforms.terrainBlendPalette.value.image.width,6)
  assert.match(shader.fragmentShader,/terrainNoise/);assert.ok(!shader.fragmentShader.includes('diffuseColor.rgb+='))
  assert.equal(meshes[0].geometry.getAttribute('terrainBlendIndex').count,2)
  manager.dispose();assert.equal(manager.stats().textures,0)
})
