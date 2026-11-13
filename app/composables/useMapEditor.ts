import { computed, ref, toRaw, type Ref } from 'vue'
import type { GameMap, MapTool, Vec3, WallFace } from '~/types'
import { getMapGeometryRevision, recordMapEdit, type MapGeometryCollection } from '~/utils/mapEdits'
import { getVoxelMaterialElement } from '~/utils/mapVoxels'

import { drawCells, selectionBox, fragmentFromSelection, fragmentBounds, transformFragment, fragmentCollision, type DrawMode, type SelectionBox, type MapFragment, type MapStamp } from '~/utils/mapBuilder'
import { MAP_GEOMETRY_COLLECTIONS } from '~/utils/mapEdits'
type GeometryEntry = GameMap[MapGeometryCollection][number]
type EntryPatch = {
  collection: MapGeometryCollection
  beforeIndex?: number
  afterIndex?: number
  before?: GeometryEntry
  after?: GeometryEntry
}
type EditCommand = { patches: EntryPatch[]; collections: MapGeometryCollection[]; cells: Vec3[] }
type CollectionDraft = { source: GeometryEntry[]; entries: (GeometryEntry | null)[]; changed: Set<number> }
type IndexKind = 'key' | 'cell' | 'face' | 'wall'
const MAX_UNDO = 50
const cellKey = ({ x, y, z }: Vec3) => `${x},${y},${z}`
const copyEntry = (entry: GeometryEntry): GeometryEntry => JSON.parse(JSON.stringify(toRaw(entry)))
const sameEntry = (a: GeometryEntry, b: GeometryEntry) => JSON.stringify(a) === JSON.stringify(b)

function lookupKey(entry: GeometryEntry, by: IndexKind): string | undefined {
  if (by === 'cell') return 'x' in entry ? cellKey(entry) : undefined
  if (by === 'face') return 'face' in entry && 'x' in entry ? `${cellKey(entry)}:${entry.face}` : undefined
  if (by === 'wall') return 'wallId' in entry ? entry.wallId : undefined
  return 'id' in entry ? entry.id : cellKey(entry)
}

/** Build ordinary arrays and a row delta before publishing one reactive map root. */
function beginEdit(sourceMap: GameMap) {
  const source = toRaw(sourceMap)
  const drafts = new Map<MapGeometryCollection, CollectionDraft>()
  const indexes = new Map<string, { by: IndexKind; index: Map<string, number> }>()

  function draft(collection: MapGeometryCollection): CollectionDraft {
    let value = drafts.get(collection)
    if (!value) {
      const entries = toRaw(source[collection] ?? []) as GeometryEntry[]
      value = { source: entries, entries: entries.slice(), changed: new Set() }
      drafts.set(collection, value)
    }
    return value
  }

  function find(collection: MapGeometryCollection, key: string, by: IndexKind = 'key'): number | undefined {
    const cacheKey = `${collection}:${by}`
    let cached = indexes.get(cacheKey)
    if (!cached) {
      const index = new Map<string, number>()
      draft(collection).entries.forEach((entry, i) => {
        if (!entry) return
        const value = lookupKey(entry, by)
        if (value !== undefined && !index.has(value)) index.set(value, i)
      })
      cached = { by, index }
      indexes.set(cacheKey, cached)
    }
    return cached.index.get(key)
  }

  function read<C extends MapGeometryCollection>(collection: C, index: number): GameMap[C][number] {
    return draft(collection).entries[index] as GameMap[C][number]
  }

  function put<C extends MapGeometryCollection>(collection: C, entry: GameMap[C][number], index?: number) {
    const value = draft(collection)
    const at = index ?? value.entries.length
    const previous = value.entries[at]
    if (previous && sameEntry(previous, entry)) return
    value.entries[at] = entry
    value.changed.add(at)
    // Maintain indexes in constant time; rebuilding them for every new cell would be quadratic.
    for (const [cacheKey, cached] of indexes) {
      if (!cacheKey.startsWith(`${collection}:`)) continue
      const oldKey = previous ? lookupKey(previous, cached.by) : undefined
      const newKey = lookupKey(entry, cached.by)
      if (oldKey !== newKey && oldKey !== undefined && cached.index.get(oldKey) === at) cached.index.delete(oldKey)
      if (newKey !== undefined && (!cached.index.has(newKey) || cached.index.get(newKey) === at)) cached.index.set(newKey, at)
    }
  }

  function remove(collection: MapGeometryCollection, predicate: (entry: GeometryEntry) => boolean) {
    const value = draft(collection)
    value.entries.forEach((entry, index) => {
      if (entry && predicate(entry)) {
        value.entries[index] = null
        value.changed.add(index)
      }
    })
    for (const cacheKey of indexes.keys()) if (cacheKey.startsWith(`${collection}:`)) indexes.delete(cacheKey)
  }

  function finish(): { map: GameMap; command: EditCommand } | null {
    const next = { ...source }
    const patches: EntryPatch[] = []
    const cells: Vec3[] = []
    const collections: MapGeometryCollection[] = []
    let wallById: Map<string, GameMap['walls'][number]> | undefined
    const addCell = (entry: GeometryEntry | undefined) => {
      if (!entry) return
      if ('x' in entry) cells.push({ x: entry.x, y: entry.y, z: entry.z })
      else if ('wallId' in entry) {
        wallById ??= new Map(source.walls.map(wall => [wall.id, wall]))
        const wall = wallById.get(entry.wallId)
        if (wall) cells.push({ x: wall.x, y: wall.y, z: wall.z })
      }
    }
    for (const [collection, value] of drafts) {
      if (!value.changed.size) continue
      collections.push(collection)
      const entries: GeometryEntry[] = []
      value.entries.forEach((entry, index) => {
        const afterIndex = entry ? entries.length : undefined
        if (entry) entries.push(entry)
        if (!value.changed.has(index)) return
        const before = value.source[index]
        const patch: EntryPatch = { collection }
        if (before) { patch.beforeIndex = index; patch.before = copyEntry(before) }
        if (entry) { patch.afterIndex = afterIndex; patch.after = copyEntry(entry) }
        patches.push(patch)
        addCell(before)
        addCell(entry ?? undefined)
      })
      ;(next[collection] as GeometryEntry[]) = entries
    }
    if (!patches.length) return null
    return { map: recordMapEdit(source, next, collections, cells), command: { patches, collections, cells } }
  }

  return { source, find, read, put, remove, finish }
}

export function useMapEditor(currentMap: Ref<GameMap | null>) {
  const activeTool = ref<MapTool>('select')
  const drawMode = ref<DrawMode>('square')
  const brushSize = ref(1)
  const roundBrush = ref(false)
  const planeLock = ref(false)
  const selection = ref<SelectionBox | null>(null)
  const selectionAllHeights = ref(true)
  const selectionOffset = ref<Vec3>({x:0,y:0,z:0})
  const selectionTurns = ref(0)
  const roomHeight = ref(3)
  const roomFloor = ref(false)
  const spaceType = ref<'air'|'water'|'earth'>('water')
  const feedback = ref('')
  const stamps = ref<MapStamp[]>([])
  const stampName = ref('')
  const activeStampId = ref('')
  const stampTurns = ref(0)
  const activeStamp = computed(() => stamps.value.find(stamp=>stamp.id===activeStampId.value) ?? null)
  const elementBrush = ref<string>('void')
  const rampDirection = ref<WallFace>('north')
  const currentEditY = ref(0)
  const selectedStructureId = ref<string | null>(null)
  let undoStack: EditCommand[] = []
  let redoStack: EditCommand[] = []
  let historyMapId = currentMap.value?.id
  let publishedRevision = getMapGeometryRevision(currentMap.value)
  const historyVersion = ref(0)
  const generateId = () => typeof crypto !== 'undefined' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const historyMatches = () => currentMap.value?.id === historyMapId && getMapGeometryRevision(currentMap.value) === publishedRevision

  function edit(action: (transaction: ReturnType<typeof beginEdit>) => void): boolean {
    if (!currentMap.value) return false
    if (!historyMatches()) {
      undoStack = []; redoStack = []
      historyMapId = currentMap.value.id
    }
    const transaction = beginEdit(currentMap.value)
    action(transaction)
    const result = transaction.finish()
    if (!result) return false
    undoStack.push(result.command)
    if (undoStack.length > MAX_UNDO) undoStack.shift()
    redoStack = []
    publish(result.map)
    return true
  }

  function publish(map: GameMap) {
    publishedRevision = getMapGeometryRevision(map)
    historyVersion.value++
    currentMap.value = map
  }

  function cellsForDraw(start: Vec3, end: Vec3): Vec3[] {
    return drawCells(start, end, drawMode.value, brushSize.value, roundBrush.value)
  }

  function applyGroundDraw(start: Vec3, end: Vec3) {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) if (t.find('groundTiles', cellKey(cell), 'cell') === undefined)
        t.put('groundTiles', { ...cell, element: getVoxelMaterialElement(elementBrush.value), materialId: elementBrush.value, terrain: 'normal' })
    })
  }

  function applySpaceDraw(start: Vec3, end: Vec3) {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) if (t.find('spaceTiles', cellKey(cell), 'cell') === undefined)
        t.put('spaceTiles', { ...cell, spaceType: spaceType.value })
    })
  }

  function applyPaintElement(start: Vec3, end: Vec3) {
    const element = getVoxelMaterialElement(elementBrush.value)
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) {
        const ground = t.find('groundTiles', cellKey(cell), 'cell')
        if (ground !== undefined) t.put('groundTiles', { ...t.read('groundTiles', ground), element, materialId: elementBrush.value }, ground)
        const voxel = t.find('voxels', cellKey(cell), 'cell')
        if (voxel !== undefined) t.put('voxels', { ...t.read('voxels', voxel), materialId: elementBrush.value, element, color: undefined }, voxel)
      }
    })
  }

  function applyVoxelDraw(start: Vec3, end: Vec3, shape: 'block' | 'ramp' = 'block') {
    const element = getVoxelMaterialElement(elementBrush.value)
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) {
        const at = t.find('voxels', cellKey(cell), 'cell')
        const previous = at === undefined ? undefined : t.read('voxels', at)
        t.put('voxels', { ...previous, ...cell,
          shape: shape === 'block' && previous && !previous.shape ? undefined : shape,
          rampDirection: shape === 'ramp' ? rampDirection.value : undefined,
          materialId: elementBrush.value, element, color: undefined,
        }, at)
      }
    })
  }

  function applyWallDraw(start: Vec3, end: Vec3, face: WallFace, woundBoxes?: number) {
    return edit(t => {
      for (const cell of drawCells(start, end, 'line')) if (t.find('walls', `${cellKey(cell)}:${face}`, 'face') === undefined)
        t.put('walls', { id: generateId(), ...cell, face, woundBoxes })
    })
  }

  function applyWindow(wallId: string, woundBoxes?: number) {
    return edit(t => {
      if (t.find('walls', wallId) !== undefined && t.find('windows', wallId, 'wall') === undefined)
        t.put('windows', { id: generateId(), wallId, woundBoxes })
    })
  }

  function applyDoor(wallId: string) {
    return edit(t => {
      const at = t.find('doors', wallId, 'wall')
      if (at !== undefined) {
        const previous = t.read('doors', at)
        t.put('doors', { ...previous, isOpen: !previous.isOpen }, at)
      } else if (t.find('walls', wallId) !== undefined) t.put('doors', { id: generateId(), wallId, isOpen: false })
    })
  }

  function applyVoxelWindow(cell: Vec3) {
    return edit(t => {
      const at = t.find('voxels', cellKey(cell), 'cell')
      if (at === undefined) return
      const previous = t.read('voxels', at)
      t.put('voxels', { ...previous, feature: previous.feature === 'window' ? undefined : 'window' }, at)
    })
  }

  function applyCeilingDraw(start: Vec3, end: Vec3, woundBoxes?: number) {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) if (t.find('ceilings', cellKey(cell), 'cell') === undefined)
        t.put('ceilings', { id: generateId(), ...cell, woundBoxes })
    })
  }

  function applyStair(cell: Vec3, face: WallFace) {
    return edit(t => {
      if (t.find('stairs', cellKey(cell), 'cell') === undefined) t.put('stairs', { id: generateId(), ...cell, face })
    })
  }

  function applyStairDraw(start: Vec3, end: Vec3) {
    // Keep the saved face encoding: legacy stairs reverse east/west rotation.
    const face: WallFace = rampDirection.value === 'east' ? 'west'
      : rampDirection.value === 'west' ? 'east' : rampDirection.value
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) {
        const at = t.find('stairs', cellKey(cell), 'cell')
        const previous = at === undefined ? { id: generateId(), ...cell } : t.read('stairs', at)
        t.put('stairs', { ...previous, face }, at)
      }
    })
  }

  function applySpawnToggle(start: Vec3, end: Vec3) {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) {
        const voxel = t.find('voxels', cellKey(cell), 'cell')
        if (voxel !== undefined) {
          const previous = t.read('voxels', voxel)
          t.put('voxels', { ...previous, isSpawnPoint: !previous.isSpawnPoint }, voxel)
        } else {
          const ground = t.find('groundTiles', cellKey(cell), 'cell')
          if (ground !== undefined) {
            const previous = t.read('groundTiles', ground)
            t.put('groundTiles', { ...previous, isSpawnPoint: !previous.isSpawnPoint }, ground)
          }
        }
      }
    })
  }

  function deleteAt(start: Vec3, end: Vec3) {
    const cells = new Set(cellsForDraw(start, end).map(cellKey))
    return edit(t => {
      for (const collection of ['groundTiles', 'spaceTiles', 'voxels', 'ceilings', 'stairs'] as const)
        t.remove(collection, entry => 'x' in entry && cells.has(cellKey(entry)))
    })
  }

  function deleteWallAt(tile: Vec3, face: WallFace) {
    return edit(t => {
      t.remove('stairs', entry => 'x' in entry && cellKey(entry) === cellKey(tile))
      const at = t.find('walls', `${cellKey(tile)}:${face}`, 'face')
      if (at === undefined) return
      const wall = t.read('walls', at)
      t.remove('windows', entry => 'wallId' in entry && entry.wallId === wall.id)
      t.remove('doors', entry => 'wallId' in entry && entry.wallId === wall.id)
      t.remove('walls', entry => 'id' in entry && entry.id === wall.id)
    })
  }

  function deleteWallFillAt(tile: Vec3, face: WallFace) {
    return edit(t => {
      const at = t.find('walls', `${cellKey(tile)}:${face}`, 'face')
      if (at === undefined) return
      const wall = t.read('walls', at)
      t.remove('windows', entry => 'wallId' in entry && entry.wallId === wall.id)
      t.remove('doors', entry => 'wallId' in entry && entry.wallId === wall.id)
    })
  }

  function setDoorsOpen(ids: string[], isOpen: boolean) {
    return edit(t => {
      for (const id of new Set(ids)) {
        const at = t.find('doors', id)
        if (at !== undefined) t.put('doors', { ...t.read('doors', at), isOpen }, at)
      }
    })
  }

  function updateStructure(id: string, type: string, woundBoxes: number | null, face?: WallFace) {
    const collections: Record<string, MapGeometryCollection> = { wall: 'walls', window: 'windows', door: 'doors', ceiling: 'ceilings', stairs: 'stairs' }
    const collection = collections[type]
    if (!collection) return false
    return edit(t => {
      const at = t.find(collection, id)
      if (at === undefined) return
      const previous = t.read(collection, at)
      const updated = { ...previous, woundBoxes: woundBoxes ?? undefined, ...('face' in previous && face ? { face } : {}) }
      t.put(collection, updated, at)
    })
  }

  function applyCommand(command: EditCommand, reverse: boolean) {
    const previous = toRaw(currentMap.value!)
    const next = { ...previous }
    for (const collection of command.collections) {
      const patches = command.patches.filter(patch => patch.collection === collection)
      const removed = new Set(patches.map(patch => reverse ? patch.afterIndex : patch.beforeIndex).filter(index => index !== undefined))
      const retained = (toRaw(previous[collection] ?? []) as GeometryEntry[]).filter((_, index) => !removed.has(index))
      const insertions = patches.map(patch => ({ index: reverse ? patch.beforeIndex : patch.afterIndex, entry: reverse ? patch.before : patch.after }))
        .filter((value): value is { index: number; entry: GeometryEntry } => value.index !== undefined && value.entry !== undefined)
        .sort((a, b) => a.index - b.index)
      const entries: GeometryEntry[] = []
      let cursor = 0
      for (const insertion of insertions) {
        while (entries.length < insertion.index && cursor < retained.length) entries.push(retained[cursor++]!)
        entries.push(copyEntry(insertion.entry))
      }
      while (cursor < retained.length) entries.push(retained[cursor++]!)
      ;(next[collection] as GeometryEntry[]) = entries
    }
    publish(recordMapEdit(previous, next, command.collections, command.cells))
  }

  function undo() {
    if (!currentMap.value || !historyMatches()) return false
    const command = undoStack.pop()
    if (!command) return false
    redoStack.push(command)
    applyCommand(command, true)
    return true
  }

  function redo() {
    if (!currentMap.value || !historyMatches()) return false
    const command = redoStack.pop()
    if (!command) return false
    undoStack.push(command)
    applyCommand(command, false)
    return true
  }

  function selectTool(tool: MapTool) {
    activeTool.value = tool
    if(tool==='spawn'&&drawMode.value==='brush')drawMode.value='square'
    selectedStructureId.value = null
  }

  function rotateRampDirection(step: -1 | 1) {
    const directions: WallFace[] = ['north', 'east', 'south', 'west']
    rampDirection.value = directions[(directions.indexOf(rampDirection.value) + step + directions.length) % directions.length]!
  }

  function setSelection(start: Vec3, end: Vec3) {
    const box = selectionBox(start,end)
    if(selectionAllHeights.value && currentMap.value) {
      const bounds=fragmentBounds(currentMap.value)
      if(bounds){box.min.y=bounds.min.y;box.max.y=bounds.max.y}
    }
    selection.value=box
    selectionOffset.value={x:0,y:0,z:0};selectionTurns.value=0;feedback.value=''
  }
  function selectedContent() { return currentMap.value&&selection.value ? fragmentFromSelection(currentMap.value,selection.value) : null }
  function removeFragment(t:ReturnType<typeof beginEdit>, fragment:MapFragment) {
    for(const collection of MAP_GEOMETRY_COLLECTIONS) {
      const keys=new Set(fragment[collection].map(entry=>'id' in entry?entry.id:cellKey(entry)))
      t.remove(collection,entry=>keys.has('id' in entry?entry.id:cellKey(entry)))
    }
  }
  function putFragment(t:ReturnType<typeof beginEdit>, fragment:MapFragment) {
    for(const collection of MAP_GEOMETRY_COLLECTIONS) for(const entry of fragment[collection]) t.put(collection,entry as never)
  }
  function deleteSelection() {
    const content=selectedContent();if(!content)return false
    const changed=edit(t=>removeFragment(t,content));if(changed)selection.value=null
    return changed
  }
  function transformSelection(duplicate=false) {
    const content=selectedContent(),bounds=content&&fragmentBounds(content)
    if(!content||!bounds||!currentMap.value){feedback.value='Select some map content first.';return false}
    const target={x:bounds.min.x+selectionOffset.value.x,y:bounds.min.y+selectionOffset.value.y,z:bounds.min.z+selectionOffset.value.z}
    const transformed=transformFragment(content,target,selectionTurns.value,generateId)
    const collision=fragmentCollision(currentMap.value,transformed,duplicate?undefined:content)
    if(collision){feedback.value=collision;return false}
    const changed=edit(t=>{if(!duplicate)removeFragment(t,content);putFragment(t,transformed)})
    if(changed){selection.value=fragmentBounds(transformed);selectionOffset.value={x:0,y:0,z:0};selectionTurns.value=0;feedback.value=''}
    return changed
  }
  function loadStamps() {
    if(typeof localStorage==='undefined')return
    try {
      const saved=JSON.parse(localStorage.getItem('dda-map-stamps-v1')??'[]')
      if(Array.isArray(saved)) stamps.value=saved.filter(stamp=>typeof stamp?.id==='string'&&typeof stamp?.name==='string'&&MAP_GEOMETRY_COLLECTIONS.every(key=>Array.isArray(stamp.content?.[key])))
    } catch { feedback.value='Saved stamps could not be loaded.' }
  }
  function persistStamps() {
    try { localStorage.setItem('dda-map-stamps-v1',JSON.stringify(stamps.value)) }
    catch { feedback.value='Your stamp is available this session, but browser storage could not save the stamp library.' }
  }
  function saveStamp() {
    const content=selectedContent()
    if(!content||!fragmentBounds(content)){feedback.value='Select some map content to save as a stamp.';return}
    const stamp={id:generateId(),name:stampName.value.trim()||'Untitled stamp',content}
    stamps.value.push(stamp);activeStampId.value=stamp.id;stampName.value='';feedback.value='Stamp saved in this browser.';persistStamps()
  }
  function deleteStamp() {
    stamps.value=stamps.value.filter(stamp=>stamp.id!==activeStampId.value)
    activeStampId.value='';persistStamps()
  }
  function placeStamp(cell:Vec3) {
    if(!currentMap.value||!activeStamp.value){feedback.value='Choose a saved stamp first.';return false}
    const content=transformFragment(activeStamp.value.content,cell,stampTurns.value,generateId)
    const collision=fragmentCollision(currentMap.value,content)
    if(collision){feedback.value=collision;return false}
    feedback.value='';return edit(t=>putFragment(t,content))
  }
  function pickMaterial(material:string) {
    elementBrush.value=material
    activeTool.value='paint-element'
    feedback.value='Picked '+material+'. Choose Floor or Block to build with this material.'
  }
  function applyRoom(start:Vec3,end:Vec3) {
    const box=selectionBox(start,end),height=Math.max(1,Math.min(64,Math.round(roomHeight.value)))
    return edit(t=>{
      for(let y=box.min.y;y<box.min.y+height;y++) {
        const wall=(x:number,z:number,face:WallFace)=>{
          const cell={x,y,z}
          if(t.find('walls',cellKey(cell)+':'+face,'face')===undefined)t.put('walls',{id:generateId(),...cell,face})
        }
        for(let x=box.min.x;x<=box.max.x;x++){wall(x,box.min.z,'north');wall(x,box.max.z,'south')}
        for(let z=box.min.z;z<=box.max.z;z++){wall(box.min.x,z,'west');wall(box.max.x,z,'east')}
      }
      if(roomFloor.value)for(const cell of drawCells({...box.min,y:start.y},{...box.max,y:start.y},'square')) {
        if(t.find('groundTiles',cellKey(cell),'cell')===undefined)t.put('groundTiles',{...cell,terrain:'normal',element:getVoxelMaterialElement(elementBrush.value),materialId:elementBrush.value})
      }
    })
  }
  function applyBrushStroke(points:Vec3[]) {
    const cells=new Map<string,Vec3>()
    for(let i=0;i<points.length;i++)for(const cell of drawCells(points[Math.max(0,i-1)]!,points[i]!,'brush',brushSize.value,roundBrush.value))cells.set(cellKey(cell),cell)
    const element=getVoxelMaterialElement(elementBrush.value),tool=activeTool.value
    return edit(t=>{
      if(tool==='delete') {
        for(const key of ['groundTiles','spaceTiles','voxels','ceilings','stairs'] as const)t.remove(key,entry=>'x' in entry&&cells.has(cellKey(entry)))
        return
      }
      for(const cell of cells.values()) {
        const key=cellKey(cell)
        if(tool==='add-ground') { if(t.find('groundTiles',key,'cell')===undefined)t.put('groundTiles',{...cell,element,materialId:elementBrush.value,terrain:'normal'}) }
        else if(tool==='add-space'){if(t.find('spaceTiles',key,'cell')===undefined)t.put('spaceTiles',{...cell,spaceType:spaceType.value})}
        else if(tool==='paint-element') {
          const ground=t.find('groundTiles',key,'cell'),voxel=t.find('voxels',key,'cell')
          if(ground!==undefined)t.put('groundTiles',{...t.read('groundTiles',ground),element,materialId:elementBrush.value},ground)
          if(voxel!==undefined)t.put('voxels',{...t.read('voxels',voxel),element,materialId:elementBrush.value,color:undefined},voxel)
        } else if(tool==='voxel'||tool==='ramp') {
          const at=t.find('voxels',key,'cell'),previous=at===undefined?{}:t.read('voxels',at)
          t.put('voxels',{...previous,...cell,materialId:elementBrush.value,element,shape:tool==='ramp'?'ramp':'block',rampDirection:tool==='ramp'?rampDirection.value:undefined},at)
        } else if(tool==='stairs') {
          const at=t.find('stairs',key,'cell')
          t.put('stairs',{id:at===undefined?generateId():t.read('stairs',at).id,...cell,face:rampDirection.value==='east'?'west':rampDirection.value==='west'?'east':rampDirection.value},at)
        } else if(tool==='ceiling'&&t.find('ceilings',key,'cell')===undefined)t.put('ceilings',{id:generateId(),...cell})
      }
    })
  }


  return {
    brushSize, roundBrush, planeLock, selection, selectionAllHeights, selectionOffset, selectionTurns, roomHeight, roomFloor, spaceType, feedback, stamps, stampName, activeStampId, activeStamp, stampTurns,
    setSelection, selectedContent, deleteSelection, transformSelection, loadStamps, saveStamp, deleteStamp, placeStamp, pickMaterial, applyRoom, applyBrushStroke,
    activeTool, drawMode, elementBrush, rampDirection, currentEditY, selectedStructureId,
    canUndo: computed(() => { historyVersion.value; return historyMatches() && undoStack.length > 0 }),
    canRedo: computed(() => { historyVersion.value; return historyMatches() && redoStack.length > 0 }),
    selectTool, rotateRampDirection, undo, redo,
    applyGroundDraw, applySpaceDraw, applyPaintElement, applyVoxelDraw, applySpawnToggle,
    applyWallDraw, applyWindow, applyDoor, applyVoxelWindow, applyCeilingDraw, applyStair, applyStairDraw,
    deleteAt, deleteWallAt, deleteWallFillAt, setDoorsOpen, updateStructure,
  }
}