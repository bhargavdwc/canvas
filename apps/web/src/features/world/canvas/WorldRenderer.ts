import { Application, Container, Graphics, Text, type Ticker } from 'pixi.js';
import { WORLD_HALF_EXTENT, type WorldBounds, type WorldMessage } from '@canvas/shared-types';
import { useWorldStore } from '../store/worldStore';
import { fetchMessagesInBounds } from '../services/worldApi';
import {
  clamp,
  clampCamera,
  clampZoom,
  screenToWorld,
  zoomAt,
  type Camera,
  type Size,
  WORLD_MIN_X,
  WORLD_MAX_X,
  WORLD_MIN_Y,
  WORLD_MAX_Y,
} from '../utils/coordinates';
import { ChunkedMessageCache } from '../utils/messageCache';
import { boundsContain, expandBounds, getViewportBounds, padBounds } from '../utils/viewport';
import { BackgroundManager } from '../background/BackgroundManager';
import type { EnvironmentLayerToggles } from '../environment/decorationTypes';

/** Base world grid cell size. Every box and card snaps to this exact size. */
export const BOX_SIZE = 100;
export const CARD_W = BOX_SIZE;
export const CARD_H = BOX_SIZE;

/**
 * Splits text into wrapped lines based on character budget per line,
 * breaking paragraphs on explicit newlines and long continuous words on character limits.
 */
export function estimateWrappedLines(content: string, charsPerLine: number): string[] {
  const text = content.trim();
  if (!text) return [];

  const rawParagraphs = text.split('\n');
  const result: string[] = [];

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const rawWord of words) {
      let word = rawWord;

      // Long unbroken words wrap across lines smoothly
      while (word.length > charsPerLine) {
        if (currentLine) {
          result.push(currentLine);
          currentLine = '';
        }
        result.push(word.slice(0, charsPerLine));
        word = word.slice(charsPerLine);
      }

      if (!word) continue;

      if (!currentLine) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= charsPerLine) {
        currentLine += ` ${word}`;
      } else {
        result.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

const CANDIDATE_BOX_SIZES: Array<{ cols: number; rows: number }> = [
  { cols: 1, rows: 1 }, // 100x100
  { cols: 2, rows: 1 }, // 200x100
  { cols: 2, rows: 2 }, // 200x200
  { cols: 3, rows: 2 }, // 300x200
  { cols: 3, rows: 3 }, // 300x300
  { cols: 4, rows: 3 }, // 400x300
  { cols: 4, rows: 4 }, // 400x400
  { cols: 5, rows: 4 }, // 500x400
  { cols: 5, rows: 5 }, // 500x500
  { cols: 6, rows: 5 }, // 600x500
  { cols: 6, rows: 6 }, // 600x600
];

const SINGLE_COL_CANDIDATE_SIZES: Array<{ cols: number; rows: number }> = [
  { cols: 1, rows: 1 },
  { cols: 1, rows: 2 },
  { cols: 1, rows: 3 },
  { cols: 1, rows: 4 },
  { cols: 1, rows: 5 },
  { cols: 1, rows: 6 },
];

/**
 * Calculates how many grid boxes a message occupies based on its text content length and layout.
 * Dynamically scales columns and rows based on text length and explicit line breaks
 * so large messages assign neighbor boxes seamlessly without overflowing.
 */
export function getBoxDimensions(content: string, maxCols?: number): {
  cols: number;
  rows: number;
  width: number;
  height: number;
} {
  const text = content.trim();
  if (!text) {
    return { cols: 1, rows: 1, width: BOX_SIZE, height: BOX_SIZE };
  }

  const pool = maxCols === 1
    ? SINGLE_COL_CANDIDATE_SIZES
    : maxCols
      ? CANDIDATE_BOX_SIZES.filter((c) => c.cols <= maxCols)
      : CANDIDATE_BOX_SIZES;

  for (const candidate of pool) {
    const charsPerLine = Math.max(10, Math.floor((candidate.cols * BOX_SIZE - 24) / 6.1));
    const maxLines = Math.max(1, Math.floor((candidate.rows * BOX_SIZE - 32) / 14.5));
    const lines = estimateWrappedLines(text, charsPerLine);

    if (lines.length <= maxLines) {
      return {
        cols: candidate.cols,
        rows: candidate.rows,
        width: candidate.cols * BOX_SIZE,
        height: candidate.rows * BOX_SIZE,
      };
    }
  }

  const largest = pool[pool.length - 1] || CANDIDATE_BOX_SIZES[0]!;
  return {
    cols: largest.cols,
    rows: largest.rows,
    width: largest.cols * BOX_SIZE,
    height: largest.rows * BOX_SIZE,
  };
}

/**
 * Formats message text to cleanly fit inside the assigned grid boxes.
 * Preserves natural line breaks and cleanly elides on word boundary if overflowing.
 */
export function formatBoxText(content: string, cols: number, rows: number): string {
  const text = content.trim();
  if (!text) return '';

  const charsPerLine = Math.max(10, Math.floor((cols * BOX_SIZE - 24) / 6.1));
  const maxLines = Math.max(1, Math.floor((rows * BOX_SIZE - 32) / 14.5));
  const lines = estimateWrappedLines(text, charsPerLine);

  if (lines.length <= maxLines) {
    return text;
  }

  const visible = lines.slice(0, maxLines);
  const lastIndex = maxLines - 1;
  const lastLine = visible[lastIndex] || '';

  if (lastLine.length > 3) {
    visible[lastIndex] = `${lastLine.slice(0, Math.max(1, lastLine.length - 2)).trimEnd()}…`;
  } else {
    visible[lastIndex] = '…';
  }

  return visible.join('\n');
}

/** Below this zoom, notes are drawn as dots (level of detail). */
const DOT_ZOOM = 0.08;
/** Below this zoom, cards are drawn without text. */
const TEXT_ZOOM = 0.45;
/** Max live card display objects kept around once off-screen. */
const CARD_POOL_LIMIT = 400;
const REQUEST_THROTTLE_MS = 120;
const CLICK_SLOP_PX = 5;

const ACCENTS = [0x818cf8, 0x22d3ee, 0xf472b6, 0xfbbf24, 0x34d399];

function accentIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % ACCENTS.length;
}

interface CardView {
  root: Container;
  textGroup: Container;
  body: Text | null;
  coord: Text | null;
  message: WorldMessage;
  cols: number;
  rows: number;
  width: number;
  height: number;
  bx: number;
  by: number;
  topY: number;
}

interface Flight {
  from: Camera;
  to: Camera;
  elapsed: number;
  duration: number;
}

/**
 * Imperative PixiJS renderer for the world. React owns the HUD; this class owns the canvas.
 * Rendering happens only when the camera, viewport size or data changed.
 *
 * Precision note: every display position is computed *relative to the camera* in float64
 * and the layers are centred on the screen, so large world coordinates never reach the GPU.
 */
export class WorldRenderer {
  private app: Application | null = null;
  private destroyed = false;

  /** Tiled deep-space artwork; always drawn beneath the grid and messages. */
  private background = new BackgroundManager();
  private gridLayer = new Graphics();
  private dotLayer = new Graphics();
  private cardLayer = new Container();
  private cards = new Map<string, CardView>();

  private cache = new ChunkedMessageCache();
  private loadedBounds: WorldBounds | null = null;
  private pendingBounds: WorldBounds | null = null;
  private abort: AbortController | null = null;
  private requestSeq = 0;
  private lastRequestAt = 0;

  private renderedCamera: Camera | null = null;
  private renderedSize: Size = { width: 0, height: 0 };
  private dirty = true;

  private flight: Flight | null = null;
  private unsubscribe: (() => void) | null = null;

  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private dragDistance = 0;
  private downAt = 0;
  private velocity = { x: 0, y: 0 }; // screen px per ms
  private lastMoveAt = 0;
  private inertia: { x: number; y: number } | null = null; // world units per ms

  constructor(private readonly host: HTMLElement) {}

  async init(): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: this.host,
      background: '#000000',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    if (this.destroyed) {
      app.destroy(true, { children: true });
      return;
    }
    this.app = app;
    const canvas = app.canvas;
    canvas.style.touchAction = 'none';
    canvas.style.display = 'block';
    canvas.setAttribute('aria-label', 'Infinite message canvas. Drag to pan, scroll to zoom.');
    canvas.setAttribute('role', 'application');
    this.host.appendChild(canvas);

    app.stage.addChild(
      this.background.tileLayer,
      this.background.overlay,
      this.gridLayer,
      this.cardLayer,
      this.dotLayer,
    );
    void this.background.init().then(() => {
      this.dirty = true;
    });
    app.ticker.add(this.tick);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);

    this.unsubscribe = useWorldStore.subscribe((state, prev) => {
      if (state.flyTo && state.flyTo !== prev.flyTo) this.startFlight(state.flyTo);
      if (state.lastCreatedMessage && state.lastCreatedMessage !== prev.lastCreatedMessage) {
        this.cache.upsertMany([state.lastCreatedMessage]);
        this.loadedBounds = null;
        this.dirty = true;
      }
      if (state.showDebugOverlay !== prev.showDebugOverlay) {
        this.dirty = true;
      }
      if (state.environmentToggles !== prev.environmentToggles) {
        for (const [k, v] of Object.entries(state.environmentToggles) as [keyof EnvironmentLayerToggles, boolean][]) {
          this.background.setLayerToggle(k, v);
        }
        this.dirty = true;
      }
    });
    // A fly-to may have been requested before the renderer was ready.
    const pending = useWorldStore.getState().flyTo;
    if (pending) this.startFlight(pending);
  }

  destroy(): void {
    this.destroyed = true;
    this.abort?.abort();
    this.unsubscribe?.();
    window.removeEventListener('keydown', this.onKeyDown);
    this.background.destroy();
    const app = this.app;
    if (!app) return;
    const canvas = app.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    app.ticker.remove(this.tick);
    app.destroy(true, { children: true });
    this.app = null;
  }

  // ---------------------------------------------------------------- frame loop

  private get size(): Size {
    const screen = this.app?.screen;
    return { width: screen?.width ?? 0, height: screen?.height ?? 0 };
  }

  private tick = (ticker: Ticker): void => {
    const dt = Math.min(ticker.deltaMS, 64);
    this.updateFlight(dt);
    this.updateInertia(dt);

    const store = useWorldStore.getState();
    const size = this.size;
    if (size.width === 0 || size.height === 0) return;

    let camera = store.camera;
    const clamped = clampCamera(camera, size);
    if (clamped.x !== camera.x || clamped.y !== camera.y || clamped.zoom !== camera.zoom) {
      this.setCamera(clamped);
      camera = clamped;
    }

    const sizeChanged =
      size.width !== this.renderedSize.width || size.height !== this.renderedSize.height;
    // Tile loads / cross-fades need repaints even when the camera is idle.
    if (this.background.needsFrame()) this.dirty = true;
    if (camera !== this.renderedCamera || sizeChanged || this.dirty) {
      this.render(camera, size);
      this.renderedCamera = camera;
      this.renderedSize = size;
      this.dirty = false;
    }
    if (store.showDebugOverlay) {
      store.setDebugStats(this.background.getDebugStats(camera, size));
    }
    this.maybeLoad(camera, size);
  };

  // ------------------------------------------------------------------ data

  private maybeLoad(camera: Camera, size: Size): void {
    const viewport = getViewportBounds(camera, size);
    if (this.loadedBounds && boundsContain(this.loadedBounds, viewport)) return;
    if (this.pendingBounds && boundsContain(this.pendingBounds, viewport)) return;
    const now = performance.now();
    if (now - this.lastRequestAt < REQUEST_THROTTLE_MS) return;
    this.lastRequestAt = now;

    const target = expandBounds(viewport, 1);
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const seq = ++this.requestSeq;
    this.pendingBounds = target;

    fetchMessagesInBounds(target, controller.signal)
      .then((messages) => {
        // Responses can arrive out of order; only the latest request wins.
        if (seq !== this.requestSeq || this.destroyed) return;
        this.cache.upsertMany(messages);
        this.cache.prune(target);
        this.loadedBounds = target;
        this.pendingBounds = null;
        this.dirty = true;
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (seq === this.requestSeq) this.pendingBounds = null;
        console.error('Failed to load messages', error);
      });
  }

  // ------------------------------------------------------------------ drawing

  private render(camera: Camera, size: Size): void {
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.background.update(camera, size, dpr);
    this.drawGrid(camera, size);

    const viewport = getViewportBounds(camera, size);
    const visible = this.cache.queryBounds(padBounds(viewport, 500));
    useWorldStore.getState().setVisibleCount(visible.length);

    if (camera.zoom < DOT_ZOOM) {
      this.cardLayer.visible = false;
      this.drawDots(visible, camera, size);
    } else {
      this.dotLayer.clear();
      this.cardLayer.visible = true;
      this.drawCards(visible, camera, size);
    }
  }

  private drawGrid(camera: Camera, size: Size): void {
    const g = this.gridLayer;
    g.clear();
    const { zoom } = camera;

    const minLimitX = WORLD_MIN_X;
    const maxLimitX = WORLD_MAX_X;
    const minLimitY = WORLD_MIN_Y;
    const maxLimitY = WORLD_MAX_Y;

    const view = getViewportBounds(camera, size);

    // Visible range clamped to the world boundary
    const clampedMinX = Math.max(minLimitX, view.minX);
    const clampedMaxX = Math.min(maxLimitX, view.maxX);
    const clampedMinY = Math.max(minLimitY, view.minY);
    const clampedMaxY = Math.min(maxLimitY, view.maxY);

    // If viewport is completely outside the world bounds, nothing inside the world to draw
    if (clampedMinX > clampedMaxX || clampedMinY > clampedMaxY) {
      return;
    }

    const sx = (x: number) => Math.round((x - camera.x) * zoom + size.width / 2) + 0.5;
    const sy = (y: number) => Math.round((camera.y - y) * zoom + size.height / 2) + 0.5;

    // 1-2-5 scale for smooth, consistent box density across all zoom levels
    // Target min box size ~ 18px so many boxes are visible even at 2% zoom (zoom = 0.02)
    const MIN_PX = 18;
    const minWorld = Math.max(BOX_SIZE, MIN_PX / zoom);
    const exp = Math.floor(Math.log10(minWorld));
    const base = 10 ** exp;

    let minor: number;
    let major: number;
    let skipMultiple: number;

    if (base >= minWorld) {
      minor = base;
      major = base * 5;
      skipMultiple = 5;
    } else if (base * 2 >= minWorld) {
      minor = base * 2;
      major = base * 10;
      skipMultiple = 5;
    } else if (base * 5 >= minWorld) {
      minor = base * 5;
      major = base * 25;
      skipMultiple = 5;
    } else {
      minor = base * 10;
      major = base * 50;
      skipMultiple = 5;
    }

    const minorPx = minor * zoom;
    const fade = clamp((minorPx - MIN_PX) / 8, 0, 1);
    // Dull, soft alpha values so lines are subtle on pure black
    const minorAlpha = 0.04 + 0.03 * fade;
    const majorAlpha = 0.12 + 0.03 * fade;

    const topScreenY = sy(clampedMaxY);
    const bottomScreenY = sy(clampedMinY);
    const leftScreenX = sx(clampedMinX);
    const rightScreenX = sx(clampedMaxX);

    const strokeLines = (step: number, skipMultipleOf: number | null, alpha: number) => {
      // Lines are strictly clamped within [minLimit, maxLimit]
      const x0 = Math.ceil(clampedMinX / step);
      const x1 = Math.floor(clampedMaxX / step);
      for (let i = x0; i <= x1; i++) {
        if (skipMultipleOf && i % skipMultipleOf === 0) continue;
        const px = sx(i * step);
        g.moveTo(px, topScreenY).lineTo(px, bottomScreenY);
      }
      const y0 = Math.ceil(clampedMinY / step);
      const y1 = Math.floor(clampedMaxY / step);
      for (let i = y0; i <= y1; i++) {
        if (skipMultipleOf && i % skipMultipleOf === 0) continue;
        const py = sy(i * step);
        g.moveTo(leftScreenX, py).lineTo(rightScreenX, py);
      }
      g.stroke({ width: 1, color: 0xffffff, alpha });
    };

    strokeLines(minor, skipMultiple, minorAlpha);
    strokeLines(major, null, majorAlpha);

    // World axes (0, 0) - dull center plus / crosshair lines
    if (view.minX <= 0 && view.maxX >= 0) {
      g.moveTo(sx(0), topScreenY).lineTo(sx(0), bottomScreenY);
    }
    if (view.minY <= 0 && view.maxY >= 0) {
      g.moveTo(leftScreenX, sy(0)).lineTo(rightScreenX, sy(0));
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.22 });

    // World border - subtle clean edge line at boundaries enclosing the world
    for (const edgeX of [minLimitX, maxLimitX]) {
      if (edgeX >= view.minX && edgeX <= view.maxX) {
        g.moveTo(sx(edgeX), topScreenY).lineTo(sx(edgeX), bottomScreenY);
      }
    }
    for (const edgeY of [minLimitY, maxLimitY]) {
      if (edgeY >= view.minY && edgeY <= view.maxY) {
        g.moveTo(leftScreenX, sy(edgeY)).lineTo(rightScreenX, sy(edgeY));
      }
    }
    g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
  }

  private drawDots(visible: WorldMessage[], camera: Camera, size: Size): void {
    const g = this.dotLayer;
    g.clear();
    const buckets: WorldMessage[][] = ACCENTS.map(() => []);
    for (const m of visible) buckets[accentIndex(m.id)]?.push(m);
    const r = Math.max(1.2, Math.min(2.5, camera.zoom * 40));
    buckets.forEach((bucket, i) => {
      if (bucket.length === 0) return;
      for (const m of bucket) {
        const { width, height } = getBoxDimensions(m.content);
        const bx = Math.floor(m.position.x / BOX_SIZE) * BOX_SIZE;
        const by = Math.floor(m.position.y / BOX_SIZE) * BOX_SIZE;
        const topY = by + BOX_SIZE;
        const centerX = bx + width / 2;
        const centerY = topY - height / 2;
        const px = (centerX - camera.x) * camera.zoom + size.width / 2;
        const py = (camera.y - centerY) * camera.zoom + size.height / 2;
        g.rect(px - r, py - r, r * 2, r * 2);
      }
      g.fill({ color: ACCENTS[i] as number, alpha: 0.9 });
    });
  }

  private drawCards(visible: WorldMessage[], camera: Camera, size: Size): void {
    this.cardLayer.position.set(size.width / 2, size.height / 2);
    this.cardLayer.scale.set(camera.zoom);
    const showText = camera.zoom >= TEXT_ZOOM;
    const seen = new Set<string>();

    for (const message of visible) {
      seen.add(message.id);
      let view = this.cards.get(message.id);
      if (!view) {
        view = this.createCard(message);
        this.cards.set(message.id, view);
        this.cardLayer.addChild(view.root);
      }
      view.root.visible = true;
      // Fixed top-left anchor: card expands smoothly to the right and downward on screen
      view.root.position.set(view.bx - camera.x, camera.y - view.topY);
      if (showText) this.ensureText(view);
      if (view.body) view.body.visible = showText;
      if (view.coord) view.coord.visible = showText;
    }

    for (const [id, view] of this.cards) {
      if (!seen.has(id)) view.root.visible = false;
    }

    if (this.cards.size > CARD_POOL_LIMIT) {
      for (const [id, view] of this.cards) {
        if (this.cards.size <= CARD_POOL_LIMIT / 2) break;
        if (seen.has(id)) continue;
        view.root.destroy({ children: true });
        this.cards.delete(id);
      }
    }
  }

  private createCard(message: WorldMessage): CardView {
    const bx = Math.floor(message.position.x / BOX_SIZE) * BOX_SIZE;
    const by = Math.floor(message.position.y / BOX_SIZE) * BOX_SIZE;
    const maxCols = Math.max(1, Math.floor((WORLD_MAX_X - bx) / BOX_SIZE));
    const { cols, rows, width, height } = getBoxDimensions(message.content, maxCols);
    const topY = by + BOX_SIZE;
    const accent = ACCENTS[accentIndex(message.id)] as number;
    const root = new Container();
    const bg = new Graphics();

    // 1. Solid black box background matching the canvas
    bg.rect(0, 0, width, height)
      .fill({ color: 0x000000, alpha: 0.96 });

    // 2. If multiple neighbor boxes are assigned, draw subtle inner cell boundaries
    if (cols > 1 || rows > 1) {
      for (let c = 1; c < cols; c++) {
        const lx = c * BOX_SIZE;
        bg.moveTo(lx, 0).lineTo(lx, height);
      }
      for (let r = 1; r < rows; r++) {
        const ly = r * BOX_SIZE;
        bg.moveTo(0, ly).lineTo(width, ly);
      }
      bg.stroke({ width: 1, color: 0xffffff, alpha: 0.08 });
    }

    // 3. Crisp outer box border set perfectly on the grid lines
    bg.rect(0, 0, width, height)
      .stroke({ width: 1.5, color: accent, alpha: 0.75 });

    // 4. Corner beacon dot
    bg.circle(11, 12, 2.5)
      .fill({ color: accent, alpha: 0.95 });

    root.addChild(bg);

    // 5. Dedicated text container with strict inner mask so outer border is never clipped
    const textGroup = new Container();
    const mask = new Graphics();
    mask.rect(1, 1, width - 2, height - 2).fill({ color: 0xffffff });
    textGroup.mask = mask;
    textGroup.addChild(mask);
    root.addChild(textGroup);

    return { root, textGroup, body: null, coord: null, message, cols, rows, width, height, bx, by, topY };
  }

  private ensureText(view: CardView): void {
    if (view.body) return;
    const resolution = 3;
    const text = formatBoxText(view.message.content, view.cols, view.rows);
    view.body = new Text({
      text,
      style: {
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        fontSize: 10.5,
        lineHeight: 14.5,
        fill: 0xf8fafc,
        wordWrap: true,
        wordWrapWidth: view.width - 24,
        breakWords: true,
      },
      resolution,
    });
    view.body.position.set(12, 22);

    const spanBadge = view.cols * view.rows > 1 ? ` · ${view.cols}×${view.rows} boxes` : '';
    view.coord = new Text({
      text: `${view.bx}, ${view.by}${spanBadge}`,
      style: {
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 8.5,
        fontWeight: 'bold',
        fill: 0x94a3b8,
      },
      resolution,
    });
    view.coord.position.set(20, 7);
    view.textGroup.addChild(view.body, view.coord);
  }

  // ------------------------------------------------------------- camera moves

  private setCamera(camera: Camera): void {
    const clamped = clampCamera(camera, this.size);
    useWorldStore.getState().setCamera(clamped);
  }

  private startFlight(request: { x: number; y: number; zoom?: number }): void {
    const from = useWorldStore.getState().camera;
    const to = clampCamera(
      {
        x: request.x,
        y: request.y,
        zoom: request.zoom ?? from.zoom,
      },
      this.size,
    );
    this.inertia = null;
    this.flight = { from, to, elapsed: 0, duration: 850 };
  }

  private updateFlight(dt: number): void {
    const flight = this.flight;
    if (!flight) return;
    flight.elapsed += dt;
    const raw = Math.min(1, flight.elapsed / flight.duration);
    const e = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;

    const { from, to } = flight;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const lowZoom = Math.min(from.zoom, to.zoom);
    // Zoom out along the way on long trips so the journey is visible.
    const fitZoom = dist > 0 ? (this.size.width * 0.5) / dist : lowZoom;
    const peakZoom = clampZoom(Math.min(lowZoom, fitZoom));
    const arc = Math.sin(Math.PI * e) * (Math.log(lowZoom) - Math.log(peakZoom));
    const logZoom = Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e - arc;

    this.setCamera({
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      zoom: Math.exp(logZoom),
    });
    if (raw >= 1) {
      this.flight = null;
      this.setCamera(to);
    }
  }

  private updateInertia(dt: number): void {
    const v = this.inertia;
    if (!v) return;
    const camera = useWorldStore.getState().camera;
    this.setCamera({ ...camera, x: camera.x + v.x * dt, y: camera.y + v.y * dt });
    const decay = 0.04 ** (dt / 1000);
    v.x *= decay;
    v.y *= decay;
    if (Math.hypot(v.x, v.y) * camera.zoom < 0.01) this.inertia = null;
  }

  private cancelMotion(): void {
    this.flight = null;
    this.inertia = null;
  }

  // ------------------------------------------------------------------ input

  private localPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.localPoint(e));
    this.cancelMotion();
    useWorldStore.getState().markInteracted();

    if (this.pointers.size === 1) {
      this.dragDistance = 0;
      this.downAt = performance.now();
      this.velocity = { x: 0, y: 0 };
      this.lastMoveAt = e.timeStamp;
      canvas.style.cursor = 'grabbing';
    } else if (this.pointers.size === 2) {
      this.pinchStartDist = this.pinchDistance();
      this.pinchStartZoom = useWorldStore.getState().camera.zoom;
      this.dragDistance = Infinity; // a pinch is never a click
    }
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 1;
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  private onPointerMove = (e: PointerEvent): void => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const previous = this.pointers.get(e.pointerId);
    const current = this.localPoint(e);

    if (!previous) {
      const camera = useWorldStore.getState().camera;
      const p = screenToWorld(current.x, current.y, camera, this.size);
      const targetX = Math.floor(p.x / BOX_SIZE) * BOX_SIZE;
      const targetY = Math.floor(p.y / BOX_SIZE) * BOX_SIZE;
      const E = WORLD_HALF_EXTENT;
      const isOutside = targetX < -E || targetX > E || targetY < -E || targetY > E;
      const isFilled = isOutside || Boolean(this.hit(current.x, current.y) || this.isBoxOccupied(targetX, targetY));
      canvas.style.cursor = isFilled ? 'not-allowed' : 'pointer';
      return;
    }

    const camera = useWorldStore.getState().camera;
    const size = this.size;

    if (this.pointers.size === 1) {
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      this.dragDistance += Math.hypot(dx, dy);
      this.setCamera({
        ...camera,
        x: camera.x - dx / camera.zoom,
        y: camera.y + dy / camera.zoom,
      });
      const dtMs = Math.max(1, e.timeStamp - this.lastMoveAt);
      this.velocity = {
        x: this.velocity.x * 0.6 + (dx / dtMs) * 0.4,
        y: this.velocity.y * 0.6 + (dy / dtMs) * 0.4,
      };
      this.lastMoveAt = e.timeStamp;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.entries()];
      if (!a || !b) return;
      const oldMid = {
        x: (a[1].x + b[1].x) / 2,
        y: (a[1].y + b[1].y) / 2,
      };
      this.pointers.set(e.pointerId, current);
      const [na, nb] = [...this.pointers.values()];
      if (!na || !nb) return;
      const mid = { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 };
      const zoom = this.pinchStartZoom * (this.pinchDistance() / this.pinchStartDist);
      let next = zoomAt(camera, size, mid.x, mid.y, zoom);
      next = {
        ...next,
        x: next.x - (mid.x - oldMid.x) / next.zoom,
        y: next.y + (mid.y - oldMid.y) / next.zoom,
      };
      this.setCamera(next);
      return;
    }
    this.pointers.set(e.pointerId, current);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const point = this.pointers.get(e.pointerId);
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (this.pointers.size === 0) canvas.style.cursor = 'grab';
    if (!wasSingle || !point || e.type === 'pointercancel') return;

    const isClick =
      this.dragDistance < CLICK_SLOP_PX && performance.now() - this.downAt < 500;
    if (isClick) {
      const camera = useWorldStore.getState().camera;
      const p = screenToWorld(point.x, point.y, camera, this.size);
      const targetX = Math.floor(p.x / BOX_SIZE) * BOX_SIZE;
      const targetY = Math.floor(p.y / BOX_SIZE) * BOX_SIZE;

      const E = WORLD_HALF_EXTENT;
      if (targetX < -E || targetX > E || targetY < -E || targetY > E) {
        return; // Clicked outside the world boundary
      }

      const hitMessage = this.hit(point.x, point.y);
      const isFilled = Boolean(hitMessage || this.isBoxOccupied(targetX, targetY));

      if (isFilled) {
        // Filled box is not clickable ("when i click any fill box so i not cllick")
        return;
      }

      // Empty coordinate / box clicked! Open write message box at that exact box coordinate
      useWorldStore.getState().openComposerAt({ x: targetX, y: targetY });
      return;
    }

    const recent = e.timeStamp - this.lastMoveAt < 80;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (recent && speed > 0.05) {
      const zoom = useWorldStore.getState().camera.zoom;
      this.inertia = { x: -this.velocity.x / zoom, y: this.velocity.y / zoom };
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.cancelMotion();
    useWorldStore.getState().markInteracted();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const delta = e.deltaY * unit;
    const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
    const point = this.localPoint(e);
    const camera = useWorldStore.getState().camera;
    this.setCamera(zoomAt(camera, this.size, point.x, point.y, camera.zoom * factor));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const camera = useWorldStore.getState().camera;
    const step = 120 / camera.zoom;
    switch (e.key) {
      case 'ArrowLeft':
        this.setCamera({ ...camera, x: camera.x - step });
        break;
      case 'ArrowRight':
        this.setCamera({ ...camera, x: camera.x + step });
        break;
      case 'ArrowUp':
        this.setCamera({ ...camera, y: camera.y + step });
        break;
      case 'ArrowDown':
        this.setCamera({ ...camera, y: camera.y - step });
        break;
      case '+':
      case '=':
        useWorldStore.getState().zoomBy(1.6);
        break;
      case '-':
        useWorldStore.getState().zoomBy(1 / 1.6);
        break;
      default:
        return;
    }
    this.cancelMotion();
    useWorldStore.getState().markInteracted();
    e.preventDefault();
  };

  /** Find the note card under a screen position, if any (only when cards are drawn). */
  private hit(sx: number, sy: number): WorldMessage | null {
    const camera = useWorldStore.getState().camera;
    if (camera.zoom < DOT_ZOOM) return null;
    const p = screenToWorld(sx, sy, camera, this.size);
    const candidates = this.cache.queryBounds({
      minX: p.x - 500,
      maxX: p.x + 500,
      minY: p.y - 500,
      maxY: p.y + 500,
    });
    let best: WorldMessage | null = null;
    let bestDist = Infinity;
    for (const m of candidates) {
      const { width, height } = getBoxDimensions(m.content);
      const bx = Math.floor(m.position.x / BOX_SIZE) * BOX_SIZE;
      const by = Math.floor(m.position.y / BOX_SIZE) * BOX_SIZE;
      const topY = by + BOX_SIZE;
      const bottomY = topY - height;
      if (p.x >= bx && p.x <= bx + width && p.y >= bottomY && p.y <= topY) {
        const centerX = bx + width / 2;
        const centerY = topY - height / 2;
        const dx = centerX - p.x;
        const dy = centerY - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          best = m;
          bestDist = d;
        }
      }
    }
    return best;
  }

  /** Checks whether the grid box at (targetX, targetY) is occupied by any active note. */
  private isBoxOccupied(targetX: number, targetY: number): boolean {
    const candidates = this.cache.queryBounds({
      minX: targetX - 600,
      maxX: targetX + 600,
      minY: targetY - 600,
      maxY: targetY + 600,
    });
    for (const m of candidates) {
      if (m.status === 'deleted') continue;
      const { width, height } = getBoxDimensions(m.content);
      const bx = Math.floor(m.position.x / BOX_SIZE) * BOX_SIZE;
      const by = Math.floor(m.position.y / BOX_SIZE) * BOX_SIZE;
      const minBoxY = by - height + BOX_SIZE;
      if (
        targetX >= bx &&
        targetX < bx + width &&
        targetY >= minBoxY &&
        targetY <= by
      ) {
        return true;
      }
    }
    return false;
  }
}
