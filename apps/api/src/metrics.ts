/** Lightweight in-process metrics, exposed (admin only) at /api/v1/admin/metrics. */
export class Metrics {
  readonly startedAt = Date.now();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, () => number>();
  private readonly latencies: number[] = [];
  private latencyIndex = 0;
  private static readonly WINDOW = 2000;

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  gauge(name: string, read: () => number): void {
    this.gauges.set(name, read);
  }

  observeLatency(ms: number): void {
    if (this.latencies.length < Metrics.WINDOW) this.latencies.push(ms);
    else {
      this.latencies[this.latencyIndex] = ms;
      this.latencyIndex = (this.latencyIndex + 1) % Metrics.WINDOW;
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return Math.round((sorted[Math.max(0, i)] as number) * 100) / 100;
  }

  snapshot() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const gauges: Record<string, number> = {};
    for (const [name, read] of this.gauges) gauges[name] = read();
    const mem = process.memoryUsage();
    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      counters: Object.fromEntries(this.counters),
      gauges,
      latencyMs: {
        samples: sorted.length,
        p50: this.percentile(sorted, 50),
        p95: this.percentile(sorted, 95),
        p99: this.percentile(sorted, 99),
      },
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) },
    };
  }
}
