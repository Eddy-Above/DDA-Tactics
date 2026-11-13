import * as THREE from 'three'

// Each cell keeps the existing draw batch. Six neighbour colours are sampled from
// a tiny per-batch palette, rather than adding bright planes on top of the surface.
export function attachTerrainMaterialBlend(mesh: THREE.InstancedMesh, neighbours: Array<Array<number | undefined>>) {
  if(!neighbours.some(row=>row.some(color=>color!==undefined)))return null
  const geometry=mesh.geometry.clone()
  geometry.setAttribute('terrainBlendIndex',new THREE.InstancedBufferAttribute(Float32Array.from(neighbours,(_,i)=>i),1))
  const data=new Float32Array(6*neighbours.length*4)
  for(let i=0;i<neighbours.length;i++)for(let face=0;face<6;face++) {
    const hex=neighbours[i]![face]
    if(hex===undefined)continue
    const color=new THREE.Color(hex),at=(i*6+face)*4
    data.set([color.r,color.g,color.b,1],at)
  }
  const texture=new THREE.DataTexture(data,6,neighbours.length,THREE.RGBAFormat,THREE.FloatType)
  texture.needsUpdate=true
  const material=(mesh.material as THREE.MeshLambertMaterial).clone()
  material.customProgramCacheKey=()=> 'terrain-natural-blend-v1'
  material.onBeforeCompile=shader=>{
    shader.uniforms.terrainBlendPalette={value:texture}
    shader.uniforms.terrainBlendRows={value:neighbours.length}
    shader.vertexShader=
      'attribute float terrainBlendIndex; varying float vTerrainBlendIndex; varying vec3 vTerrainLocal; varying vec3 vTerrainNormal; varying vec3 vTerrainWorld;\n'+shader.vertexShader
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvTerrainBlendIndex=terrainBlendIndex;vTerrainLocal=position;vTerrainNormal=normal;vTerrainWorld=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;')
    shader.fragmentShader=
      'uniform sampler2D terrainBlendPalette; uniform float terrainBlendRows; varying float vTerrainBlendIndex; varying vec3 vTerrainLocal; varying vec3 vTerrainNormal; varying vec3 vTerrainWorld;\n'+
      'float terrainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'+
      'float terrainNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(terrainHash(i),terrainHash(i+vec2(1,0)),f.x),mix(terrainHash(i+vec2(0,1)),terrainHash(i+vec2(1,1)),f.x),f.y);}\n'+shader.fragmentShader
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n'+
      'vec3 terrainBase=diffuseColor.rgb; vec3 terrainDelta=vec3(0.0); float terrainWeight=0.0;\n'+
      'float terrainWidth=mix(0.16,0.34,terrainNoise(vec2(vTerrainWorld.x+vTerrainWorld.y*0.37,vTerrainWorld.z+vTerrainWorld.y*0.61)*7.0));\n'+
      [0,1,2,3,4,5].map(face=>{
        const axis=['x','x','y','y','z','z'][face],sign=face%2===0?'-':'+'
        return '{vec4 neighbour=texture2D(terrainBlendPalette,vec2('+((face+0.5)/6).toFixed(8)+',(vTerrainBlendIndex+0.5)/terrainBlendRows));float weight=0.5*(1.0-smoothstep(0.0,terrainWidth,0.5'+sign+'vTerrainLocal.'+axis+'))*(1.0-abs(normalize(vTerrainNormal).'+axis+'))*neighbour.a;terrainDelta+=(neighbour.rgb-terrainBase)*weight;terrainWeight+=weight;}\n'
      }).join('')+
      'diffuseColor.rgb=terrainBase+terrainDelta/max(1.0,terrainWeight);')
  }
  mesh.geometry=geometry;mesh.material=material
  return {geometry,material,texture}
}
