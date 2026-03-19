import logger from "./logger.js";

// ---------------------------------------------------------------------------
// Latency metrics collector with percentile support (p50, p95, p99)
// ---------------------------------------------------------------------------

interface PerfMetrics {
  count: number;
  totalMs: number;
  maxMs: number;
  buckets: number[]; // sorted latencies for percentile calc
}

const metrics = new Map<string, PerfMetrics>();
const MAX_BUCKET_SIZE = 1000;

export function recordLatency(label: string, ms: number): void {
  let m = metrics.get(label);
  if (!m) {
    m = { count: 0, totalMs: 0, maxMs: 0, buckets: [] };
    metrics.set(label, m);
  }
  m.count++;
  m.totalMs += ms;
  if (ms > m.maxMs) m.maxMs = ms;
  m.buckets.push(ms);
  if (m.buckets.length > MAX_BUCKET_SIZE) {
    m.buckets.sort((a, b) => a - b);
    // Keep only every other element to halve the array
    m.buckets = m.buckets.filter((_, i) => i % 2 === 0);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

export function getMetrics(): Record<string, { count: number; avgMs: number; p50: number; p95: number; p99: number; maxMs: number }> {
  const result: Record<string, any> = {};
  for (const [label, m] of metrics) {
    const sorted = [...m.buckets].sort((a, b) => a - b);
    result[label] = {
      count: m.count,
      avgMs: Math.round(m.totalMs / Math.max(1, m.count)),
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      maxMs: Math.round(m.maxMs),
    };
  }
  return result;
}

export function resetMetrics(): void {
  metrics.clear();
}
