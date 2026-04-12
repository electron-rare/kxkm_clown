/**
 * Persistent Conversation Context Store
 *
 * Stores conversation context per channel in JSONL files.
 * Supports automatic compaction via LLM summarization when context grows large.
 * Max size: configurable (default 750 MB across all channels).
 *
 * Storage: data/context/{channel}.jsonl  (raw entries)
 *          data/context/{channel}.summary.json  (compacted summaries)
 */

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

import { trackError } from "./error-tracker.js";
import { extractFirstJsonObject } from "./json-utils.js";
import { scheduler, VRAM_BUDGETS } from "./inference-scheduler.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContextEntry {
  ts: string;
  nick: string;
  text: string;
  type: "message" | "upload" | "system";
}

interface ContextSummary {
  channel: string;
  summaryText: string;
  entriesCompacted: number;
  lastCompactedAt: string;
  totalCompactions: number;
}

interface ContextStoreOptions {
  dataDir: string;
  maxEntriesBeforeCompact: number;   // compact after N raw entries (default 500)
  maxFileSizeMB: number;             // max size per channel file (default 100 MB)
  maxTotalSizeMB: number;            // max total across all channels (default 750 MB)
  maxContextChars: number;           // max chars injected in prompt (default 16000)
  maxSummaryChars: number;           // max chars in compacted summary (default 20000)
  ollamaUrl: string;
  compactionModel: string;           // model for summarization (default: qwen3.5:9b)
}

function buildDefaultOptions(): ContextStoreOptions {
  const totalGB = os.totalmem() / (1024 ** 3);

  // RAM-aware defaults to avoid over-consuming memory on smaller machines.
  let maxEntriesBeforeCompact = 500;
  let maxFileSizeMB = 100;
  let maxTotalSizeMB = 750;
  let maxContextChars = 12000;
  let maxSummaryChars = 20000;

  if (totalGB <= 8) {
    maxEntriesBeforeCompact = 300;
    maxFileSizeMB = 40;
    maxTotalSizeMB = 256;
    maxContextChars = 8000;
    maxSummaryChars = 10000;
  } else if (totalGB <= 16) {
    maxEntriesBeforeCompact = 400;
    maxFileSizeMB = 75;
    maxTotalSizeMB = 512;
    maxContextChars = 12000;
    maxSummaryChars = 15000;
  } else if (totalGB <= 32) {
    maxEntriesBeforeCompact = 600;
    maxFileSizeMB = 120;
    maxTotalSizeMB = 900;
    maxContextChars = 12000;
    maxSummaryChars = 24000;
  } else {
    maxEntriesBeforeCompact = 900;
    maxFileSizeMB = 180;
    maxTotalSizeMB = 1400;
    maxContextChars = 20000;
    maxSummaryChars = 32000;
  }

  return {
    dataDir: path.join(process.cwd(), "data", "context"),
    maxEntriesBeforeCompact,
    maxFileSizeMB,
    maxTotalSizeMB,
    maxContextChars,
    maxSummaryChars,
    ollamaUrl: "http://localhost:11434",
    compactionModel: "qwen3.5:9b",
  };
}

const DEFAULT_OPTIONS: ContextStoreOptions = buildDefaultOptions();



// ---------------------------------------------------------------------------
// Context Store
// ---------------------------------------------------------------------------

export class ContextStore {
  private options: ContextStoreOptions;
  private compactionInProgress = new Set<string>();
  private limitEnforcementInProgress: Promise<void> | null = null;
  private channelWriteLocks = new Map<string, Promise<void>>();
  private initialized = false;

  // In-memory cache: avoids disk reads on every message (~15-120ms saved)
  private contextCache = new Map<string, { text: string; ts: number }>();
  private static CACHE_TTL_MS = 10_000; // 10s TTL — auto-invalidated on write

  constructor(opts: Partial<ContextStoreOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...opts };
  }

  private channelFile(channel: string): string {
    const safe = channel.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.options.dataDir, `${safe}.jsonl`);
  }

  private summaryFile(channel: string): string {
    const safe = channel.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.options.dataDir, `${safe}.summary.json`);
  }

  private parseJson<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async writeSummaryFile(filePath: string, summary: ContextSummary): Promise<void> {
    const tmp = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
    await fs.rename(tmp, filePath);
  }

  private normalizeSummary(raw: unknown, channel: string): ContextSummary | null {
    if (!raw || typeof raw !== "object") return null;
    const parsed = raw as Record<string, unknown>;
    if (typeof parsed.summaryText !== "string") return null;
    return {
      channel: typeof parsed.channel === "string" && parsed.channel.length > 0 ? parsed.channel : channel,
      summaryText: parsed.summaryText,
      entriesCompacted: typeof parsed.entriesCompacted === "number" && Number.isFinite(parsed.entriesCompacted)
        ? parsed.entriesCompacted
        : 0,
      lastCompactedAt: typeof parsed.lastCompactedAt === "string" ? parsed.lastCompactedAt : new Date(0).toISOString(),
      totalCompactions: typeof parsed.totalCompactions === "number" && Number.isFinite(parsed.totalCompactions)
        ? parsed.totalCompactions
        : 0,
    };
  }

  private async readSummary(channel: string): Promise<ContextSummary | null> {
    const summaryPath = this.summaryFile(channel);
    try {
      const raw = await fs.readFile(summaryPath, "utf-8");
      const parsed = this.parseJson<unknown>(raw);
      const normalized = this.normalizeSummary(parsed, channel);
      if (normalized) return normalized;

      const recoveredRaw = extractFirstJsonObject(raw);
      if (recoveredRaw) {
        const recoveredParsed = this.parseJson<unknown>(recoveredRaw);
        const recovered = this.normalizeSummary(recoveredParsed, channel);
        if (recovered) {
          await this.writeSummaryFile(summaryPath, recovered);
          return recovered;
        }
      }

      const quarantinePath = path.join(
        path.dirname(summaryPath),
        `${path.basename(summaryPath, ".json")}.corrupt.${Date.now().toString(36)}.json`,
      );
      await fs.rename(summaryPath, quarantinePath).catch(() => {});
      return null;
    } catch {
      return null;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.options.dataDir, { recursive: true });
    this.initialized = true;
  }

  // --- Write ---

  async append(channel: string, nick: string, text: string, type: ContextEntry["type"] = "message"): Promise<void> {
    await this.init();

    // Acquire per-channel write lock to prevent concurrent writes during compaction.
    const prev = this.channelWriteLocks.get(channel) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    this.channelWriteLocks.set(channel, prev.then(() => lock));

    try {
      await prev;

      const entry: ContextEntry = {
        ts: new Date().toISOString(),
        nick,
        text: text.slice(0, 2000), // cap per entry
        type,
      };
      const line = JSON.stringify(entry) + "\n";
      await fs.appendFile(this.channelFile(channel), line, "utf-8");

      // Invalidate context cache for this channel
      this.contextCache.delete(channel);

      // Check if compaction needed (runs under same lock)
      await this.maybeCompact(channel).catch((err) => {
        trackError("context_compaction", err, { channel });
      });

      // Enforce per-channel and global storage limits.
      await this.maybeEnforceLimits(channel).catch((err) => {
        trackError("context_limits", err, { channel });
      });
    } finally {
      release();
    }
  }

  // --- Read ---

  async getContext(channel: string, maxChars?: number): Promise<string> {
    const limit = maxChars ?? this.options.maxContextChars;
    await this.init();

    // Check in-memory cache first (avoids disk I/O)
    const cached = this.contextCache.get(channel);
    if (cached && Date.now() - cached.ts < ContextStore.CACHE_TTL_MS) {
      return cached.text.slice(0, limit);
    }

    // Load summary + recent entries in PARALLEL (saves 10-30ms vs sequential)
    const [summaryData, rawContent] = await Promise.all([
      this.readSummary(channel),
      fs.readFile(this.channelFile(channel), "utf-8").catch(() => ""),
    ]);

    let summary = "";
    if (summaryData?.summaryText) {
      const header = "[Résumé des conversations précédentes]\n";
      const summaryBudget = Math.max(0, limit - 256);
      summary = (header + summaryData.summaryText).slice(0, summaryBudget);
    }

    let recent = "";
    try {
      const content = rawContent;
      const lines = content.trim().split("\n").filter(Boolean);

      // Take last N entries that fit in maxChars
      const recentEntries: ContextEntry[] = [];
      let charCount = 0;
      const recentBudget = Math.max(0, limit - summary.length);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry: ContextEntry = JSON.parse(lines[i]);
          const entryText = `${entry.nick}: ${entry.text}`;
          const separatorCost = recentEntries.length > 0 ? 1 : 0;
          if (charCount + entryText.length + separatorCost > recentBudget) break;
          recentEntries.unshift(entry);
          charCount += entryText.length + separatorCost;
        } catch { continue; }
      }

      if (recentEntries.length > 0) {
        recent = "\n\n[Échanges récents]\n" +
          recentEntries.map((e) => `${e.nick}: ${e.text}`).join("\n");
      }
    } catch {
      // No entries yet
    }

    const result = (summary + recent).trim();

    // Cache the result
    this.contextCache.set(channel, { text: result, ts: Date.now() });

    return result;
  }

  // --- Compaction ---

  private async maybeCompact(channel: string): Promise<void> {
    if (this.compactionInProgress.has(channel)) return;

    const filePath = this.channelFile(channel);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch { return; }

    // Check file size
    const sizeMB = stat.size / (1024 * 1024);
    if (sizeMB < 1) return; // Don't compact files < 1 MB

    // Check entry count
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length < this.options.maxEntriesBeforeCompact) return;

    // Compact!
    this.compactionInProgress.add(channel);
    try {
      await this.compact(channel, lines);
    } finally {
      this.compactionInProgress.delete(channel);
    }
  }

  private async compact(channel: string, lines: string[]): Promise<void> {
    if (DEBUG) console.log(`[context] Compacting ${channel}: ${lines.length} entries`);

    // Split: older 80% goes to summary, keep recent 20%
    const splitIdx = Math.floor(lines.length * 0.8);
    const toSummarize = lines.slice(0, splitIdx);
    const toKeep = lines.slice(splitIdx);

    // Build text to summarize
    const entries: ContextEntry[] = [];
    for (const line of toSummarize) {
      try { entries.push(JSON.parse(line)); } catch { continue; }
    }

    if (entries.length === 0) {
      // Nothing valid to summarize; keep only recent lines to bound file growth.
      const fallbackContent = toKeep.join("\n") + "\n";
      await fs.writeFile(this.channelFile(channel), fallbackContent, "utf-8");
      return;
    }

    const textToSummarize = entries
      .map((e) => `${e.nick}: ${e.text}`)
      .join("\n")
      .slice(0, 30000); // cap for LLM context

    // Load existing summary once to avoid redundant reads/parses.
    const previousSummary = await this.readSummary(channel);
    const existingSummary = previousSummary?.summaryText || "";

    // Ask LLM to summarize
    const prompt = existingSummary
      ? `Voici un résumé existant des conversations précédentes:\n${existingSummary}\n\nVoici les nouveaux échanges à intégrer:\n${textToSummarize}\n\nProduis un résumé consolidé et concis (max 2000 mots) qui capture les sujets abordés, les opinions exprimées, les faits importants, et les préférences des utilisateurs. Garde les informations clés et supprime les redondances.`
      : `Voici des échanges de conversation:\n${textToSummarize}\n\nProduis un résumé concis (max 2000 mots) qui capture les sujets abordés, les opinions exprimées, les faits importants, et les préférences des utilisateurs.`;

    let summaryText = existingSummary; // fallback
    try {
      summaryText = await scheduler.submit<string>({
        id: `compact-${channel}-${Date.now()}`,
        device: "gpu",
        priority: "low",
        label: `context-compact:${channel}`,
        vramMB: VRAM_BUDGETS.ollama,
        execute: async () => {
          const llmUrl = process.env.LLM_URL || "http://localhost:11434";
          const llmModel = process.env.LLM_MODEL || "qwen-14b-awq";
          const llmApiKey = process.env.LLM_API_KEY || "";
          const llmH: Record<string, string> = { "Content-Type": "application/json" };
          if (llmApiKey) llmH["Authorization"] = `Bearer ${llmApiKey}`;
          const response = await fetch(`${llmUrl}/v1/chat/completions`, {
            method: "POST",
            headers: llmH,
            body: JSON.stringify({
              model: llmModel,
              messages: [{ role: "user", content: prompt }],
              stream: false,
              max_tokens: 2000,
            }),
            signal: AbortSignal.timeout(120_000),
          });

          if (response.ok) {
            const data = (await response.json()) as { choices?: [{ message?: { content?: string } }] };
            return data.choices?.[0]?.message?.content || existingSummary;
          }
          return existingSummary;
        },
      });
    } catch (err) {
      trackError("context_summarization", err, { channel });
      // Keep existing summary, still compact the raw file
    }

    // Save summary
    const summaryData: ContextSummary = {
      channel,
      summaryText: summaryText.slice(0, this.options.maxSummaryChars),
      entriesCompacted: (previousSummary?.entriesCompacted || 0) + entries.length,
      lastCompactedAt: new Date().toISOString(),
      totalCompactions: (previousSummary?.totalCompactions || 0) + 1,
    };

    await this.writeSummaryFile(this.summaryFile(channel), summaryData);

    // Replace raw file with only recent entries
    const newContent = toKeep.join("\n") + "\n";
    await fs.writeFile(this.channelFile(channel), newContent, "utf-8");

    if (DEBUG) console.log(`[context] Compacted ${channel}: ${toSummarize.length} entries → summary, kept ${toKeep.length} recent`);
  }

  private async maybeEnforceLimits(preferredChannel: string): Promise<void> {
    if (this.limitEnforcementInProgress) return;
    this.limitEnforcementInProgress = this.enforceLimits(preferredChannel).finally(() => {
      this.limitEnforcementInProgress = null;
    });
    await this.limitEnforcementInProgress;
  }

  private async enforceLimits(preferredChannel: string): Promise<void> {
    await this.init();

    const files = await fs.readdir(this.options.dataDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) return;

    const fileStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(this.options.dataDir, file);
        const stat = await fs.stat(filePath);
        return { file, filePath, sizeMB: stat.size / (1024 * 1024), mtimeMs: stat.mtimeMs };
      }),
    );

    const preferredSafe = preferredChannel.replace(/[^a-zA-Z0-9_-]/g, "_");
    const preferredFile = `${preferredSafe}.jsonl`;
    const preferred = fileStats.find((f) => f.file === preferredFile);

    const memPressureRatio = os.freemem() / Math.max(1, os.totalmem());
    const pressureFactor = memPressureRatio < 0.08 ? 0.35 : memPressureRatio < 0.15 ? 0.6 : 1;
    const effectiveMaxFileMB = Math.max(16, this.options.maxFileSizeMB * pressureFactor);
    const effectiveMaxTotalMB = Math.max(128, this.options.maxTotalSizeMB * pressureFactor);

    let totalSizeMB = fileStats.reduce((sum, f) => sum + f.sizeMB, 0);

    // Per-channel cap: force one compaction pass when a channel grows too much.
    if (preferred && preferred.sizeMB > effectiveMaxFileMB && !this.compactionInProgress.has(preferredChannel)) {
      const content = await fs.readFile(preferred.filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (lines.length > 1) {
        this.compactionInProgress.add(preferredChannel);
        try {
          await this.compact(preferredChannel, lines);
        } finally {
          this.compactionInProgress.delete(preferredChannel);
        }

        // Refresh total size after preferred channel compaction to avoid over-trimming others.
        const refreshed = await fs.stat(preferred.filePath);
        const refreshedMB = refreshed.size / (1024 * 1024);
        totalSizeMB = totalSizeMB - preferred.sizeMB + refreshedMB;
      }
    }

    // Global cap: trim oldest channels first, preserving the preferred channel when possible.
    if (totalSizeMB <= effectiveMaxTotalMB) return;

    const candidates = fileStats
      .filter((f) => f.file !== preferredFile)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const candidate of candidates) {
      if (totalSizeMB <= effectiveMaxTotalMB) break;

      const content = await fs.readFile(candidate.filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (lines.length <= 1) continue;

      const keepFrom = Math.floor(lines.length * 0.5);
      const trimmed = lines.slice(keepFrom).join("\n") + "\n";
      await fs.writeFile(candidate.filePath, trimmed, "utf-8");

      const newStat = await fs.stat(candidate.filePath);
      const newSizeMB = newStat.size / (1024 * 1024);
      totalSizeMB = totalSizeMB - candidate.sizeMB + newSizeMB;
    }
  }

  // --- Maintenance ---

  async getChannelStats(channel: string): Promise<{
    entries: number;
    totalChars: number;
    compacted: boolean;
    entriesCompacted: number;
    lastCompactedAt: string | null;
    totalCompactions: number;
  }> {
    await this.init();
    let entries = 0;
    let totalChars = 0;
    try {
      const content = await fs.readFile(this.channelFile(channel), "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      entries = lines.length;
      totalChars = content.length;
    } catch { /* no file yet */ }

    const summary = await this.readSummary(channel);
    return {
      entries,
      totalChars,
      compacted: !!summary,
      entriesCompacted: summary?.entriesCompacted ?? 0,
      lastCompactedAt: summary?.lastCompactedAt ?? null,
      totalCompactions: summary?.totalCompactions ?? 0,
    };
  }

  async getStats(): Promise<{ channels: number; totalSizeMB: number; entries: Record<string, number> }> {
    await this.init();
    const stats = { channels: 0, totalSizeMB: 0, entries: {} as Record<string, number> };

    try {
      const files = await fs.readdir(this.options.dataDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const channel = file.replace(".jsonl", "").replace(/_/g, "#");
        const filePath = path.join(this.options.dataDir, file);
        const stat = await fs.stat(filePath);
        stats.totalSizeMB += stat.size / (1024 * 1024);
        stats.channels++;

        const content = await fs.readFile(filePath, "utf-8");
        stats.entries[channel] = content.trim().split("\n").filter(Boolean).length;
      }
    } catch { /* empty dir */ }

    return stats;
  }
}
