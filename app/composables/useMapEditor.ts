import type { GameMap, MapTool, ElementType, Vec3, MapWall, MapCeiling, MapStair, WallFace, MapGroundTile, MapSpaceTile } from '~/types'

type DrawMode = 'line' | 'square' | 'cube'

type MapSnapshot = Pick<GameMap, 'groundTiles' | 'spaceTiles' | 'walls' | 'windows' | 'doors' | 'ceilings' | 'stairs'>

const MAX_UNDO = 50

export function useMapEditor(currentMap: Ref<GameMap | null>) {
  const activeTool = ref<MapTool>('select')
  const drawMode = ref<DrawMode>('square')
  const elementBrush = ref<ElementType>('void')
  const undoStack = ref<MapSnapshot[]>([])
  const redoStack = ref<MapSnapshot[]>([])
  const currentEditY = ref(0)
  const selectedStructureId = ref<string | null>(null)

  function generateId() {
    return typeof crypto !== 'undefined' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  function takeSnapshot(): MapSnapshot {
    const m = currentMap.value!
    return JSON.parse(JSON.stringify({
      groundTiles: m.groundTiles, spaceTiles: m.spaceTiles,
      walls: m.walls, windows: m.windows, doors: m.doors,
      ceilings: m.ceilings, stairs: m.stairs,
    }))
  }

  function pushUndo() {
    if (!currentMap.value) return
    undoStack.value.push(takeSnapshot())
    if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
    redoStack.value = []
  }

  function applySnapshot(snap: MapSnapshot) {
    const m = currentMap.value!
    m.groundTiles = snap.groundTiles
    m.spaceTiles = snap.spaceTiles
    m.walls = snap.walls
    m.windows = snap.windows
    m.doors = snap.doors
    m.ceilings = snap.ceilings
    m.stairs = snap.stairs
  }

  function cellsForDraw(start: Vec3, end: Vec3, mode: DrawMode): Vec3[] {
    const cells: Vec3[] = []
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    const minZ = Math.min(start.z, end.z)
    const maxZ = Math.max(start.z, end.z)

    if (mode === 'line') {
      const dx = Math.abs(end.x - start.x)
      const dz = Math.abs(end.z - start.z)
      if (dx >= dz) {
        for (let x = minX; x <= maxX; x++) cells.push({ x, y: start.y, z: start.z })
      } else {
        for (let z = minZ; z <= maxZ; z++) cells.push({ x: start.x, y: start.y, z })
      }
    } else if (mode === 'square') {
      for (let x = minX; x <= maxX; x++)
        for (let z = minZ; z <= maxZ; z++)
          cells.push({ x, y: start.y, z })
    } else {
      for (let x = minX; x <= maxX; x++)
        for (let y = minY; y <= maxY; y++)
          for (let z = minZ; z <= maxZ; z++)
            cells.push({ x, y, z })
    }
    return cells
  }

  function applyGroundDraw(start: Vec3, end: Vec3) {
    if (!currentMap.value) return
    pushUndo()
    const cells = cellsForDraw(start, end, drawMode.value)
    const map = currentMap.value
    for (const cell of cells) {
      const exists = map.groundTiles.some(t => t.x === cell.x && t.y === cell.y && t.z === cell.z)
      if (!exists) {
        const tile: MapGroundTile = { x: cell.x, y: cell.y, z: cell.z, element: 'void', terrain: 'normal' }
        map.groundTiles.push(tile)
      }
    }
  }

  function applySpaceDraw(start: Vec3, end: Vec3) {
    if (!currentMap.value) return
    pushUndo()
    const cells = cellsForDraw(start, end, drawMode.value)
    const map = currentMap.value
    for (const cell of cells) {
      const exists = map.spaceTiles.some(t => t.x === cell.x && t.y === cell.y && t.z === cell.z)
      if (!exists) {
        const tile: MapSpaceTile = { x: cell.x, y: cell.y, z: cell.z, spaceType: 'air' }
        map.spaceTiles.push(tile)
      }
    }
  }

  function applyPaintElement(start: Vec3, end: Vec3) {
    if (!currentMap.value) return
    pushUndo()
    const cells = cellsForDraw(start, end, drawMode.value)
    for (const cell of cells) {
      const tile = currentMap.value.groundTiles.find(t => t.x === cell.x && t.y === cell.y && t.z === cell.z)
      if (tile) tile.element = elementBrush.value
    }
  }

  function applyWallDraw(start: Vec3, end: Vec3, face: WallFace, woundBoxes?: number) {
    if (!currentMap.value) return
    pushUndo()
    const cells = cellsForDraw(start, end, drawMode.value)
    const map = currentMap.value
    for (const cell of cells) {
      const exists = map.walls.some(w => w.x === cell.x && w.y === cell.y && w.z === cell.z && w.face === face)
      if (!exists) {
        const wall: MapWall = { id: generateId(), x: cell.x, y: cell.y, z: cell.z, face, woundBoxes }
        map.walls.push(wall)
      }
    }
  }

  function applyWindow(wallId: string, woundBoxes?: number) {
    if (!currentMap.value) return
    pushUndo()
    const map = currentMap.value
    const wall = map.walls.find(w => w.id === wallId)
    if (!wall) return
    const already = map.windows.some(w => w.wallId === wallId)
    if (already) return
    map.windows.push({ id: generateId(), wallId, woundBoxes })
  }

  function applyDoor(wallId: string) {
    if (!currentMap.value) return
    pushUndo()
    const already = currentMap.value.doors.some(d => d.wallId === wallId)
    if (already) return
    currentMap.value.doors.push({ id: generateId(), wallId, isOpen: false })
  }

  function applyCeilingDraw(start: Vec3, end: Vec3, woundBoxes?: number) {
    if (!currentMap.value) return
    pushUndo()
    const cells = cellsForDraw(start, end, drawMode.value)
    const map = currentMap.value
    for (const cell of cells) {
      const exists = map.ceilings.some(c => c.x === cell.x && c.y === cell.y && c.z === cell.z)
      if (!exists) {
        const ceiling: MapCeiling = { id: generateId(), x: cell.x, y: cell.y, z: cell.z, woundBoxes }
        map.ceilings.push(ceiling)
      }
    }
  }

  function applyStair(cell: Vec3, face: WallFace) {
    if (!currentMap.value) return
    pushUndo()
    const map = currentMap.value
    const exists = map.stairs.some(s => s.x === cell.x && s.y === cell.y && s.z === cell.z)
    if (exists) return
    const stair: MapStair = { id: generateId(), x: cell.x, y: cell.y, z: cell.z, face }
    map.stairs.push(stair)
  }

  function applySpawnToggle(start: Vec3, end: Vec3) {
    if (!currentMap.value) return
    pushUndo()
    const cells = cellsForDraw(start, end, drawMode.value)
    for (const cell of cells) {
      const tile = currentMap.value.groundTiles.find(
        t => t.x === cell.x && t.y === cell.y && t.z === cell.z
      )
      if (tile) tile.isSpawnPoint = !tile.isSpawnPoint
    }
  }

  function deleteAt(start: Vec3, end: Vec3) {
    if (!currentMap.value) return
    pushUndo()
    const cells = cellsForDraw(start, end, drawMode.value)
    const map = currentMap.value
    for (const cell of cells) {
      map.groundTiles = map.groundTiles.filter(t => !(t.x === cell.x && t.y === cell.y && t.z === cell.z))
      map.spaceTiles  = map.spaceTiles.filter( t => !(t.x === cell.x && t.y === cell.y && t.z === cell.z))
      map.ceilings    = map.ceilings.filter(   c => !(c.x === cell.x && c.y === cell.y && c.z === cell.z))
    }
  }

  function deleteWallAt(tile: Vec3, face: WallFace) {
    if (!currentMap.value) return
    pushUndo()
    const map = currentMap.value
    map.stairs = map.stairs.filter(s => !(s.x === tile.x && s.y === tile.y && s.z === tile.z))
    const wall = map.walls.find(w => w.x === tile.x && w.y === tile.y && w.z === tile.z && w.face === face)
    if (wall) {
      map.windows = map.windows.filter(w => w.wallId !== wall.id)
      map.doors = map.doors.filter(d => d.wallId !== wall.id)
      map.walls = map.walls.filter(w => w.id !== wall.id)
    }
  }

  function deleteWallFillAt(tile: Vec3, face: WallFace) {
    if (!currentMap.value) return
    pushUndo()
    const map = currentMap.value
    const wall = map.walls.find(w => w.x === tile.x && w.y === tile.y && w.z === tile.z && w.face === face)
    if (!wall) return
    map.windows = map.windows.filter(w => w.wallId !== wall.id)
    map.doors = map.doors.filter(d => d.wallId !== wall.id)
  }

  function undo() {
    if (!currentMap.value || undoStack.value.length === 0) return
    redoStack.value.push(takeSnapshot())
    applySnapshot(undoStack.value.pop()!)
  }

  function redo() {
    if (!currentMap.value || redoStack.value.length === 0) return
    undoStack.value.push(takeSnapshot())
    applySnapshot(redoStack.value.pop()!)
  }

  function selectTool(tool: MapTool) {
    activeTool.value = tool
    selectedStructureId.value = null
  }

  return {
    activeTool, drawMode, elementBrush, currentEditY, selectedStructureId,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    selectTool, undo, redo,
    applyGroundDraw, applySpaceDraw, applyPaintElement, applySpawnToggle,
    applyWallDraw, applyWindow, applyDoor, applyCeilingDraw, applyStair,
    deleteAt, deleteWallAt, deleteWallFillAt,
  }
}
