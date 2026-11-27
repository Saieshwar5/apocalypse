import * as THREE from 'three';

/** Look of one asteroid type, on top of the standard material settings. */
export interface RockSurfaceLook {
  /** RG = normal XY, B = albedo shade, A = gloss. See rockTextures.ts. */
  detailMap: THREE.Texture;
  /** Repeats per object-space unit for the broad and the fine layer. */
  tiling: [number, number];
  /** Bump strength of the broad and the fine layer. */
  bump: [number, number];
  /** Colour the surface takes where the shade channel is darkest. */
  darkTint: THREE.Color;
  /** How much the gloss channel lowers roughness. */
  glossSmoothing: number;
  /** How much the gloss channel raises metalness. */
  glossMetal: number;
  /** Light that seems to come from inside; strongest towards the limb. */
  innerGlow: THREE.Color;
}

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

/**
 * Standard material with procedural rock detail projected from the three
 * object axes (triplanar), so the geometry needs no UVs and shows no seams.
 * Every instance compiles to the same program; the per-type look and the
 * per-asteroid detail scale travel in uniforms.
 */
export class RockSurfaceMaterial extends THREE.MeshStandardMaterial {
  look: RockSurfaceLook | null = null;
  /**
   * Multiplies the tiling. Small rocks use less than 1 so their craters do
   * not look like a shrunken copy of a giant's.
   */
  readonly detailScale = { value: 1 };

  override copy(source: this): this {
    super.copy(source);
    // The look is shared on purpose: clones must reuse the same texture.
    this.look = source.look;
    this.detailScale.value = source.detailScale.value;
    return this;
  }

  override onBeforeCompile(shader: Shader): void {
    const look = this.look;
    if (!look) {
      throw new Error('RockSurfaceMaterial needs a look before it is rendered');
    }
    Object.assign(shader.uniforms, {
      uRockMap: { value: look.detailMap },
      uRockTiling: { value: new THREE.Vector2(...look.tiling) },
      uRockBump: { value: new THREE.Vector2(...look.bump) },
      uRockDarkTint: { value: look.darkTint },
      uRockGloss: { value: new THREE.Vector2(look.glossSmoothing, look.glossMetal) },
      uRockGlow: { value: look.innerGlow },
      uRockScale: this.detailScale,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_SAMPLE}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAGMENT_METALNESS}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_GLOW}`);
  }
}

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vRockPosition;
varying vec3 vRockNormal;
`;

// Object space, so the detail stays glued to the rock as it tumbles.
const VERTEX_BODY = /* glsl */ `
vRockPosition = position;
vRockNormal = normal;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform sampler2D uRockMap;
uniform vec2 uRockTiling;
uniform vec2 uRockBump;
uniform vec3 uRockDarkTint;
uniform vec2 uRockGloss;
uniform vec3 uRockGlow;
uniform float uRockScale;
uniform mat3 normalMatrix;
varying vec3 vRockPosition;
varying vec3 vRockNormal;

vec3 rockNormal;
float rockShade;
float rockGloss;

// One triplanar layer: adds its bent normal to normalSum (whiteout blend,
// which keeps bumps upright on all six sides) and returns shade and gloss.
vec2 rockLayer(vec3 position, vec3 normal, vec3 weights, float bump, inout vec3 normalSum) {
  vec4 sampleX = texture2D(uRockMap, position.zy);
  vec4 sampleY = texture2D(uRockMap, position.xz);
  vec4 sampleZ = texture2D(uRockMap, position.xy);
  vec2 tiltX = (sampleX.xy * 2.0 - 1.0) * bump;
  vec2 tiltY = (sampleY.xy * 2.0 - 1.0) * bump;
  vec2 tiltZ = (sampleZ.xy * 2.0 - 1.0) * bump;
  normalSum += vec3(normal.x, tiltX.y + normal.y, tiltX.x + normal.z) * weights.x;
  normalSum += vec3(tiltY.x + normal.x, normal.y, tiltY.y + normal.z) * weights.y;
  normalSum += vec3(tiltZ.x + normal.x, tiltZ.y + normal.y, normal.z) * weights.z;
  return sampleX.zw * weights.x + sampleY.zw * weights.y + sampleZ.zw * weights.z;
}
`;

const FRAGMENT_SAMPLE = /* glsl */ `
{
  vec3 surfaceNormal = normalize(vRockNormal);
  vec3 weights = pow(abs(surfaceNormal), vec3(4.0));
  weights /= weights.x + weights.y + weights.z;
  vec3 normalSum = vec3(0.0);
  vec2 broad = rockLayer(vRockPosition * uRockTiling.x * uRockScale, surfaceNormal, weights, uRockBump.x, normalSum);
  // Offset and unrelated frequency, so the two layers never line up.
  vec2 fine = rockLayer(vRockPosition * uRockTiling.y * uRockScale + 0.37, surfaceNormal, weights, uRockBump.y, normalSum);
  rockNormal = normalize(normalSum);
  rockShade = clamp(broad.x * 0.65 + fine.x * 0.55 - 0.1, 0.0, 1.0);
  rockGloss = clamp(broad.y * 0.6 + fine.y * 0.6, 0.0, 1.0);
  diffuseColor.rgb *= mix(uRockDarkTint, vec3(1.0), rockShade);
}
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
roughnessFactor = clamp(roughnessFactor - rockGloss * uRockGloss.x, 0.05, 1.0);
`;

const FRAGMENT_METALNESS = /* glsl */ `
metalnessFactor = clamp(metalnessFactor + rockGloss * uRockGloss.y, 0.0, 1.0);
`;

const FRAGMENT_NORMAL = /* glsl */ `
normal = normalize(normalMatrix * rockNormal);
`;

// Added on top of the emissive colour, which the asteroid field overwrites
// every frame for hit flashes and entry heating.
const FRAGMENT_GLOW = /* glsl */ `
{
  float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float limb = 1.0 - facing;
  totalEmissiveRadiance += uRockGlow * (0.25 + limb * limb) * (0.5 + rockShade * 0.5);
}
`;
