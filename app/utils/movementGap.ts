/** Cache floor/voxel surface heights by column; movement only queries one column. */
export function buildMovementGroundIndex(groundTiles: readonly { x: number; y: number; z: number }[], voxels: readonly { x: number; y: number; z: number }[]) {
  const columns = new Map<string, number[]>()
  const add = (x: number, z: number, y: number) => {
    const key = `${x},${z}`
    const heights = columns.get(key) ?? []
    heights.push(y)
    columns.set(key, heights)
  }
  for (const tile of groundTiles) add(tile.x, tile.z, tile.y)
  for (const voxel of voxels) add(voxel.x, voxel.z, voxel.y + 1)
  for (const [key, heights] of columns) columns.set(key, [...new Set(heights)].sort((a, b) => a - b))
  return columns
}

export function movementGroundBelow(index: Map<string, number[]>, cell: { x: number; y: number; z: number }, dims: { width: number; depth: number }): number | null {
  const heights = index.get(`${Math.floor(cell.x + dims.width / 2)},${Math.floor(cell.z + dims.depth / 2)}`) ?? []
  let lower = 0, upper = heights.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (heights[middle]! <= cell.y) lower = middle + 1
    else upper = middle
  }
  return lower > 0 ? heights[lower - 1]! : null
}
