import logger from "./logger.js";
import { getErrorCounts } from "./error-tracker.js";

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

// ---------------------------------------------------------------------------
// Business counters (LLM, TTS, WS, image gen)
// ---------------------------------------------------------------------------

const counters = new Map<string, number>();

export function incrementCounter(name: string, delta = 1): void {
  counters.set(name, (counters.get(name) || 0) + delta);
}

export function getCounter(name: string): number {
  return counters.get(name) || 0;
}

// Active WebSocket connections (gauge — can go up and down)
let wsActiveConnections = 0;
export function setWsConnections(n: number): void { wsActiveConnections = n; }

/** Prometheus-compatible text exposition format */
export function prometheusMetrics(): string {
  const lines: string[] = [];
  const mem = process.memoryUsage();

  // Process metrics
  lines.push("# HELP kxkm_memory_rss_bytes Resident set size");
  lines.push("# TYPE kxkm_memory_rss_bytes gauge");
  lines.push(`kxkm_memory_rss_bytes ${mem.rss}`);
  lines.push("# HELP kxkm_memory_heap_used_bytes Heap used");
  lines.push("# TYPE kxkm_memory_heap_used_bytes gauge");
  lines.push(`kxkm_memory_heap_used_bytes ${mem.heapUsed}`);
  lines.push("# HELP kxkm_uptime_seconds Process uptime");
  lines.push("# TYPE kxkm_uptime_seconds gauge");
  lines.push(`kxkm_uptime_seconds ${Math.floor(process.uptime())}`);
  lines.push("# HELP kxkm_ws_connections Active WebSocket connections");
  lines.push("# TYPE kxkm_ws_connections gauge");
  lines.push(`kxkm_ws_connections ${wsActiveConnections}`);

  // Latency metrics (summaries)
  for (const [label, m] of metrics) {
    const safe = label.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`# HELP kxkm_${safe}_total Total requests`);
    lines.push(`# TYPE kxkm_${safe}_total counter`);
    lines.push(`kxkm_${safe}_total ${m.count}`);
    const sorted = [...m.buckets].sort((a, b) => a - b);
    lines.push(`# HELP kxkm_${safe}_duration_ms Latency`);
    lines.push(`# TYPE kxkm_${safe}_duration_ms summary`);
    lines.push(`kxkm_${safe}_duration_ms{quantile="0.5"} ${Math.round(percentile(sorted, 50))}`);
    lines.push(`kxkm_${safe}_duration_ms{quantile="0.95"} ${Math.round(percentile(sorted, 95))}`);
    lines.push(`kxkm_${safe}_duration_ms{quantile="0.99"} ${Math.round(percentile(sorted, 99))}`);
    lines.push(`kxkm_${safe}_duration_ms_max ${Math.round(m.maxMs)}`);
  }

  // Business counters
  for (const [name, value] of counters) {
    const safe = name.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`# TYPE kxkm_${safe}_total counter`);
    lines.push(`kxkm_${safe}_total ${value}`);
  }

  // Error counters from error-tracker
  const errorCounts = getErrorCounts();
  const totalErrors = Object.values(errorCounts).reduce((a, b) => a + b, 0);
  if (totalErrors > 0) {
    lines.push("# HELP kxkm_errors_total Error count by label");
    lines.push("# TYPE kxkm_errors_total counter");
    for (const [label, count] of Object.entries(errorCounts)) {
      const safe = label.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`kxkm_errors_total{label="${safe}"} ${count}`);
    }
  }

  return lines.join("\n") + "\n";
}
