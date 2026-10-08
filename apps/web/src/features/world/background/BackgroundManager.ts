import { Container, Graphics } from 'pixi.js';
import type { Camera, Size } from '../utils/coordinates';
import { ProceduralEnvironment } from '../environment/ProceduralEnvironment';
import type { EnvironmentLayerToggles, EnvironmentStats } from '../environment/decorationTypes';

export const BACKGROUND_OVERLAY_COLOR = 0x02040c;
export const BACKGROUND_OVERLAY_ALPHA = 0.22;

export interface BackgroundDebugStats {
  worldX: number;
  worldY: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  rendererWidth: number;
  rendererHeight: number;
  environment: EnvironmentStats;
  toggles: EnvironmentLayerToggles;
}

/**
 * Top-level background manager interfacing with WorldRenderer.
 * Houses the pure code-generated procedural cosmos (StarField, Nebula, OrbitalRings,
 * SpatialNodes, ConnectionPaths, Planets, and FloatingStructures).
 * Operates in world coordinates with zero raster background images.
 */
export class BackgroundManager {
  /** BackgroundContainer holding the Procedural Environment. */
  readonly tileLayer = new Container();

  /** AtmosphereContainer: screen-space dark veil for grid/card contrast. */
  readonly overlay = new Graphics();

  /** Code-generated procedural cosmos. */
  readonly environment = new ProceduralEnvironment();

  private changed = true;
  private destroyed = false;

  async init(): Promise<void> {
    this.tileLayer.addChild(this.environment.container);
    this.changed = true;
  }

  needsFrame(): boolean {
    return this.changed || this.environment.needsFrame();
  }

  update(camera: Camera, size: Size, _dpr = 1): void {
    if (this.destroyed || !size.width || !size.height) return;
    this.changed = false;

    // Screen-space dark veil
    this.overlay.clear();
    this.overlay.rect(0, 0, size.width, size.height).fill({
      color: BACKGROUND_OVERLAY_COLOR,
      alpha: BACKGROUND_OVERLAY_ALPHA,
    });

    // Directly bind background container to camera world transform
    this.tileLayer.position.set(size.width / 2, size.height / 2);
    this.tileLayer.scale.set(camera.zoom);

    // Update Procedural Environment
    this.environment.update(camera, size);
  }

  getDebugStats(camera: Camera, size: Size): BackgroundDebugStats {
    return {
      worldX: Math.round(camera.x),
      worldY: Math.round(camera.y),
      cameraX: Math.round(camera.x),
      cameraY: Math.round(camera.y),
      cameraZoom: Number((camera.zoom * 100).toFixed(1)),
      rendererWidth: size.width,
      rendererHeight: size.height,
      environment: this.environment.getStats(),
      toggles: this.environment.getToggles(),
    };
  }

  setLayerToggle<K extends keyof EnvironmentLayerToggles>(key: K, value: boolean): void {
    this.environment.setToggle(key, value);
    this.changed = true;
  }

  destroy(): void {
    this.destroyed = true;
    this.environment.destroy();
    this.tileLayer.destroy({ children: true });
    this.overlay.destroy();
  }
}
