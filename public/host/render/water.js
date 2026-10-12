// Material de agua compartilhado (terreno e rio da Ponte): duas camadas de ondulacao com escalas/velocidades diferentes
// (sem tiling visivel), cor por profundidade (turquesa raso -> azul fundo), borda suave e espuma irregular na margem.
// Com `depth` o atributo `aDepth` (nivel da agua - altura do fundo) e interpolado por fragmento: a margem acompanha a isolinha
// da profundidade (curva), nao a grade da malha.
import * as THREE from 'three';
import * as TX from './textures.js';

const NL = String.fromCharCode(10);

export function makeWaterMaterial({ depth = true, flat = 3 } = {}) {
  const map = TX.oceanTexture();
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.16, metalness: 0.12, transparent: true, depthWrite: false });
  const uTime = { value: 0 };
  mat.userData.uTime = uTime;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', ['#include <common>', 'attribute float aDepth;', 'varying float vDepth;'].join(NL))
      .replace('#include <begin_vertex>', ['#include <begin_vertex>', depth ? 'vDepth = aDepth;' : `vDepth = ${flat.toFixed(2)};`].join(NL));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', ['#include <common>', 'uniform float uTime;', 'varying float vDepth;'].join(NL))
      .replace('#include <map_fragment>', [
        'float wd = vDepth;',
        'vec2 wuA = vMapUv * 0.8 + vec2( uTime * 0.012, uTime * 0.007 );',
        'vec2 wuB = vMapUv * 2.1 + vec2( -uTime * 0.02, uTime * 0.011 ) + 0.37;',
        'float wa = texture2D( map, wuA ).g, wb = texture2D( map, wuB ).g;',
        'float wv = wa * 0.6 + wb * 0.4;',
        'float wk = smoothstep( 0.1, 7.0, wd );',
        'vec3 wcol = mix( vec3( 0.12, 0.45, 0.43 ), vec3( 0.015, 0.14, 0.32 ), wk );',
        'wcol *= 0.7 + 0.7 * wv;',
        'wcol += vec3( 0.05, 0.09, 0.1 ) * smoothstep( 0.55, 0.9, wv ) * ( 1.0 - wk * 0.5 );',
        'float wn = texture2D( map, vMapUv * 3.1 + vec2( uTime * 0.02, 0.0 ) ).r;',
        'float we = wd + ( wn - 0.5 ) * 0.7;',
        'float wfoam = smoothstep( 0.0, 0.1, we ) * ( 1.0 - smoothstep( 0.18, 0.5, we ) );',
        'wfoam += 0.35 * smoothstep( 0.45, 0.75, we + 0.3 * sin( uTime * 0.9 + wn * 6.0 ) ) * ( 1.0 - smoothstep( 0.75, 1.2, we ) );',
        'wcol = mix( wcol, vec3( 0.93, 0.97, 1.0 ), clamp( wfoam, 0.0, 1.0 ) * 0.75 );',
        'diffuseColor.rgb = wcol;',
        'diffuseColor.a = max( smoothstep( -0.05, 0.9, wd ) * 0.92, clamp( wfoam, 0.0, 1.0 ) * 0.7 );',
      ].join(NL));
  };
  mat.customProgramCacheKey = () => (depth ? 'water-depth' : 'water-flat');
  return mat;
}
