/** Maximum craters the surface shader tracks; the oldest is replaced after that. */
export const MAX_IMPACTS = 40;

const SHARED_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocalNormal;

  void main() {
    vUv = uv;
    vLocalNormal = normalize(position);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const SURFACE_VERTEX = SHARED_VERTEX;
export const CLOUDS_VERTEX = SHARED_VERTEX;
export const ATMOSPHERE_VERTEX = SHARED_VERTEX;

/**
 * Day texture lit by the sun, city lights on the night side, a soft
 * terminator, ocean sun glint, terrain relief from the bump channel, an
 * atmospheric tint at the limb and impact scars that black out city lights.
 * The detail map holds bump (R), roughness (G) and clouds (B).
 */
export const SURFACE_FRAGMENT = /* glsl */ `
  #define MAX_IMPACTS ${MAX_IMPACTS}
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D detailMap;
  uniform vec3 sunDirection;
  uniform vec3 atmosphereDayColor;
  uniform vec3 atmosphereTwilightColor;
  uniform float bumpScale;
  uniform vec4 impacts[MAX_IMPACTS];
  uniform float impactHeat[MAX_IMPACTS];
  uniform int impactCount;
  /** Cloud layer's extra turn relative to the ground, in UV units, for shadows. */
  uniform float cloudShift;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocalNormal;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float valueNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z
    );
  }

  // Fine mottling that the photographs are too coarse to hold. It fades in
  // only near the surface, where the stretched texture would look smooth.
  float closeDetail(vec3 direction, float nearness) {
    float coarse = valueNoise(direction * 90.0);
    float fine = valueNoise(direction * 260.0);
    return (coarse * 0.6 + fine * 0.4 - 0.5) * nearness;
  }

  vec3 perturbNormal(vec3 surfacePosition, vec3 surfaceNormal, float height) {
    vec3 dpdx = dFdx(surfacePosition);
    vec3 dpdy = dFdy(surfacePosition);
    float dhdx = dFdx(height);
    float dhdy = dFdy(height);
    vec3 r1 = cross(dpdy, surfaceNormal);
    vec3 r2 = cross(surfaceNormal, dpdx);
    float determinant = dot(dpdx, r1);
    vec3 gradient = sign(determinant) * (dhdx * r1 + dhdy * r2);
    return normalize(abs(determinant) * surfaceNormal - gradient);
  }

  void main() {
    vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
    vec3 geometricNormal = normalize(vWorldNormal);
    vec4 detail = texture2D(detailMap, vUv);
    float nearness = 1.0 - smoothstep(12.0, 70.0, distance(cameraPosition, vWorldPosition));
    float mottle = closeDetail(normalize(vLocalNormal), nearness);
    vec3 normal = perturbNormal(vWorldPosition, geometricNormal, (detail.r + mottle * 0.35) * bumpScale);

    float sunOrientation = dot(geometricNormal, sunDirection);
    float dayStrength = smoothstep(-0.25, 0.5, sunOrientation);
    float diffuse = max(dot(normal, sunDirection), 0.0);

    vec3 dayColor = texture2D(dayMap, vUv).rgb * (1.0 + mottle * 0.28);
    vec3 nightColor = texture2D(nightMap, vUv).rgb;

    float scar = 0.0;
    float blackout = 0.0;
    float heat = 0.0;
    for (int i = 0; i < MAX_IMPACTS; i++) {
      if (i >= impactCount) break;
      vec4 impact = impacts[i];
      float angle = acos(clamp(dot(vLocalNormal, impact.xyz), -1.0, 1.0));
      float crater = 1.0 - smoothstep(impact.w * 0.3, impact.w, angle);
      scar = max(scar, crater);
      blackout = max(blackout, 1.0 - smoothstep(impact.w, impact.w * 3.0, angle));
      heat = max(heat, crater * crater * impactHeat[i]);
    }
    dayColor = mix(dayColor, dayColor * vec3(0.2, 0.16, 0.13), scar * 0.9);
    // Cloud shadows: the cloud layer sampled a little towards the sun, darkening the ground.
    vec2 shadowUv = vec2(fract(vUv.x - cloudShift + dot(sunDirection, vec3(0.004, 0.0, 0.0))), vUv.y + 0.003);
    float shadow = smoothstep(0.25, 1.0, texture2D(detailMap, shadowUv).b);
    dayColor *= 1.0 - shadow * 0.38;
    nightColor *= 1.0 - blackout;

    float roughness = detail.g;
    vec3 halfVector = normalize(sunDirection - viewDirection);
    float glint = pow(max(dot(normal, halfVector), 0.0), 45.0) * (1.0 - roughness) * dayStrength;

    vec3 color = dayColor * (diffuse * 1.15 + 0.012);
    color += nightColor * (1.0 - dayStrength) * 1.9;
    color += vec3(1.0, 0.9, 0.75) * glint * 0.6;

    float fresnel = pow(1.0 - max(dot(geometricNormal, -viewDirection), 0.0), 3.0);
    vec3 atmosphereColor = mix(
      atmosphereTwilightColor,
      atmosphereDayColor,
      smoothstep(-0.25, 0.75, sunOrientation)
    );
    color = mix(color, atmosphereColor, fresnel * smoothstep(-0.5, 1.0, sunOrientation) * 0.85);

    color += vec3(1.0, 0.36, 0.08) * heat * 4.0;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const CLOUDS_FRAGMENT = /* glsl */ `
  uniform sampler2D detailMap;
  uniform vec3 sunDirection;
  uniform float time;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocalNormal;

  void main() {
    float cloud = smoothstep(0.18, 1.0, texture2D(detailMap, vUv).b);
    vec3 normal = normalize(vWorldNormal);
    float light = smoothstep(-0.15, 0.45, dot(normal, sunDirection));
    vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
    float edgeFade = pow(1.0 - max(dot(normal, -viewDirection), 0.0), 2.0);
    // Night-side storms: thick cloud cells flicker with lightning now and then.
    vec2 cell = floor(vUv * vec2(180.0, 90.0));
    float beat = floor(time * 7.0);
    float storm = step(0.9965, hash(cell + beat * 0.137)) * step(0.55, cloud) * (1.0 - light);
    vec2 inCell = fract(vUv * vec2(180.0, 90.0)) - 0.5;
    float flash = storm * (1.0 - smoothstep(0.0, 0.5, length(inCell))) * (0.6 + 0.4 * sin(time * 90.0));
    vec3 lit = vec3(light * 0.95 + 0.015) + vec3(0.75, 0.82, 1.0) * flash * 2.5;
    gl_FragColor = vec4(lit, max(cloud * (0.92 - edgeFade * 0.45), flash));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Auroras: curtains of green and violet light in a ring around each
 * magnetic pole, on the night side, rippling slowly. Solar storms brighten
 * them and push them towards the equator.
 */
export const AURORA_FRAGMENT = /* glsl */ `
  uniform vec3 sunDirection;
  uniform float time;
  uniform float strength;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocalNormal;

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    float latitude = asin(clamp(abs(vLocalNormal.y), 0.0, 1.0));
    float longitude = atan(vLocalNormal.z, vLocalNormal.x);
    float centre = radians(mix(68.0, 58.0, clamp(strength - 1.0, 0.0, 1.0)));
    float wave = 0.035 * sin(longitude * 3.0 + time * 0.15) + 0.02 * sin(longitude * 7.0 - time * 0.23);
    float offset = latitude - centre - wave;
    // Sharp lower edge, soft upper glow, like real curtains.
    float band = offset < 0.0
      ? 1.0 - smoothstep(0.0, radians(1.2 + strength), -offset)
      : 1.0 - smoothstep(0.0, radians(3.5 + 3.0 * strength), offset);
    float folds = noise(vec2(longitude * 9.0 + time * 0.25, time * 0.1)) * 0.6
      + noise(vec2(longitude * 31.0 - time * 0.6, time * 0.3)) * 0.3
      + noise(vec2(longitude * 83.0 + time * 1.1, 4.0)) * 0.1;
    float curtain = smoothstep(0.35, 0.85, folds);
    float night = 1.0 - smoothstep(-0.2, 0.15, dot(normalize(vWorldNormal), sunDirection));
    vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
    float edge = 0.35 + 0.65 * pow(1.0 - abs(dot(normalize(vWorldNormal), viewDirection)), 1.5);
    vec3 green = vec3(0.2, 1.0, 0.55);
    vec3 violet = vec3(0.65, 0.3, 1.0);
    vec3 color = mix(green, violet, smoothstep(0.2, 1.0, max(offset, 0.0) / radians(4.0 + 3.0 * strength)));
    float alpha = band * curtain * night * edge * strength * 0.6;
    gl_FragColor = vec4(color * alpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Glow shell rendered from the inside (back faces). Brightness depends on how
 * close the view ray passes to the planet, so the halo is thin and bright at
 * the horizon, fades into space and is coloured orange near the terminator.
 */
export const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 sunDirection;
  uniform float planetRadius;
  uniform float atmosphereRadius;
  uniform vec3 dayColor;
  uniform vec3 twilightColor;
  uniform float intensity;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocalNormal;

  void main() {
    vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
    float along = max(-dot(cameraPosition, rayDirection), 0.0);
    vec3 closest = cameraPosition + rayDirection * along;
    float height = max(length(closest), 0.0001);
    float density = pow(1.0 - smoothstep(planetRadius, atmosphereRadius, height), 1.6);
    float sunAmount = dot(closest / height, sunDirection);
    vec3 color = mix(twilightColor, dayColor, smoothstep(-0.05, 0.45, sunAmount));
    float light = smoothstep(-0.3, 0.2, sunAmount);
    gl_FragColor = vec4(color * density * light * intensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
