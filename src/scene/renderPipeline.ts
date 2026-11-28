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
  private readonly renderPass: RenderPass;

  constructor(
    canvas: HTMLCanvasElement,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Only the launch-pad scene has shadow-casting lights.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
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

  /**
   * Low quality renders at one pixel per CSS pixel and skips bloom, which
   * roughly halves the work on high-density screens and weak GPUs.
   */
  setQuality(quality: 'low' | 'high'): void {
    this.renderer.setPixelRatio(quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 2));
    this.bloom.enabled = quality === 'high';
    this.resize();
  }

  /** Switches between the orbital scene and the launch-pad scene. */
  setScene(scene: THREE.Scene): void {
    this.renderPass.scene = scene;
  }

  render(): void {
    this.composer.render();
  }
}
