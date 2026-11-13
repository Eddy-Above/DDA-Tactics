import * as THREE from 'three'
export type TerrainNeighbours = Array<number | undefined>
function writePalette(data: Float32Array, index: number, neighbours: TerrainNeighbours) {
  for (let face = 0; face < 6; face++) {
    const hex = neighbours[face], at = (index * 6 + face) * 4
    if (hex === undefined)
      data.fill(0, at, at + 4)
    else {
      // Convert material sRGB hex to the renderer's linear working space.
      const color = new THREE.Color(hex)
      data.set([color.r, color.g, color.b, 1], at)
    }
  }
}
function paletteTexture(width: number, height: number) {
  const texture = new THREE.DataTexture(new Float32Array(width * height * 4), width, height, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  return texture
}
/** Blend the lit diffuse colour before Lambert lighting, leaving opacity untouched. */
function configureBlend(material: THREE.MeshLambertMaterial, palette: {
  value: THREE.DataTexture
}, size: THREE.Vector2, batched: boolean) {
  material.customProgramCacheKey = () => `terrain-natural-blend-v2:${batched}`
  material.onBeforeCompile = shader => {
    shader.uniforms.terrainBlendPalette = palette
    shader.uniforms.terrainBlendSize = { value: size }
    shader.vertexShader = `${batched ? '' : 'attribute float terrainBlendIndex;'}
      varying float vTerrainBlendIndex;
      varying vec3 vTerrainLocal;
      varying vec3 vTerrainNormal;
      varying vec3 vTerrainWorld;
    ` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vTerrainBlendIndex = ${batched ? 'getIndirectIndex(gl_DrawID)' : 'terrainBlendIndex'};
      vTerrainLocal = position;
      vTerrainNormal = normal;
      vTerrainWorld = (modelMatrix * ${batched ? 'batchingMatrix' : 'instanceMatrix'} * vec4(position, 1.0)).xyz;
    `)
    shader.fragmentShader = `
      uniform sampler2D terrainBlendPalette;
      uniform vec2 terrainBlendSize;
      varying float vTerrainBlendIndex;
      varying vec3 vTerrainLocal;
      varying vec3 vTerrainNormal;
      varying vec3 vTerrainWorld;
      float terrainHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float terrainNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p);
        f=f*f*(3.0-2.0*f);
        return mix(mix(terrainHash(i),terrainHash(i+vec2(1,0)),f.x),mix(terrainHash(i+vec2(0,1)),terrainHash(i+vec2(1,1)),f.x),f.y);
      }
      vec4 terrainNeighbour(float face) {
        float texel=vTerrainBlendIndex*6.0+face;
        return texture2D(terrainBlendPalette,(vec2(mod(texel,terrainBlendSize.x),floor(texel/terrainBlendSize.x))+0.5)/terrainBlendSize);
      }
    ` + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 terrainBase=diffuseColor.rgb;
      vec3 terrainDelta=vec3(0.0);
      float terrainWeight=0.0;
      float terrainWidth=mix(0.16,0.34,terrainNoise(vec2(vTerrainWorld.x+vTerrainWorld.y*0.37,vTerrainWorld.z+vTerrainWorld.y*0.61)*7.0));
      ${[0, 1, 2, 3, 4, 5].map(face => {
      const axis = ['x', 'x', 'y', 'y', 'z', 'z'][face], sign = face % 2 === 0 ? '-' : '+'
      // Suppress the face pointing into a neighbour. Slopes keep full edge weight
      // so their endpoints meet the same midpoint colour as adjacent flat cells.
      return `{
          vec4 neighbour=terrainNeighbour(${face}.0);
          float weight=0.5*(1.0-smoothstep(0.0,terrainWidth,0.5${sign}vTerrainLocal.${axis}))
            *(1.0-step(0.999,abs(normalize(vTerrainNormal).${axis})))*neighbour.a;
          terrainDelta+=(neighbour.rgb-terrainBase)*weight;
          terrainWeight+=weight;
        }`
    }).join('\n')}
      diffuseColor.rgb=terrainBase+terrainDelta/max(1.0,terrainWeight);
    `)
  }
}
/** Six neighbours per instance, without splitting material/shape draw batches. */
export function attachTerrainMaterialBlend(mesh: THREE.InstancedMesh, neighbours: TerrainNeighbours[]) {
  if (!neighbours.some(row => row.some(color => color !== undefined)))
    return null
  const geometry = mesh.geometry.clone()
  geometry.setAttribute('terrainBlendIndex', new THREE.InstancedBufferAttribute(Float32Array.from(neighbours, (_, i) => i), 1))
  const texture = paletteTexture(6, neighbours.length)
  neighbours.forEach((row, index) => writePalette(texture.image.data as Float32Array, index, row))
  const material = (mesh.material as THREE.MeshLambertMaterial).clone()
  configureBlend(material, { value: texture }, new THREE.Vector2(6, neighbours.length), false)
  mesh.geometry = geometry
  mesh.material = material
  return { geometry, material, texture }
}
/** Stable batch-instance IDs survive depth sorting and the multi-draw fallback. */
export function attachBatchedTerrainMaterialBlend(mesh: THREE.BatchedMesh) {
  const palette = { value: paletteTexture(6, 1) }
  const size = new THREE.Vector2(6, 1)
  configureBlend(mesh.material as THREE.MeshLambertMaterial, palette, size, true)
  return {
    get texture() { return palette.value },
    update(rows: Map<number, TerrainNeighbours>) {
      let count = 1
      for (const index of rows.keys())
        count = Math.max(count, index + 1)
      // Bound both dimensions on large water volumes instead of using one row per cell.
      const width = Math.min(1020, count * 6), height = Math.ceil(count * 6 / width)
      if (size.x !== width || size.y !== height) {
        palette.value.dispose()
        palette.value = paletteTexture(width, height)
        size.set(width, height)
      }
      const data = palette.value.image.data as Float32Array
      data.fill(0)
      for (const [index, row] of rows)
        writePalette(data, index, row)
      palette.value.needsUpdate = true
    },
    dispose() { palette.value.dispose() },
  }
}
