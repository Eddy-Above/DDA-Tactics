import type { GameMap, Vec3, WallFace } from '~/types'
import { MAP_GEOMETRY_COLLECTIONS, type MapGeometryCollection } from './mapEdits'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export type DrawMode = 'line' | 'square' | 'cube' | 'circle' | 'brush'
export type SelectionBox = { min: Vec3; max: Vec3 }
export type MapFragment = { [K in MapGeometryCollection]: GameMap[K] }
export interface MapStamp { id: string; name: string; content: MapFragment }
export const cellKey = (p: Vec3) => [p.x, p.y, p.z].join(',')
export function selectionBox(a: Vec3, b: Vec3): SelectionBox {
  return { min: { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), z: Math.min(a.z,b.z) }, max: { x: Math.max(a.x,b.x), y: Math.max(a.y,b.y), z: Math.max(a.z,b.z) } }
}
export function drawCells(a: Vec3, b: Vec3, mode: DrawMode, size = 1, roundBrush = false): Vec3[] {
  const result: Vec3[] = [], box = selectionBox(a,b)
  if (mode === 'brush') {
    const steps = Math.max(Math.abs(b.x-a.x), Math.abs(b.y-a.y), Math.abs(b.z-a.z), 1)
    const diameter = Math.max(1, Math.min(32, Math.round(size)))
    const low = -Math.floor((diameter-1)/2), high = low+diameter-1
    for(let t=0;t<=steps;t++) for(let dx=low;dx<=high;dx++) for(let dz=low;dz<=high;dz++) {
      const centre = (low+high)/2
      if(roundBrush && Math.hypot(dx-centre,dz-centre)>diameter/2) continue
      result.push({ x: Math.round(a.x+(b.x-a.x)*t/steps)+dx, y: Math.round(a.y+(b.y-a.y)*t/steps), z: Math.round(a.z+(b.z-a.z)*t/steps)+dz })
    }
  } else {
    if(mode==='line') {
      if(Math.abs(b.x-a.x)>=Math.abs(b.z-a.z)) box.min.z=box.max.z=a.z
      else box.min.x=box.max.x=a.x
    }
    if(mode!=='cube') box.min.y=box.max.y=a.y
    const cx=(box.min.x+box.max.x)/2, cz=(box.min.z+box.max.z)/2
    const rx=(box.max.x-box.min.x+1)/2, rz=(box.max.z-box.min.z+1)/2
    for(let x=box.min.x;x<=box.max.x;x++) for(let y=box.min.y;y<=box.max.y;y++) for(let z=box.min.z;z<=box.max.z;z++) {
      if(mode==='circle' && ((x-cx)/rx)**2+((z-cz)/rz)**2>1) continue
      result.push({x,y,z})
    }
  }
  return [...new Map(result.map(p=>[cellKey(p),p])).values()]
}
export function fragmentFromSelection(map: GameMap, box: SelectionBox): MapFragment {
  const inside=(p:Vec3)=>p.x>=box.min.x&&p.x<=box.max.x&&p.y>=box.min.y&&p.y<=box.max.y&&p.z>=box.min.z&&p.z<=box.max.z
  const fragment = Object.fromEntries(MAP_GEOMETRY_COLLECTIONS.map(key=>[key, []])) as unknown as MapFragment
  for(const key of MAP_GEOMETRY_COLLECTIONS) if(key!=='windows'&&key!=='doors') (fragment[key] as unknown[]) = map[key].filter(p=>inside(p as Vec3)).map(p=>clone(p))
  const walls=new Set(fragment.walls.map(w=>w.id))
  fragment.windows=map.windows.filter(p=>walls.has(p.wallId)).map(p=>clone(p))
  fragment.doors=map.doors.filter(p=>walls.has(p.wallId)).map(p=>clone(p))
  return fragment
}
export function fragmentBounds(content: Partial<MapFragment>): SelectionBox | null {
  const points: Vec3[]=[]
  for(const key of MAP_GEOMETRY_COLLECTIONS) if(key!=='windows'&&key!=='doors') for(const cell of content[key]??[]) points.push(cell as Vec3)
  if(!points.length) return null
  let box=selectionBox(points[0]!,points[0]!)
  for(const p of points) box={min:{x:Math.min(box.min.x,p.x),y:Math.min(box.min.y,p.y),z:Math.min(box.min.z,p.z)},max:{x:Math.max(box.max.x,p.x),y:Math.max(box.max.y,p.y),z:Math.max(box.max.z,p.z)}}
  return box
}
export function transformFragment(content: MapFragment, target: Vec3, turns: number, makeId: ()=>string): MapFragment {
  const box=fragmentBounds(content)
  if(!box) return clone(content)
  const n=((turns%4)+4)%4
  const rotate=(p:Vec3)=> {
    let x=p.x-box.min.x, z=p.z-box.min.z
    const width=box.max.x-box.min.x, depth=box.max.z-box.min.z
    if(n===1) [x,z]=[depth-z,x]
    if(n===2) [x,z]=[width-x,depth-z]
    if(n===3) [x,z]=[z,width-x]
    return {x:target.x+x,y:target.y+p.y-box.min.y,z:target.z+z}
  }
  const ids=new Map<string,string>()
  const directions:WallFace[]=['north','east','south','west']
  const result=Object.fromEntries(MAP_GEOMETRY_COLLECTIONS.map(key=>[key,[]])) as unknown as MapFragment
  for(const key of MAP_GEOMETRY_COLLECTIONS) for(const entry of content[key]) {
    const p=clone(entry) as any
    if('id' in p){ const id=makeId();ids.set(p.id,id);p.id=id }
    if('x' in p) Object.assign(p,rotate(p))
    if(p.face) {
      // Legacy stair faces encode east/west opposite to visible uphill.
      let face=p.face as WallFace
      if(key==='stairs') face=face==='east'?'west':face==='west'?'east':face
      face=directions[(directions.indexOf(face)+n)%4]!
      p.face=key==='stairs'?(face==='east'?'west':face==='west'?'east':face):face
    }
    if(p.rampDirection) p.rampDirection=directions[(directions.indexOf(p.rampDirection)+n)%4]
    ;(result[key] as unknown[]).push(p)
  }
  for(const key of ['windows','doors'] as const) for(const item of result[key]) item.wallId=ids.get(item.wallId)!
  return result
}
export function fragmentCollision(map: GameMap, fragment: MapFragment, ignore?: MapFragment): string | null {
  for(const key of MAP_GEOMETRY_COLLECTIONS) {
    if(key==='windows'||key==='doors') continue
    const identity=(p:any)=>cellKey(p)+(key==='walls'?':'+p.face:'')
    const ignored=new Set((ignore?.[key]??[]).map(identity))
    const occupied=new Set(map[key].map(identity).filter(id=>!ignored.has(id)))
    if(fragment[key].some(p=>occupied.has(identity(p)))) return 'That position overlaps existing '+key+'. Move the selection or stamp to a clear position.'
  }
  return null
}
