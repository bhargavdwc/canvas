import { Container } from 'pixi.js';
import type { Camera, Size } from '../utils/coordinates';
import { ProceduralDecorationManager } from './ProceduralDecorationManager';
import type { EnvironmentLayerToggles, EnvironmentStats } from './decorationTypes';

/**
 * Layer 1: Procedural Environment.
 * Houses the entire code-generated visual universe (StarField, Nebula, OrbitalRings,
 * SpatialNodes, ConnectionPaths, Planets, and FloatingStructures).
 * Operates in pure world coordinates, tracking camera pan and zoom with zero large images.
 */
export class ProceduralEnvironment {
  readonly container = new Container();
  readonly manager = new ProceduralDecorationManager();

  private destroyed = false;

  constructor() {
    this.container.addChild(this.manager.container);
  }

  getToggles(): EnvironmentLayerToggles {
    return this.manager.getToggles();
  }

  setToggle<K extends keyof EnvironmentLayerToggles>(key: K, value: boolean): void {
    this.manager.setToggle(key, value);
  }

  setAllToggles(toggles: Partial<EnvironmentLayerToggles>): void {
    this.manager.setAllToggles(toggles);
  }

  needsFrame(): boolean {
    return this.manager.needsFrame();
  }

  update(camera: Camera, size: Size): void {
    if (this.destroyed || size.width === 0 || size.height === 0) return;

    // Center environment container to camera world position
    this.container.position.set(-camera.x, camera.y);

    // Update chunk culling, multi-scale LOD, and active geometry
    this.manager.update(camera, size);
  }

  getStats(): EnvironmentStats {
    return this.manager.getStats();
  }

  destroy(): void {
    this.destroyed = true;
    this.manager.destroy();
    this.container.destroy({ children: true });
  }
}
