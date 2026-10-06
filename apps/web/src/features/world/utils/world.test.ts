import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, MIN_MESSAGE_DISTANCE, type WorldMessage } from '@canvas/shared-types';
import {
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  parseCoordinateInput,
  pathToPoint,
  pointToPath,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Camera,
  type Size,
} from './coordinates';
import { boundsContain, expandBounds, getViewportBounds } from './viewport';
import { chunkCount, chunkOf, chunksInBounds } from './chunks';
import { distance, isFarEnough } from './distance';
import { ChunkedMessageCache } from './messageCache';

const size: Size = { width: 1000, height: 600 };

describe('camera transforms', () => {
  const camera: Camera = { x: 1200, y: -500, zoom: 2 };

  it('maps the camera centre to the screen centre', () => {
    const s = worldToScreen({ x: 1200, y: -500 }, camera, size);
    expect(s).toEqual({ x: 500, y: 300 });
  });

  it('treats world +y as up (smaller screen y)', () => {
    const above = worldToScreen({ x: 1200, y: -490 }, camera, size);
    expect(above.y).toBeLessThan(300);
  });

  it('round-trips world -> screen -> world', () => {
    const p = { x: 1337, y: -421 };
    const s = worldToScreen(p, camera, size);
    const back = screenToWorld(s.x, s.y, camera, size);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const sx = 800;
    const sy = 100;
    const before = screenToWorld(sx, sy, camera, size);
    const next = zoomAt(camera, size, sx, sy, 0.5);
    const after = screenToWorld(sx, sy, next, size);
    expect(next.zoom).toBe(0.5);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('clamps zoom', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
  });
});

describe('coordinate parsing', () => {
  it.each([
    ['1245, -782', { x: 1245, y: -782 }],
    ['1245 -782', { x: 1245, y: -782 }],
    ['@1245,-782', { x: 1245, y: -782 }],
    ['(1,2)', { x: 1, y: 2 }],
    ['  0,0 ', { x: 0, y: 0 }],
  ])('parses %s', (input, expected) => {
    expect(parseCoordinateInput(input)).toEqual(expected);
  });

  it.each(['', 'abc', '1', '1,2,3', '1e5,2', '5000000,0', 'NaN,1'])('rejects %j', (input) => {
    expect(parseCoordinateInput(input)).toBeNull();
  });

  it('round-trips URL paths', () => {
    const p = { x: 1245, y: -782 };
    expect(pointToPath(p)).toBe('/@1245,-782');
    expect(pathToPoint('/@1245,-782')).toEqual(p);
    expect(pathToPoint('/world/1245/-782')).toEqual(p);
    expect(pathToPoint('/')).toBeNull();
    expect(pathToPoint('/%E0%A4%A')).toBeNull();
  });
});

describe('viewport and chunks', () => {
  it('computes viewport bounds from camera and zoom', () => {
    const b = getViewportBounds({ x: 0, y: 0, zoom: 0.5 }, size);
    expect(b).toEqual({ minX: -1000, maxX: 1000, minY: -600, maxY: 600 });
  });

  it('expands bounds and detects containment', () => {
    const b = getViewportBounds({ x: 0, y: 0, zoom: 1 }, size);
    const bigger = expandBounds(b, 1);
    expect(boundsContain(bigger, b)).toBe(true);
    expect(boundsContain(b, bigger)).toBe(false);
  });

  it('assigns negative coordinates to the correct chunk', () => {
    expect(chunkOf({ x: 0, y: 0 })).toEqual({ cx: 0, cy: 0 });
    expect(chunkOf({ x: -1, y: -1 })).toEqual({ cx: -1, cy: -1 });
    expect(chunkOf({ x: CHUNK_SIZE, y: -CHUNK_SIZE })).toEqual({ cx: 1, cy: -1 });
  });

  it('enumerates chunks covering bounds', () => {
    const bounds = { minX: -1, maxX: CHUNK_SIZE, minY: 0, maxY: 1 };
    const chunks = chunksInBounds(bounds);
    expect(chunks).toHaveLength(chunkCount(bounds));
    expect(chunks).toHaveLength(3);
  });
});

describe('distance', () => {
  it('measures and compares distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(isFarEnough({ x: 0, y: 0 }, { x: MIN_MESSAGE_DISTANCE, y: 0 }, MIN_MESSAGE_DISTANCE)).toBe(
      true,
    );
    expect(isFarEnough({ x: 0, y: 0 }, { x: 140, y: 140 }, MIN_MESSAGE_DISTANCE)).toBe(false);
  });
});

describe('ChunkedMessageCache', () => {
  const msg = (id: string, x: number, y: number): WorldMessage => ({
    id,
    content: id,
    position: { x, y },
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
  });

  it('queries by bounds, deduplicates and prunes', () => {
    const cache = new ChunkedMessageCache();
    cache.upsertMany([msg('a', 10, 10), msg('b', 5000, 5000), msg('c', -2500, 40), msg('a', 10, 10)]);
    expect(cache.size).toBe(3);

    const hit = cache.queryBounds({ minX: -100, maxX: 100, minY: -100, maxY: 100 });
    expect(hit.map((m) => m.id)).toEqual(['a']);

    const all = cache.queryBounds({ minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 });
    expect(all).toHaveLength(3);

    cache.prune({ minX: -100, maxX: 100, minY: -100, maxY: 100 });
    expect(cache.size).toBe(1);
    expect(cache.queryBounds({ minX: 4000, maxX: 6000, minY: 4000, maxY: 6000 })).toHaveLength(0);
  });
});

describe('getBoxDimensions', () => {
  it('allocates 1 box for short messages', async () => {
    const { getBoxDimensions, BOX_SIZE } = await import('../canvas/WorldRenderer');
    const b1 = getBoxDimensions('nice');
    expect(b1.cols).toBe(1);
    expect(b1.rows).toBe(1);
    expect(b1.width).toBe(BOX_SIZE);
    expect(b1.height).toBe(BOX_SIZE);
  });

  it('assigns neighbor boxes as content length increases', async () => {
    const { getBoxDimensions, BOX_SIZE } = await import('../canvas/WorldRenderer');
    const b2 = getBoxDimensions('This is a longer message that should assign neighbor boxes.');
    expect(b2.cols).toBe(2);
    expect(b2.rows).toBe(1);
    expect(b2.width).toBe(2 * BOX_SIZE);

    const b4 = getBoxDimensions(
      'This message is quite detailed and shares multiple thoughts about the infinite world canvas and its coordinates.',
    );
    expect(b4.cols).toBe(2);
    expect(b4.rows).toBe(2);
    expect(b4.width).toBe(2 * BOX_SIZE);
    expect(b4.height).toBe(2 * BOX_SIZE);
  });

  it('allocates extra rows for messages with many line breaks', async () => {
    const { getBoxDimensions } = await import('../canvas/WorldRenderer');
    const multiLine = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6';
    const dims = getBoxDimensions(multiLine);
    expect(dims.rows).toBeGreaterThanOrEqual(2);
  });

  it('handles big unbroken words gracefully', async () => {
    const { getBoxDimensions, formatBoxText } = await import('../canvas/WorldRenderer');
    const bigWord = 'q'.repeat(120) + ' ' + 'w'.repeat(120);
    const dims = getBoxDimensions(bigWord);
    expect(dims.cols * dims.rows).toBeGreaterThan(1);

    const formatted = formatBoxText(bigWord, dims.cols, dims.rows);
    expect(formatted).toBeDefined();
    expect(formatted.length).toBeGreaterThan(0);
  });
});

