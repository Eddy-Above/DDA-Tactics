import * as THREE from 'three'
import type { MapVoxel } from '~/types'
import { getVoxelLightSource, type MapVoxelLightSourceDefinition } from '~/utils/mapVoxels'

type SourceCell = { voxel: MapVoxel; emission: MapVoxelLightSourceDefinition; color: THREE.Color; phase: number }
type LightCluster = { light: THREE.PointLight; intensity: number; flicker: boolean; phase: number; y: number }
type LightChunk = { cells: SourceCell[]; clusters: LightCluster[] }
const cellKey = (voxel: MapVoxel) => `${voxel.x},${voxel.y},${voxel.z}`
const neighbours = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

function phaseAt(x: number, y: number, z: number): number {
  return ((x * 73.13 + y * 37.71 + z * 19.37) % 31.41 + 31.41) % 31.41
}

/** Smooth, always-on flicker with a maximum six percent variation. */
export function voxelLightFlicker(timeSeconds: number, phase = 0): number {
  return 1 + 0.04 * Math.sin(timeSeconds * 3.1 + phase) + 0.02 * Math.sin(timeSeconds * 7.7 + phase * 1.91)
}

/** Persistent local lights; only matching face-adjacent cells within a terrain chunk are combined. */
export function createMapVoxelLights(
  scene: THREE.Scene | THREE.Group,
  updateColor: (voxel: MapVoxel, color: THREE.Color) => void,
) {
  const chunks = new Map<string, LightChunk>()
  const tint = new THREE.Color()
  let clipY = Infinity

  function removeChunk(chunkKey: string) {
    const chunk = chunks.get(chunkKey)
    if (!chunk) return
    for (const cluster of chunk.clusters) {
      scene.remove(cluster.light)
      cluster.light.dispose()
    }
    chunks.delete(chunkKey)
  }

  function syncChunk(chunkKey: string, voxels: Iterable<MapVoxel>) {
    removeChunk(chunkKey)
    const cells: SourceCell[] = []
    const groups = new Map<string, Map<string, SourceCell>>()
    for (const voxel of voxels) {
      const emission = getVoxelLightSource(voxel)
      if (!emission || emission.intensity <= 0 || emission.distance <= 0) continue
      const cell = { voxel, emission, color: new THREE.Color(emission.color), phase: phaseAt(voxel.x, voxel.y, voxel.z) }
      cells.push(cell)
      const settings = JSON.stringify([emission.color, emission.intensity, emission.distance, !!emission.flicker])
      let group = groups.get(settings)
      if (!group) { group = new Map(); groups.set(settings, group) }
      group.set(cellKey(voxel), cell)
    }
    if (!cells.length) return
    const clusters: LightCluster[] = []
    for (const group of groups.values()) while (group.size) {
      const first = group.values().next().value!
      group.delete(cellKey(first.voxel))
      const connected = [first]
      for (let head = 0; head < connected.length; head++) {
        const { voxel } = connected[head]
        for (const [dx, dy, dz] of neighbours) {
          const neighbourKey = `${voxel.x + dx},${voxel.y + dy},${voxel.z + dz}`
          const next = group.get(neighbourKey)
          if (next) { group.delete(neighbourKey); connected.push(next) }
        }
      }
      const center = new THREE.Vector3()
      for (const { voxel } of connected) center.add(new THREE.Vector3(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5))
      center.divideScalar(connected.length)
      let radius = 0
      for (const { voxel } of connected) radius = Math.max(radius, center.distanceTo(new THREE.Vector3(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5)))
      // Keep the reach of edge cells when combining a volume, with the summed source power.
      const intensity = first.emission.intensity * connected.length
      const light = new THREE.PointLight(first.emission.color, intensity, first.emission.distance + radius, 2)
      light.position.copy(center)
      light.castShadow = false
      light.visible = first.voxel.y <= clipY
      light.userData = { voxelLightSource: true, terrainChunk: chunkKey, sourceCells: connected.length, floorY: first.voxel.y }
      scene.add(light)
      const phase = phaseAt(center.x, center.y, center.z)
      for (const cell of connected) cell.phase = phase
      clusters.push({ light, intensity, flicker: !!first.emission.flicker,
        phase, y: first.voxel.y })
    }
    chunks.set(chunkKey, { cells, clusters })
  }

  function setClipY(nextY: number) {
    clipY = nextY
    for (const chunk of chunks.values()) for (const cluster of chunk.clusters) cluster.light.visible = cluster.y <= clipY
  }

  function updateAnimation(timeSeconds: number): boolean {
    let active = false
    for (const chunk of chunks.values()) {
      for (const cluster of chunk.clusters) {
        if (!cluster.light.visible || !cluster.flicker) continue
        cluster.light.intensity = cluster.intensity * voxelLightFlicker(timeSeconds, cluster.phase)
        active = true
      }
      for (const cell of chunk.cells) {
        if (cell.voxel.y > clipY || !cell.emission.flicker) continue
        tint.copy(cell.color).multiplyScalar(voxelLightFlicker(timeSeconds, cell.phase))
        updateColor(cell.voxel, tint)
      }
    }
    return active
  }

  function dispose() {
    for (const chunkKey of chunks.keys()) removeChunk(chunkKey)
  }

  function stats() {
    let lights = 0, cells = 0
    for (const chunk of chunks.values()) { lights += chunk.clusters.length; cells += chunk.cells.length }
    return { lights, cells }
  }

  return { syncChunk, removeChunk, setClipY, updateAnimation, dispose, stats }
}
