import { Container, Graphics } from 'pixi.js';
import type { Camera, Size } from '../utils/coordinates';
import { ProceduralEnvironment } from '../environment/ProceduralEnvironment';
import type { EnvironmentLayerToggles, EnvironmentStats } from '../environment/decorationTypes';

export const BACKGROUND_OVERLAY_COLOR = 0x000000;
export const BACKGROUND_OVERLAY_ALPHA = 0;

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
 * Solid black background canvas with zero circle, dot, or cosmic decorations.
 */
export class BackgroundManager {
  /** BackgroundContainer holding any background geometry (empty for solid black). */
  readonly tileLayer = new Container();

  /** AtmosphereContainer: screen-space veil (cleared for solid black). */
  readonly overlay = new Graphics();

  /** Code-generated procedural cosmos (kept idle and unmounted for pure black). */
  readonly environment = new ProceduralEnvironment();

  private destroyed = false;

  async init(): Promise<void> {
    // Solid pure black: do not mount procedural cosmos decorations
    this.tileLayer.removeChildren();
    this.overlay.clear();
  }

  needsFrame(): boolean {
    return false;
  }

  update(_camera: Camera, _size: Size, _dpr = 1): void {
    if (this.destroyed) return;
    this.overlay.clear();
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
  }

  destroy(): void {
    this.destroyed = true;
    this.environment.destroy();
    this.tileLayer.destroy({ children: true });
    this.overlay.destroy();
  }
}
