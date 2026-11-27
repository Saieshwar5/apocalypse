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

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocalNormal;

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
    vec3 normal = perturbNormal(vWorldPosition, geometricNormal, detail.r * bumpScale);

    float sunOrientation = dot(geometricNormal, sunDirection);
    float dayStrength = smoothstep(-0.25, 0.5, sunOrientation);
    float diffuse = max(dot(normal, sunDirection), 0.0);

    vec3 dayColor = texture2D(dayMap, vUv).rgb;
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
    gl_FragColor = vec4(vec3(light * 0.95 + 0.015), cloud * (0.92 - edgeFade * 0.45));
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
