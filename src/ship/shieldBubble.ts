import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying vec3 vLocalPosition;

  void main() {
    vLocalPosition = normalize(position);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  uniform vec3 hitDirection;
  uniform float hitStrength;
  uniform float time;

  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying vec3 vLocalPosition;

  void main() {
    float rim = pow(1.0 - abs(dot(vNormal, vViewDirection)), 2.5);
    // Hexagon-like ripple bands so the field reads as energy, not glass.
    float bands = 0.5 + 0.5 * sin(vLocalPosition.y * 40.0 + time * 6.0) * sin(vLocalPosition.x * 34.0);
    float hitSpot = pow(max(dot(vLocalPosition, hitDirection), 0.0), 6.0) * hitStrength;
    float alpha = rim * strength * (0.6 + bands * 0.4) + hitSpot * (0.7 + bands * 0.6);
    gl_FragColor = vec4(color * alpha, 1.0);
  }
`;

/**
 * Energy shield around the ship. Normally invisible; it flares where a hit
 * lands so the player sees the shield doing its job, and flickers red when
 * it is nearly gone.
 */
export class ShieldBubble {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private glow = 0;
  private hit = 0;
  private time = 0;

  constructor() {
    this.uniforms = {
      color: { value: new THREE.Color(0.4, 1.0, 1.8) },
      strength: { value: 0 },
      hitDirection: { value: new THREE.Vector3(0, 0, -1) },
      hitStrength: { value: 0 },
      time: { value: 0 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    // Sized to the Blender interceptor: about 1 unit wide and 2 long.
    this.mesh.scale.set(0.72, 0.42, 1.2);
    this.mesh.visible = false;
  }

  /**
   * Shows a hit. `localDirection` points from the ship's centre towards the
   * source, in the ship's own frame. `fraction` is how much of the hit the
   * shield absorbed (0..1).
   */
  flash(localDirection: THREE.Vector3, fraction: number): void {
    (this.uniforms.hitDirection.value as THREE.Vector3).copy(localDirection).normalize();
    this.hit = Math.min(1.5, this.hit + 0.6 + fraction);
    this.glow = Math.min(1, this.glow + 0.5);
  }

  update(deltaSeconds: number, shieldFraction: number): void {
    this.time += deltaSeconds;
    this.hit = Math.max(0, this.hit - deltaSeconds * 2.5);
    this.glow = Math.max(0, this.glow - deltaSeconds * 1.5);
    const weak = shieldFraction < 0.25 && shieldFraction > 0 ? 0.25 + 0.25 * Math.sin(this.time * 14) : 0;
    this.uniforms.strength.value = this.glow + weak;
    this.uniforms.hitStrength.value = this.hit;
    this.uniforms.time.value = this.time;
    (this.uniforms.color.value as THREE.Color).setRGB(
      shieldFraction < 0.25 ? 1.8 : 0.4,
      shieldFraction < 0.25 ? 0.5 : 1.0,
      shieldFraction < 0.25 ? 0.3 : 1.8,
    );
    this.mesh.visible = this.glow > 0.01 || this.hit > 0.01 || weak > 0;
  }
}
