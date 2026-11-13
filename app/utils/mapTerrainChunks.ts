import * as THREE from 'three'
import { attachTerrainMaterialBlend, attachBatchedTerrainMaterialBlend, type TerrainNeighbours } from './terrainMaterialBlend'
import { toRaw } from 'vue'
import type { GameMap, MapGroundTile, MapSpaceTile, MapVoxel, Vec3 } from '~/types'
import { ELEMENT_COLORS } from '~/types'
import { getMapEditChange, getMapGeometryRevision } from '~/utils/mapEdits'
import { getVoxelColor, getVoxelLightSource, getVoxelMaterialDefinition, getVoxelMaterialId, getVoxelOpacity } from '~/utils/mapVoxels'
import { createMapVoxelLights } from '~/utils/mapVoxelLights'
import { createVoxelGeometry, rampRotationY } from '~/utils/voxelGeometry'

export const MAP_TERRAIN_CHUNK_SIZE = 16

export function terrainChunkKey(cell: Vec3): string {
  return `${Math.floor(cell.x / MAP_TERRAIN_CHUNK_SIZE)},${cell.y},${Math.floor(cell.z / MAP_TERRAIN_CHUNK_SIZE)}`
}

const key = (cell: Vec3) => `${cell.x},${cell.y},${cell.z}`
const noRaycast = () => { }
const FACE_OFFSETS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const TERRAIN_COLLECTIONS = ['groundTiles', 'spaceTiles', 'voxels'] as const

type TerrainCollection = typeof TERRAIN_COLLECTIONS[number]
type TerrainCell = MapGroundTile | MapSpaceTile | MapVoxel
type Resource<T> = { value: T; references: number }
type Instance = { position: THREE.Vector3; color?: number; neighbours?: Array<number | undefined>; quaternion?: THREE.Quaternion; scale?: THREE.Vector3; lightVoxel?: MapVoxel }
type InstanceBucket = { geometryKey: string; materialKey: string; geometry: () => THREE.BufferGeometry; material: () => THREE.Material; instances: Instance[]; castShadow: boolean; spawn: boolean }
type ChunkData = { groundTiles: Map<string, MapGroundTile>; spaceTiles: Map<string, MapSpaceTile>; voxels: Map<string, MapVoxel> }
type ChunkState = { group: THREE.Group; data: ChunkData; releases: Array<() => void>; transparentKeys: string[]; opaqueSourceKeys: string[]; hasTransparent: boolean; bounds: THREE.Box3 }

export interface MapTerrainOptions {
  scene: THREE.Scene | THREE.Group
  tileHeight: number
}

export interface MapTerrainView {
  clipY: number
  showSpawnIndicators?: boolean
}

/**
 * Chunked ground/space/voxel rendering, with exact cell picking independent of
 * draw batching. Static geometry/materials are shared and explicitly leased.
 */
export function createMapTerrainChunks(options: MapTerrainOptions) {
  const { scene, tileHeight: TILE_H } = options
  const chunks = new Map<string, THREE.Group>()
  const states = new Map<string, ChunkState>()
  const indices = {
    groundTiles: new Map<string, MapGroundTile>(),
    spaceTiles: new Map<string, MapSpaceTile>(),
    voxels: new Map<string, MapVoxel>(),
  }
  const geometries = new Map<string, Resource<THREE.BufferGeometry>>()
  const materials = new Map<string, Resource<THREE.Material>>()
  const blendTextures = new Set<THREE.Texture>()
  const transparentInstances = new Map<string, { id: number; voxel: MapVoxel; geometryKey: string }>()
  const transparentGeometryIds = new Map<string, number>()
  const proxyGeometryCache = new Map<string, THREE.BufferGeometry>()
  const edgePositions = new Map<string, number[]>()
  const pickMaterial = new THREE.MeshBasicMaterial()
  const pickProxy = new THREE.Mesh(new THREE.BufferGeometry(), pickMaterial)
  pickProxy.geometry.dispose()
  let transparentMesh: THREE.BatchedMesh | null = null
  let transparentMaterial: THREE.MeshLambertMaterial | null = null
  let transparentBlend: ReturnType<typeof attachBatchedTerrainMaterialBlend> | null = null
  let mapId: string | null = null
  let revision = 0
  let clipY = 20
  let showSpawns = true
  let builtChunks = 0
  let disposedGeometries = 0
  let disposedMaterials = 0
  let lastRebuiltChunkKeys: string[] = []
  const opaqueSourceInstances = new Map<string, { mesh: THREE.InstancedMesh; index: number }>()
  const transparentTint = new THREE.Vector4()
  const voxelLights = createMapVoxelLights(scene, (voxel, color) => {
    const cellKey = key(voxel)
    const transparent = transparentInstances.get(cellKey)
    if (transparent && transparentMesh) {
      transparentTint.set(color.r, color.g, color.b, getVoxelOpacity(voxel))
      transparentMesh.setColorAt(transparent.id, transparentTint)
    }
    const opaque = opaqueSourceInstances.get(cellKey)
    if (opaque) {
      opaque.mesh.setColorAt(opaque.index, color)
      opaque.mesh.instanceColor!.needsUpdate = true
    }
  })
  voxelLights.setClipY(clipY)

  function lease<T>(cache: Map<string, Resource<T>>, resourceKey: string, create: () => T, release: (value: T) => void, state: ChunkState): T {
    let resource = cache.get(resourceKey)
    if (!resource) {
      resource = { value: create(), references: 0 }
      cache.set(resourceKey, resource)
    }
    resource.references++
    state.releases.push(() => {
      if (--resource!.references === 0) {
        cache.delete(resourceKey)
        release(resource!.value)
      }
    })
    return resource.value
  }

  function freeGeometry(geometry: THREE.BufferGeometry) { geometry.dispose(); disposedGeometries++ }
  function freeMaterial(material: THREE.Material) { material.dispose(); disposedMaterials++ }

  function blankData(): ChunkData {
    return { groundTiles: new Map(), spaceTiles: new Map(), voxels: new Map() }
  }

  function ensureState(cell: Vec3): ChunkState {
    const chunkKey = terrainChunkKey(cell)
    let state = states.get(chunkKey)
    if (!state) {
      const group = new THREE.Group()
      group.userData = { floorY: cell.y, terrainChunk: chunkKey }
      state = {
        group, data: blankData(), releases: [], transparentKeys: [], opaqueSourceKeys: [], hasTransparent: false,
        bounds: new THREE.Box3(new THREE.Vector3(Math.floor(cell.x / 16) * 16, cell.y, Math.floor(cell.z / 16) * 16),
          new THREE.Vector3(Math.floor(cell.x / 16) * 16 + 16, cell.y + 1, Math.floor(cell.z / 16) * 16 + 16))
      }
      states.set(chunkKey, state)
      chunks.set(chunkKey, group)
      scene.add(group)
    }
    return state
  }

  function visibleTransparentCube(voxel: MapVoxel | undefined): voxel is MapVoxel {
    return !!voxel && voxel.shape !== 'ramp' && getVoxelOpacity(voxel) < 1 && voxel.y <= clipY
  }

  function volumeGroup(voxel: MapVoxel): string {
    const materialId = getVoxelMaterialId(voxel)
    return JSON.stringify([materialId, voxel.element ?? materialId])
  }

  function faceMask(voxel: MapVoxel): number {
    if (!visibleTransparentCube(voxel)) return 63
    const group = volumeGroup(voxel)
    let mask = 0
    FACE_OFFSETS.forEach(([dx, dy, dz], face) => {
      const neighbor = indices.voxels.get(`${voxel.x + dx},${voxel.y + dy},${voxel.z + dz}`)
      if (!visibleTransparentCube(neighbor) || volumeGroup(neighbor) !== group) mask |= 1 << face
    })
    return mask
  }

  function voxelGeometryKey(voxel: MapVoxel): string {
    return voxel.shape === 'ramp' ? `ramp:${voxel.rampDirection ?? 'north'}` : `cube:${faceMask(voxel)}`
  }

  function makeVoxelGeometry(geometryKey: string): THREE.BufferGeometry {
    if (geometryKey.startsWith('ramp:')) return createVoxelGeometry({ shape: 'ramp', rampDirection: geometryKey.slice(5) as MapVoxel['rampDirection'] })
    const mask = Number(geometryKey.slice(5))
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    if (mask !== 63) {
      const original = geometry.getIndex()!
      const selected: number[] = []
      for (let face = 0; face < 6; face++) if (mask & (1 << face)) {
        for (let i = 0; i < 6; i++) selected.push(original.getX(face * 6 + i))
      }
      geometry.setIndex(selected)
      geometry.clearGroups()
    }
    return geometry
  }

  function proxyGeometry(geometryKey: string): THREE.BufferGeometry {
    let geometry = proxyGeometryCache.get(geometryKey)
    if (!geometry) {
      geometry = geometryKey === 'ground' ? new THREE.BoxGeometry(1, TILE_H, 1)
        : geometryKey === 'space' ? new THREE.BoxGeometry(1, 1, 1) : makeVoxelGeometry(geometryKey)
      proxyGeometryCache.set(geometryKey, geometry)
    }
    return geometry
  }

  function ensureTransparentMesh(): THREE.BatchedMesh {
    if (!transparentMesh) {
      transparentMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false })
      // All translucent cells share one batch: Vector4 colors carry per-cell alpha,
      // so sorting remains global across material and chunk boundaries.
      transparentMesh = new THREE.BatchedMesh(256, 4096, 0, transparentMaterial)
      transparentMesh.castShadow = true
      transparentMesh.receiveShadow = true
      transparentMesh.frustumCulled = false
      transparentMesh.sortObjects = true
      transparentMesh.perObjectFrustumCulled = true
      transparentMesh.userData = { terrainTransparentBatch: true }
      transparentMesh.raycast = noRaycast
      transparentBlend = attachBatchedTerrainMaterialBlend(transparentMesh)
      scene.add(transparentMesh)
    }
    return transparentMesh
  }

  function addTransparent(voxel: MapVoxel, state: ChunkState) {
    const geometryKey = voxelGeometryKey(voxel)
    if (geometryKey === 'cube:0') return
    const mesh = ensureTransparentMesh()
    if (transparentInstances.size + 1 > mesh.maxInstanceCount) mesh.setInstanceCount(mesh.maxInstanceCount * 2)
    let geometryId = transparentGeometryIds.get(geometryKey)
    if (geometryId === undefined) {
      const original = proxyGeometry(geometryKey)
      const geometry = original.getIndex() ? original.toNonIndexed() : original.clone()
      geometry.deleteAttribute('uv')
      geometryId = mesh.addGeometry(geometry)
      geometry.dispose()
      transparentGeometryIds.set(geometryKey, geometryId)
    }
    const id = mesh.addInstance(geometryId)
    mesh.setMatrixAt(id, new THREE.Matrix4().makeTranslation(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5))
    const color = new THREE.Color(getVoxelColor(voxel))
    mesh.setColorAt(id, new THREE.Vector4(color.r, color.g, color.b, getVoxelOpacity(voxel)))
    mesh.setVisibleAt(id, voxel.y <= clipY)
    transparentInstances.set(key(voxel), { id, voxel, geometryKey })
    state.transparentKeys.push(key(voxel))
  }

  function clearChunk(state: ChunkState) {
    voxelLights.removeChunk(state.group.userData.terrainChunk)
    for (const cellKey of state.opaqueSourceKeys) opaqueSourceInstances.delete(cellKey)
    state.opaqueSourceKeys = []
    for (const cellKey of state.transparentKeys) {
      const entry = transparentInstances.get(cellKey)
      if (entry && transparentMesh) transparentMesh.deleteInstance(entry.id)
      transparentInstances.delete(cellKey)
    }
    state.transparentKeys = []
    for (const child of [...state.group.children]) {
      state.group.remove(child)
      if (child instanceof THREE.InstancedMesh) child.dispose()
      if (child instanceof THREE.LineSegments) freeGeometry(child.geometry)
    }
    for (const release of state.releases) release()
    state.releases = []
    state.hasTransparent = false
  }

  function baseEdgePositions(geometryKey: string, geometry: () => THREE.BufferGeometry): number[] {
    let positions = edgePositions.get(geometryKey)
    if (!positions) {
      const source = geometry()
      const edges = new THREE.EdgesGeometry(source)
      positions = Array.from(edges.getAttribute('position').array)
      source.dispose(); edges.dispose()
      edgePositions.set(geometryKey, positions)
    }
    return positions
  }

  function addTranslatedEdges(positions: number[], base: number[], x: number, y: number, z: number) {
    for (let i = 0; i < base.length; i += 3) positions.push(base[i] + x, base[i + 1] + y, base[i + 2] + z)
  }

  function canBlendVoxel(voxel: MapVoxel): boolean {
    // Windows, glass and light sources are crisp gameplay features. Natural
    // translucent terrain may mix RGB while retaining its own alpha and sorting.
    const material = getVoxelMaterialDefinition(voxel)
    return !voxel.feature && material.id !== 'glass' && material.id !== 'light' && !getVoxelLightSource(voxel)
  }

  function neighbourPalette(cell: Vec3, colour: number, kind: 'ground' | 'voxel'): TerrainNeighbours {
    if (kind === 'voxel' && !canBlendVoxel(cell as MapVoxel)) return []
    return FACE_OFFSETS.map(([dx, dy, dz]) => {
      if (kind === 'ground' && dy !== 0) return undefined
      const position = { x: cell.x + dx!, y: cell.y + dy!, z: cell.z + dz! }
      if (kind === 'ground') {
        const other = indices.groundTiles.get(key(position))
        if (!other) return undefined
        const next = other.materialId ? getVoxelMaterialDefinition(other.materialId).color : ELEMENT_COLORS[other.element]
        return next !== colour ? next : undefined
      }
      const other = indices.voxels.get(key(position))
      if (!other || !canBlendVoxel(other) || (getVoxelOpacity(other) < 1) !== (getVoxelOpacity(cell as MapVoxel) < 1)) return undefined
      if (getVoxelOpacity(other) < 1 && other.y > clipY) return undefined
      const next = getVoxelColor(other)
      return next !== colour ? next : undefined
    })
  }

  function addTransparentOutline(voxel: MapVoxel, chunkKey: string, positions: number[], visited: Set<string>) {
    // Check all four quadrants around each edge against the global voxel index.
    // This removes flat seams at chunk boundaries and gives each crease one owner.
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3
      for (let du = 0; du <= 1; du++) for (let dv = 0; dv <= 1; dv++) {
        const start = [voxel.x, voxel.y, voxel.z]
        start[u] += du; start[v] += dv
        const edgeKey = `${axis}:${start.join(',')}`
        if (visited.has(edgeKey)) continue
        visited.add(edgeKey)
        const groups = new Map<string, { mask: number; chunks: string[] }>()
        const quadrants = [[-1, -1], [0, -1], [0, 0], [-1, 0]]
        quadrants.forEach(([qu, qv], quadrant) => {
          const neighbor = [...start]
          neighbor[u] += qu; neighbor[v] += qv
          const cell = indices.voxels.get(neighbor.join(','))
          if (!visibleTransparentCube(cell)) return
          const groupKey = volumeGroup(cell)
          const group = groups.get(groupKey) ?? { mask: 0, chunks: [] }
          group.mask |= 1 << quadrant
          group.chunks.push(terrainChunkKey(cell))
          groups.set(groupKey, group)
        })
        const owners: string[] = []
        for (const { mask, chunks: candidates } of groups.values()) {
          const count = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)
          if (count === 1 || count === 3 || mask === 5 || mask === 10) owners.push(...candidates)
        }
        if (!owners.length || owners.sort()[0] !== chunkKey) continue
        const end = [...start]; end[axis]++
        positions.push(...start, ...end)
      }
    }
  }

  function buildChunk(chunkKey: string, state: ChunkState) {
    clearChunk(state)
    builtChunks++
    const buckets = new Map<string, InstanceBucket>()
    const groundEdges: number[] = [], voxelEdges: number[] = [], transparentEdges: number[] = []
    const visitedTransparentEdges = new Set<string>()
    const add = (bucketKey: string, definition: Omit<InstanceBucket, 'instances'>, instance: Instance) => {
      let bucket = buckets.get(bucketKey)
      if (!bucket) { bucket = { ...definition, instances: [] }; buckets.set(bucketKey, bucket) }
      bucket.instances.push(instance)
    }
    const groundGeo = () => new THREE.BoxGeometry(1, TILE_H, 1)
    const groundBaseEdges = () => baseEdgePositions('ground', groundGeo)
    const litMaterial = (transparent = false, depthWrite = true) => () => new THREE.MeshLambertMaterial({ color: 0xffffff, transparent, depthWrite })
    const planeQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))

    for (const tile of state.data.groundTiles.values()) {
      const color = tile.materialId ? getVoxelMaterialDefinition(tile.materialId).color : ELEMENT_COLORS[tile.element] ?? 0x888888
      add('ground', { geometryKey: 'ground', materialKey: 'lambert:opaque', geometry: groundGeo, material: litMaterial(), castShadow: false, spawn: false },
        { position: new THREE.Vector3(tile.x + 0.5, tile.y + TILE_H / 2, tile.z + 0.5), color, neighbours: neighbourPalette(tile, color, 'ground') })
      addTranslatedEdges(groundEdges, groundBaseEdges(), tile.x + 0.5, tile.y + TILE_H / 2, tile.z + 0.5)

      if (tile.isSpawnPoint) add('ground-spawn', {
        geometryKey: 'ground-spawn', materialKey: 'spawn:ground', geometry: () => new THREE.PlaneGeometry(0.7, 0.7),
        material: () => new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.4, depthWrite: false }), castShadow: false, spawn: true
      },
        { position: new THREE.Vector3(tile.x + 0.5, tile.y + TILE_H + 0.003, tile.z + 0.5), quaternion: planeQuaternion })
    }

    for (const tile of state.data.spaceTiles.values()) add('space', {
      geometryKey: 'cube:63', materialKey: 'space', geometry: () => new THREE.BoxGeometry(1, 1, 1),
      material: () => new THREE.MeshBasicMaterial({ color: 0x334455, wireframe: true, opacity: 0.25, transparent: true }), castShadow: false, spawn: false
    },
      { position: new THREE.Vector3(tile.x + 0.5, tile.y + 0.5, tile.z + 0.5) })

    for (const voxel of state.data.voxels.values()) {
      const opacity = getVoxelOpacity(voxel)
      const geometryKey = voxelGeometryKey(voxel)
      const shapeGeometry = () => makeVoxelGeometry(geometryKey)
      const color = getVoxelColor(voxel)
      if (opacity < 1) {
        state.hasTransparent = true
        addTransparent(voxel, state)
        if (voxel.shape !== 'ramp' && voxel.y <= clipY) addTransparentOutline(voxel, chunkKey, transparentEdges, visitedTransparentEdges)
      } else {
        const transparent = Boolean(getVoxelMaterialDefinition(voxel).transparent)
        const materialKey = `lambert:${transparent ? 'transparent-solid' : 'opaque'}`
        add(`voxel:${geometryKey}:${materialKey}`, {
          geometryKey, materialKey, geometry: shapeGeometry,
          material: litMaterial(transparent), castShadow: true, spawn: false
        },
          {
            position: new THREE.Vector3(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5), color,
            lightVoxel: getVoxelLightSource(voxel) ? voxel : undefined, neighbours: neighbourPalette(voxel, color, 'voxel')
          })
      }
      if (opacity >= 1 || voxel.shape === 'ramp') {
        addTranslatedEdges(voxelEdges, baseEdgePositions(geometryKey, shapeGeometry), voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5)
      }
      if (voxel.isSpawnPoint) {
        const isRamp = voxel.shape === 'ramp'
        const quaternion = isRamp
          ? new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 4, rampRotationY(voxel.rampDirection), 0, 'YXZ')) : planeQuaternion
        add('voxel-spawn', {
          geometryKey: 'voxel-spawn', materialKey: 'spawn:voxel', geometry: () => new THREE.PlaneGeometry(0.72, 0.72),
          material: () => new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.48, depthWrite: false }), castShadow: false, spawn: true
        },
          {
            position: new THREE.Vector3(voxel.x + 0.5, voxel.y + (isRamp ? 0.5 : 1) + 0.004, voxel.z + 0.5), quaternion,
            scale: isRamp ? new THREE.Vector3(1, Math.SQRT2, 1) : undefined
          })
      }
    }

    const matrix = new THREE.Matrix4(), identity = new THREE.Quaternion(), unit = new THREE.Vector3(1, 1, 1)
    for (const bucket of buckets.values()) {
      const geometry = lease(geometries, bucket.geometryKey, bucket.geometry, freeGeometry, state)
      const material = lease(materials, bucket.materialKey, bucket.material, freeMaterial, state)
      const mesh = new THREE.InstancedMesh(geometry, material, bucket.instances.length)
      bucket.instances.forEach((instance, index) => {
        matrix.compose(instance.position, instance.quaternion ?? identity, instance.scale ?? unit)
        mesh.setMatrixAt(index, matrix)
        if (instance.color !== undefined) mesh.setColorAt(index, new THREE.Color(instance.color))
        if (instance.lightVoxel) {
          const cellKey = key(instance.lightVoxel)
          opaqueSourceInstances.set(cellKey, { mesh, index })
          state.opaqueSourceKeys.push(cellKey)
        }
      })
      const blend = attachTerrainMaterialBlend(mesh, bucket.instances.map(instance => instance.neighbours ?? []))
      if (blend) {
        blendTextures.add(blend.texture)
        state.releases.push(() => { freeGeometry(blend.geometry); freeMaterial(blend.material); blend.texture.dispose(); blendTextures.delete(blend.texture) })
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.castShadow = bucket.castShadow
      mesh.receiveShadow = !bucket.spawn
      mesh.userData = { floorY: state.group.userData.floorY, terrainBatch: true, spawn: bucket.spawn }
      mesh.visible = !bucket.spawn || showSpawns
      mesh.raycast = noRaycast
      mesh.computeBoundingBox(); mesh.computeBoundingSphere()
      state.group.add(mesh)
    }
    const addLines = (positions: number[], materialKey: string, opacity: number, depthWrite = true) => {
      if (!positions.length) return
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const material = lease(materials, materialKey, () => new THREE.LineBasicMaterial({ color: 0, transparent: true, opacity, depthWrite }), freeMaterial, state)
      const lines = new THREE.LineSegments(geometry, material as THREE.LineBasicMaterial)
      lines.raycast = noRaycast
      lines.userData = { floorY: state.group.userData.floorY }
      state.group.add(lines)
    }
    addLines(groundEdges, 'edges:ground', 0.3)
    addLines(voxelEdges, 'edges:voxel', 0.35)
    addLines(transparentEdges, 'edges:transparent', 0.35, false)
    state.group.visible = state.group.userData.floorY <= clipY
    voxelLights.syncChunk(chunkKey, state.data.voxels.values())
  }

  function removeEmptyChunk(chunkKey: string, state: ChunkState): boolean {
    if (TERRAIN_COLLECTIONS.some(collection => state.data[collection].size > 0)) return false
    clearChunk(state)
    scene.remove(state.group)
    states.delete(chunkKey); chunks.delete(chunkKey)
    return true
  }

  function clear() {
    for (const state of states.values()) { clearChunk(state); scene.remove(state.group) }
    voxelLights.dispose()
    opaqueSourceInstances.clear()
    states.clear(); chunks.clear()
    for (const collection of TERRAIN_COLLECTIONS) indices[collection].clear()
    if (transparentMesh) { scene.remove(transparentMesh); transparentMesh.dispose(); disposedGeometries++ }
    if (transparentMaterial) freeMaterial(transparentMaterial)
    transparentBlend?.dispose()
    transparentBlend = null
    transparentMesh = null; transparentMaterial = null
    transparentInstances.clear(); transparentGeometryIds.clear()
  }

  function rebuildDirty(dirty: Set<string>) {
    lastRebuiltChunkKeys = []
    for (const chunkKey of dirty) {
      const state = states.get(chunkKey)
      if (!state) continue
      if (!removeEmptyChunk(chunkKey, state)) buildChunk(chunkKey, state)
      lastRebuiltChunkKeys.push(chunkKey)
    }
    if (transparentBlend) {
      const rows = new Map<number, TerrainNeighbours>()
      for (const { id, voxel } of transparentInstances.values()) rows.set(id, neighbourPalette(voxel, getVoxelColor(voxel), 'voxel'))
      transparentBlend.update(rows)
    }
  }

  function setClipY(nextY: number) {
    if (nextY === clipY) return
    const oldY = clipY
    clipY = nextY
    voxelLights.setClipY(nextY)
    const dirty = new Set<string>()
    for (const [chunkKey, state] of states) {
      const y = state.group.userData.floorY as number
      state.group.visible = y <= clipY
      if (state.hasTransparent && ((y <= oldY) !== (y <= clipY) || y === Math.floor(oldY) || y === Math.floor(clipY))) dirty.add(chunkKey)
    }
    rebuildDirty(dirty)
  }

  function setSpawnVisible(show: boolean) {
    showSpawns = show
    for (const state of states.values()) for (const child of state.group.children) {
      if (child.userData.spawn) child.visible = show
    }
  }

  function sync(input: GameMap, view?: Partial<MapTerrainView>) {
    const map = toRaw(input)
    const nextRevision = getMapGeometryRevision(map)
    const change = getMapEditChange(map)
    if (view?.clipY !== undefined) setClipY(view.clipY)
    if (view?.showSpawnIndicators !== undefined) setSpawnVisible(view.showSpawnIndicators)
    if (nextRevision === revision && map.id === mapId) return
    const incremental = map.id === mapId && change?.previousRevision === revision
    if (!incremental) {
      clear()
      for (const collection of TERRAIN_COLLECTIONS) for (const cell of map[collection] ?? []) {
        ; (indices[collection] as Map<string, TerrainCell>).set(key(cell), cell)
          ; (ensureState(cell).data[collection] as Map<string, TerrainCell>).set(key(cell), cell)
      }
      rebuildDirty(new Set(states.keys()))
    } else {
      const changed = TERRAIN_COLLECTIONS.filter(collection => change.collections.includes(collection))
      if (changed.length) {
        for (const collection of changed) {
          ; (indices[collection] as Map<string, TerrainCell>) = new Map((map[collection] ?? []).map(cell => [key(cell), cell]))
        }
        const dirty = new Set<string>()
        for (const cell of change.cells) {
          const cellKey = key(cell), chunkKey = terrainChunkKey(cell)
          for (const collection of changed) {
            const item = indices[collection].get(cellKey)
            const state = item ? ensureState(item) : states.get(chunkKey)
            if (!state) continue
            if (item) (state.data[collection] as Map<string, TerrainCell>).set(cellKey, item)
            else state.data[collection].delete(cellKey)
          }
          // One-cell halo includes blend edges, voxel faces, and all crease quadrants.
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            dirty.add(terrainChunkKey({ x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }))
          }
        }
        rebuildDirty(dirty)
      } else lastRebuiltChunkKeys = []
    }
    revision = nextRevision; mapId = map.id
  }

  function candidates(raycaster: THREE.Raycaster): ChunkState[] {
    const point = new THREE.Vector3()
    return [...states.values()].filter(state => state.group.visible && raycaster.ray.intersectBox(state.bounds, point) !== null)
      .sort((a, b) => raycaster.ray.origin.distanceToSquared(a.bounds.getCenter(new THREE.Vector3())) - raycaster.ray.origin.distanceToSquared(b.bounds.getCenter(new THREE.Vector3())))
  }

  function intersectCell(raycaster: THREE.Raycaster, cell: TerrainCell, type: 'ground' | 'space' | 'voxel'): THREE.Intersection[] {
    const geometryKey = type === 'voxel' ? voxelGeometryKey(cell as MapVoxel) : type
    if (geometryKey === 'cube:0') return []
    pickProxy.geometry = proxyGeometry(geometryKey)
    pickProxy.position.set(cell.x + 0.5, cell.y + (type === 'ground' ? TILE_H / 2 : 0.5), cell.z + 0.5)
    pickProxy.updateMatrixWorld(true)
    const hits: THREE.Intersection[] = []
    pickProxy.raycast(raycaster, hits)
    if (!hits.length) return hits
    const object = new THREE.Mesh(pickProxy.geometry, pickMaterial)
    object.position.copy(pickProxy.position)
    object.userData = { type, floorY: cell.y, ...(type === 'voxel' ? { voxel: cell } : { tile: cell }) }
    for (const hit of hits) hit.object = object
    return hits
  }

  function pick(raycaster: THREE.Raycaster): THREE.Intersection[] {
    const hits: THREE.Intersection[] = []
    for (const state of candidates(raycaster)) for (const collection of TERRAIN_COLLECTIONS) {
      const type = collection === 'groundTiles' ? 'ground' : collection === 'spaceTiles' ? 'space' : 'voxel'
      for (const cell of state.data[collection].values()) hits.push(...intersectCell(raycaster, cell, type))
    }
    return hits.sort((a, b) => a.distance - b.distance)
  }

  function isOccluded(raycaster: THREE.Raycaster): boolean {
    for (const state of candidates(raycaster)) for (const voxel of state.data.voxels.values()) {
      // Portraits remain visible through translucent terrain, independently of gameplay sight rules.
      if (getVoxelOpacity(voxel) < 1) continue
      if (intersectCell(raycaster, voxel, 'voxel').length) return true
    }
    return false
  }

  function dispose() {
    clear()
    for (const geometry of proxyGeometryCache.values()) freeGeometry(geometry)
    proxyGeometryCache.clear()
    edgePositions.clear()
    pickMaterial.dispose()
    revision = 0; mapId = null
  }

  function stats() {
    let objects = transparentMesh ? 1 : 0, drawCalls = transparentMesh && transparentInstances.size ? 1 : 0, instances = transparentInstances.size
    for (const state of states.values()) for (const child of state.group.children) {
      objects++
      if (state.group.visible && child.visible) drawCalls++
      if (child instanceof THREE.InstancedMesh) instances += child.count
    }
    return {
      chunks: chunks.size, objects, drawCalls, instances, transparentInstances: transparentInstances.size,
      geometries: geometries.size + proxyGeometryCache.size + (transparentMesh ? 1 : 0), materials: materials.size + (transparentMaterial ? 1 : 0),
      textures: blendTextures.size + (transparentBlend ? 1 : 0), builtChunks, disposedGeometries, disposedMaterials, lastRebuiltChunkKeys: [...lastRebuiltChunkKeys],
      lightSources: voxelLights.stats().lights, lightSourceCells: voxelLights.stats().cells
    }
  }

  return { chunks, sync, setClipY, setSpawnVisible, pick, isOccluded, updateAnimation: voxelLights.updateAnimation, dispose, stats }
}
