import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Renderer plus post-processing. Rendering happens in linear HDR into a
 * multisampled target; bloom picks up anything brighter than 1.0 (engines,
 * lasers, explosions, the sun), then OutputPass applies ACES tone mapping and
 * sRGB conversion once for the whole frame.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(
    canvas: HTMLCanvasElement,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  /** Builds a simple space environment so metal surfaces have something to reflect. */
  createSpaceEnvironment(sunDirection: THREE.Vector3): THREE.Texture {
    const environment = new THREE.Scene();
    environment.background = new THREE.Color(0x020308);
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(40, 36, 30) }),
    );
    sun.position.copy(sunDirection).multiplyScalar(60);
    environment.add(sun);
    const planetGlow = new THREE.Mesh(
      new THREE.SphereGeometry(30, 16, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.1, 0.22) }),
    );
    planetGlow.position.set(0, -70, 0);
    environment.add(planetGlow);
    const generator = new THREE.PMREMGenerator(this.renderer);
    const texture = generator.fromScene(environment, 0.04).texture;
    generator.dispose();
    return texture;
  }
}
