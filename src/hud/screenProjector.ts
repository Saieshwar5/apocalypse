import * as THREE from 'three';

export interface ScreenPoint {
  x: number;
  y: number;
  /** True when in front of the camera and inside the viewport. */
  visible: boolean;
  /** Distance in front of the camera; zero or negative when behind it. */
  depth: number;
}

/** Converts world positions to overlay-canvas pixels for one frame's camera. */
export class ScreenProjector {
  width = 0;
  height = 0;
  private camera: THREE.PerspectiveCamera | null = null;
  private readonly cameraSpace = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();

  setFrame(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    this.camera = camera;
    this.width = width;
    this.height = height;
  }

  project(position: THREE.Vector3): ScreenPoint {
    const camera = this.requireCamera();
    this.cameraSpace.copy(position).applyMatrix4(camera.matrixWorldInverse);
    const depth = -this.cameraSpace.z;
    if (depth <= 0.01) {
      // Behind the camera: return a far point in the right direction so an
      // edge arrow can still point at it.
      const length = Math.hypot(this.cameraSpace.x, this.cameraSpace.y) || 1;
      return {
        x: this.width / 2 + (this.cameraSpace.x / length) * this.width,
        y: this.height / 2 - (this.cameraSpace.y / length) * this.height,
        visible: false,
        depth,
      };
    }
    this.projected.copy(position).project(camera);
    const x = ((this.projected.x + 1) / 2) * this.width;
    const y = ((1 - this.projected.y) / 2) * this.height;
    return { x, y, visible: x >= 0 && x <= this.width && y >= 0 && y <= this.height, depth };
  }

  /** True when a sphere of `radius` at the origin sits between the camera and `position`. */
  hiddenBehindSphere(position: THREE.Vector3, radius: number): boolean {
    const eye = this.requireCamera().position;
    const toPoint = this.cameraSpace.copy(position).sub(eye);
    const length = toPoint.length();
    if (length < 1e-6) {
      return false;
    }
    toPoint.divideScalar(length);
    // Closest approach of the sight line to the planet's centre.
    const along = -eye.dot(toPoint);
    if (along <= 0 || along >= length) {
      return false;
    }
    return eye.lengthSq() - along * along < radius * radius;
  }

  /** On-screen radius in pixels of a sphere at the given depth. */
  projectedRadius(radius: number, depth: number): number {
    const camera = this.requireCamera();
    const focal = this.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return (radius / Math.max(depth, 0.01)) * focal;
  }

  private requireCamera(): THREE.PerspectiveCamera {
    if (!this.camera) {
      throw new Error('ScreenProjector.setFrame must be called before projecting');
    }
    return this.camera;
  }
}
