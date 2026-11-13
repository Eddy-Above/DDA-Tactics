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
  props.planeLock=true;assert.deepEqual(editorCell({}),point(-4,7,3),'a hidden placement lock does not affect painting')
  props.activeTool='voxel';assert.deepEqual(editorCell({}),point(1,0,1))
})

test('Space panning preserves the active tool, ignores text inputs, and resets safely on blur',()=>{
  const props={isDm:true,activeTool:'voxel'},spacePanning=ref(false),keysHeld=new Set(),controls={enabled:true,mouseButtons:{}}
  const deps={THREE,props,spacePanning,keysHeld,controls,brushPreview:{cells:new Map(),bounds:null,invalid:false},tokenDrag:{isPressed:()=>false,pointerCancel:()=>{}},panGesture:false,dragStartHit:null,strokePoints:[],rightDragActive:false,editorHint:ref(null),hoverGhostGroup:new THREE.Group(),requestRender:()=>{},swallowNextClick:()=>{},emit:()=>{}}
  const h=loadPageFunctions('components/MapCanvas.vue',['syncEditorCameraControls','cancelEditorGesture','resetEditorInput','onKeyDown','onKeyUp'],deps)
  let prevented=false
  h.onKeyDown({code:'Space',key:' ',preventDefault:()=>{prevented=true}})
  assert.equal(spacePanning.value,true);assert.equal(controls.mouseButtons.LEFT,THREE.MOUSE.PAN);assert.equal(prevented,true)
  h.onKeyUp({code:'Space',key:' '});assert.equal(spacePanning.value,false);assert.equal(props.activeTool,'voxel')
  h.onKeyDown({code:'Space',key:' ',target:{closest:()=>({})}});assert.equal(spacePanning.value,false)
  h.onKeyDown({code:'Space',key:' ',preventDefault:()=>{}});h.resetEditorInput();assert.equal(spacePanning.value,false)
  deps.tokenDrag.isPressed=()=>true;controls.enabled=false
  h.onKeyDown({code:'Space',key:' ',preventDefault:()=>{}});h.onKeyUp({code:'Space',key:' '})
  assert.equal(spacePanning.value,false);assert.equal(controls.enabled,false,'Space does not unlock an active participant drag')
})

test('pointed floor top, side and underside respect elevation and hidden locks do not affect erase or spawn', () => {
  const props={activeTool:'voxel',currentEditY:0,planeLock:false}
  const hit={object:{userData:{type:'ground',tile:point(-4,7,3)},matrixWorld:new THREE.Matrix4()},face:{normal:new THREE.Vector3(0,1,0)}}
  const {editorCell}=loadPageFunctions('components/MapCanvas.vue',['editorCell'],{props,dragStartHit:null,getIntersection:()=>[hit],planeCell:()=>point(1,0,1)})
  assert.deepEqual(editorCell({}),point(-4,7,3))
  hit.face.normal.set(0,-1,0);assert.deepEqual(editorCell({}),point(-4,6,3))
  hit.face.normal.set(-1,0,0);assert.deepEqual(editorCell({}),point(-5,7,3))
  props.planeLock=true
  for (const tool of ['delete','spawn']) {props.activeTool=tool;assert.deepEqual(editorCell({}),point(-4,7,3))}
})

test('brush previews retain every fast bend and incrementally match the committed cells', () => {
  const points=[],brushPreview={cells:new Map(),bounds:null,invalid:false}
  const props={brushSize:5,roundBrush:true}
  const deps={...builder,props,brushPreview,strokePoints:points,vec3Key:builder.cellKey,getHoveredHit:event=>({type:'cell',cell:event.cell})}
  const {recordBrushPoint}=loadPageFunctions('components/MapCanvas.vue',['recordBrushPoint'],deps)
  for(const cell of [point(-20,0,-20),point(20,0,-20),point(20,0,20)])recordBrushPoint({cell})
  const map=shallowRef(makeMap()),editor=useMapEditor(map)
  editor.selectTool('voxel');editor.brushSize.value=5;editor.roundBrush.value=true
  editor.applyBrushStroke(points)
  assert.deepEqual(new Set(map.value.voxels.map(builder.cellKey)),new Set(brushPreview.cells.keys()))
  assert.deepEqual(brushPreview.bounds,builder.fragmentBounds({voxels:map.value.voxels}))
  assert.equal(editor.undo(),true);assert.equal(map.value.voxels.length,0)
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

test('invalid numeric edits and transforms leave map and history untouched', () => {
  const initial=structure(),map=shallowRef(initial),editor=useMapEditor(map)
  editor.setSelection(point(-2,0,-3),point(-1,0,-3))
  for (const offset of [0.5, NaN, Infinity, '']) {
    editor.selectionOffset.value.x=offset
    assert.equal(editor.transformSelection(),false)
    assert.equal(editor.selectionPreview.value.content,null)
    assert.equal(map.value,initial)
  }
  editor.selectionOffset.value=point()
  editor.selectionTurns.value=0.5
  assert.equal(editor.transformSelection(),false)
  editor.roomHeight.value=''
  assert.equal(editor.applyRoom(point(),point(3,0,3)),false)
  editor.brushSize.value=NaN
  assert.equal(editor.applyBrushStroke([point()]),false)
  assert.deepEqual(builder.drawCells(point(),point(1000000),'cube'),[])
  assert.equal(editor.canUndo.value,false)
})

test('move previews match committed geometry across chunks, retain IDs and preserve saved door states', () => {
  const map=shallowRef(structure()),editor=useMapEditor(map)
  editor.setSelection(point(-2,0,-3),point(-1,0,-3))
  assert.equal(editor.transformSelection(),false,'an unchanged selection creates no history')
  editor.selectionOffset.value=point(34,2,-32);editor.selectionTurns.value=3
  const preview=JSON.parse(JSON.stringify(editor.selectionPreview.value.content))
  assert.equal(editor.selectionPreview.value.changed,true)
  assert.equal(editor.selectionPreview.value.moveError,null)
  assert.equal(editor.transformSelection(),true)
  for (const key of ['voxels','walls','windows','doors','ceilings','stairs','groundTiles','spaceTiles']) assert.deepEqual(map.value[key],preview[key])
  assert.equal(map.value.walls[0].id,'wall')
  assert.equal(map.value.doors[0].id,'door')
  assert.equal(JSON.parse(JSON.stringify(map.value)).doors[0].isOpen,true)
  editor.undo();assert.deepEqual(map.value.doors,structure().doors)
  editor.redo();assert.deepEqual(map.value.walls,preview.walls)
  map.value={...structure(),id:'different'}
  assert.equal(editor.selection.value,null)
})

test('damaged stamp libraries are skipped atomically and storage failures preserve the session library', () => {
  const content=builder.fragmentFromSelection(structure(),builder.selectionBox(point(-10,-10,-10),point(10,10,10)))
  const valid={id:'good',name:'Good',content}
  const damaged=JSON.parse(JSON.stringify(valid));damaged.id='bad';damaged.content.voxels[0].x='bad'
  const orphan=JSON.parse(JSON.stringify(valid));orphan.id='orphan';orphan.content.doors[0].wallId='missing'
  const face=JSON.parse(JSON.stringify(valid));face.id='face';face.content.stairs[0].face='up'
  globalThis.localStorage={getItem:()=>JSON.stringify([valid,damaged,orphan,face,valid]),setItem:()=>{throw new Error('Quota')}}
  const map=shallowRef(structure()),editor=useMapEditor(map)
  editor.loadStamps();assert.deepEqual(editor.stamps.value.map(s=>s.id),['good']);assert.match(editor.feedback.value,/damaged/)
  editor.setSelection(point(-2,0,-3),point(-1,0,-3));editor.saveStamp()
  assert.equal(editor.stamps.value.length,2);assert.match(editor.feedback.value,/storage could not save/)
  globalThis.localStorage.getItem=()=>'{'
  editor.loadStamps();assert.equal(editor.stamps.value.length,0);assert.match(editor.feedback.value,/could not be loaded/)
})

test('voxel blend palettes span all axes and chunk boundaries without tinting glass or light sources', () => {
  const scene=new THREE.Scene(),manager=createMapTerrainChunks({scene,tileHeight:.12})
  const voxels=[{...point(15),materialId:'sand'}, {...point(16),materialId:'wood'}, {...point(15,1),materialId:'snow'},
    {...point(-1,0,3),materialId:'water'}, {...point(0,0,3),materialId:'ice'}, {...point(1,0,3),materialId:'glass'},
    {...point(0,1,3),materialId:'flickering-light'}]
  manager.sync(makeMap({voxels}))
  const meshes=[...manager.chunks.values()].flatMap(g=>g.children).filter(o=>o.isInstancedMesh)
  const mixed=meshes.filter(m=>m.geometry.getAttribute('terrainBlendIndex'))
  assert.equal(mixed.length,3)
  const sand=mixed.find(m=>m.parent.userData.floorY===0&&m.parent.userData.terrainChunk==='0,0,0')
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader}
  sand.material.onBeforeCompile(shader,{})
  const data=shader.uniforms.terrainBlendPalette.value.image.data
  assert.equal(data[3],1,'+X crosses the chunk boundary')
  assert.equal(data[11],1,'+Y has a different material')
  const batch=scene.children.find(o=>o.isBatchedMesh)
  batch.material.onBeforeCompile(shader,{})
  const palette=shader.uniforms.terrainBlendPalette.value.image.data
  const matrix=new THREE.Matrix4(),ids=new Map()
  for(let id=0;id<4;id++){batch.getMatrixAt(id,matrix);ids.set(matrix.elements[12]-.5,id)}
  const waterId=ids.get(-1),glassId=ids.get(1)
  // The light occupies x=0 as well; distinguish it by height.
  for(let id=0;id<4;id++){batch.getMatrixAt(id,matrix);if(matrix.elements[12]===.5&&matrix.elements[13]===.5)ids.set('ice',id)}
  const ice=ids.get('ice')
  const water=batch.getColorAt(waterId,new THREE.Vector4())
  assert.ok(Math.abs(water.w-.48)<1e-6)
  assert.match(shader.vertexShader,/getIndirectIndex\(gl_DrawID\)/)
  assert.doesNotMatch(shader.fragmentShader,/diffuseColor\.a\s*=/)
  assert.equal(palette[waterId*24+3],1,'water receives ice colour on +X')
  assert.equal(palette[ice*24+3],0,'ice does not blend into glass')
  assert.equal(palette[glassId*24+7],0,'glass has no blend palette')
  assert.equal(palette[ice*24+11],0,'ice does not blend into light sources')
  manager.dispose();assert.equal(manager.stats().textures,0);assert.equal(scene.children.length,0)
})
