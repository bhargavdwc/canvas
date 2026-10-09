export interface VectorTileData {
  lod: string;
  tx: number;
  ty: number;
  /** Array of polyline coordinate pairs: [lon0, lat0, lon1, lat1, ...] */
  lines: number[][];
}

interface InFlightRequest {
  promise: Promise<VectorTileData | null>;
  controller: AbortController;
  requestedAt: number;
}

/**
 * Handles asynchronous fetching of spatial vector tiles with request deduplication,
 * timeout protection, and active request cancellation.
 */
export class TileLoader {
  private inFlight = new Map<string, InFlightRequest>();
  private failedKeys = new Set<string>(); // avoid repeatedly requesting missing 404 tiles
  private urlTemplate: string;
  private timeoutMs: number;

  constructor(urlTemplate = '/map/{lod}/{x}_{y}.json', timeoutMs = 8000) {
    this.urlTemplate = urlTemplate;
    this.timeoutMs = timeoutMs;
  }

  setUrlTemplate(template: string): void {
    this.urlTemplate = template;
    this.failedKeys.clear();
  }

  /**
   * Fetches a vector tile. If already in flight, returns the existing promise.
   */
  async loadTile(lod: string, tx: number, ty: number): Promise<VectorTileData | null> {
    const key = `${lod}/${tx}_${ty}`;

    if (this.failedKeys.has(key)) {
      return null;
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing.promise;
    }

    const controller = new AbortController();
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const relativeUrl = this.urlTemplate
      .replace('{lod}', lod)
      .replace('{x}', tx.toString())
      .replace('{y}', ty.toString());
    const url = new URL(relativeUrl, baseUrl).toString();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    const promise = fetch(url, { signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          if (res.status === 404) {
            this.failedKeys.add(key);
          }
          return null;
        }
        const data = await res.json();
        // Support both array of polylines or { lines: [...] } object
        const lines: number[][] = Array.isArray(data)
          ? data
          : Array.isArray(data.lines)
            ? data.lines
            : [];
        return { lod, tx, ty, lines };
      })
      .catch((err: unknown) => {
        clearTimeout(timeoutId);
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null; // aborted cleanly
        }
        this.failedKeys.add(key);
        return null;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, { promise, controller, requestedAt: Date.now() });
    return promise;
  }

  /**
   * Aborts in-flight requests that are not in the provided set of needed tile keys.
   */
  cancelObsolete(neededKeys: Set<string>): void {
    for (const [key, req] of this.inFlight.entries()) {
      if (!neededKeys.has(key)) {
        req.controller.abort();
        this.inFlight.delete(key);
      }
    }
  }

  /**
   * Clears all pending requests and reset failure cache.
   */
  reset(): void {
    for (const req of this.inFlight.values()) {
      req.controller.abort();
    }
    this.inFlight.clear();
    this.failedKeys.clear();
  }
}
