import { computed, ref, toRaw, type Ref } from 'vue'
import type { GameMap, MapTool, ElementType, Vec3, WallFace } from '~/types'
import { getMapGeometryRevision, recordMapEdit, type MapGeometryCollection } from '~/utils/mapEdits'

type DrawMode = 'line' | 'square' | 'cube'
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
  const elementBrush = ref<ElementType>('void')
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
    const cells: Vec3[] = []
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)
    const minZ = Math.min(start.z, end.z), maxZ = Math.max(start.z, end.z)
    if (drawMode.value === 'line') {
      if (Math.abs(end.x - start.x) >= Math.abs(end.z - start.z)) {
        for (let x = minX; x <= maxX; x++) cells.push({ x, y: start.y, z: start.z })
      } else {
        for (let z = minZ; z <= maxZ; z++) cells.push({ x: start.x, y: start.y, z })
      }
    } else {
      for (let x = minX; x <= maxX; x++)
        for (let y = drawMode.value === 'cube' ? minY : start.y; y <= (drawMode.value === 'cube' ? maxY : start.y); y++)
          for (let z = minZ; z <= maxZ; z++) cells.push({ x, y, z })
    }
    return cells
  }

  function applyGroundDraw(start: Vec3, end: Vec3) {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) if (t.find('groundTiles', cellKey(cell), 'cell') === undefined)
        t.put('groundTiles', { ...cell, element: 'void', terrain: 'normal' })
    })
  }

  function applySpaceDraw(start: Vec3, end: Vec3) {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) if (t.find('spaceTiles', cellKey(cell), 'cell') === undefined)
        t.put('spaceTiles', { ...cell, spaceType: 'air' })
    })
  }

  function applyPaintElement(start: Vec3, end: Vec3) {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) {
        const ground = t.find('groundTiles', cellKey(cell), 'cell')
        if (ground !== undefined) t.put('groundTiles', { ...t.read('groundTiles', ground), element: elementBrush.value }, ground)
        const voxel = t.find('voxels', cellKey(cell), 'cell')
        if (voxel !== undefined) t.put('voxels', { ...t.read('voxels', voxel), materialId: elementBrush.value, element: elementBrush.value, color: undefined }, voxel)
      }
    })
  }

  function applyVoxelDraw(start: Vec3, end: Vec3, shape: 'block' | 'ramp' = 'block') {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) {
        const at = t.find('voxels', cellKey(cell), 'cell')
        const previous = at === undefined ? undefined : t.read('voxels', at)
        t.put('voxels', { ...previous, ...cell,
          shape: shape === 'block' && previous && !previous.shape ? undefined : shape,
          rampDirection: shape === 'ramp' ? rampDirection.value : undefined,
          materialId: elementBrush.value, element: elementBrush.value, color: undefined,
        }, at)
      }
    })
  }

  function applyWallDraw(start: Vec3, end: Vec3, face: WallFace, woundBoxes?: number) {
    return edit(t => {
      for (const cell of cellsForDraw(start, end)) if (t.find('walls', `${cellKey(cell)}:${face}`, 'face') === undefined)
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
    selectedStructureId.value = null
  }

  function rotateRampDirection(step: -1 | 1) {
    const directions: WallFace[] = ['north', 'east', 'south', 'west']
    rampDirection.value = directions[(directions.indexOf(rampDirection.value) + step + directions.length) % directions.length]!
  }

  return {
    activeTool, drawMode, elementBrush, rampDirection, currentEditY, selectedStructureId,
    canUndo: computed(() => { historyVersion.value; return historyMatches() && undoStack.length > 0 }),
    canRedo: computed(() => { historyVersion.value; return historyMatches() && redoStack.length > 0 }),
    selectTool, rotateRampDirection, undo, redo,
    applyGroundDraw, applySpaceDraw, applyPaintElement, applyVoxelDraw, applySpawnToggle,
    applyWallDraw, applyWindow, applyDoor, applyVoxelWindow, applyCeilingDraw, applyStair, applyStairDraw,
    deleteAt, deleteWallAt, deleteWallFillAt, setDoorsOpen, updateStructure,
  }
}
