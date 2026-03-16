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

import { promises as fs } from "node:fs";
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
  maxEntriesBeforeCompact: number;   // compact after N raw entries (default 200)
  maxFileSizeMB: number;             // max size per channel file (default 50 MB)
  maxTotalSizeMB: number;            // max total across all channels (default 750 MB)
  ollamaUrl: string;
  compactionModel: string;           // model for summarization (default: qwen3:8b)
}

const DEFAULT_OPTIONS: ContextStoreOptions = {
  dataDir: path.join(process.cwd(), "data", "context"),
  maxEntriesBeforeCompact: 200,
  maxFileSizeMB: 50,
  maxTotalSizeMB: 750,
  ollamaUrl: "http://localhost:11434",
  compactionModel: "qwen3:8b",
};

// ---------------------------------------------------------------------------
// Context Store
// ---------------------------------------------------------------------------

export class ContextStore {
  private options: ContextStoreOptions;
  private compactionInProgress = new Set<string>();
  private initialized = false;

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

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.options.dataDir, { recursive: true });
    this.initialized = true;
  }

  // --- Write ---

  async append(channel: string, nick: string, text: string, type: ContextEntry["type"] = "message"): Promise<void> {
    await this.init();
    const entry: ContextEntry = {
      ts: new Date().toISOString(),
      nick,
      text: text.slice(0, 2000), // cap per entry
      type,
    };
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(this.channelFile(channel), line, "utf-8");

    // Check if compaction needed (async, non-blocking)
    this.maybeCompact(channel).catch((err) => {
      console.error(`[context] Compaction error for ${channel}:`, err);
    });
  }

  // --- Read ---

  async getContext(channel: string, maxChars: number = 8000): Promise<string> {
    await this.init();

    // 1. Load compacted summary
    let summary = "";
    try {
      const raw = await fs.readFile(this.summaryFile(channel), "utf-8");
      const data: ContextSummary = JSON.parse(raw);
      if (data.summaryText) {
        summary = `[Résumé des conversations précédentes]\n${data.summaryText}`;
      }
    } catch {
      // No summary yet
    }

    // 2. Load recent raw entries
    let recent = "";
    try {
      const content = await fs.readFile(this.channelFile(channel), "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Take last N entries that fit in maxChars
      const recentEntries: ContextEntry[] = [];
      let charCount = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry: ContextEntry = JSON.parse(lines[i]);
          const entryText = `${entry.nick}: ${entry.text}`;
          if (charCount + entryText.length > maxChars - summary.length) break;
          recentEntries.unshift(entry);
          charCount += entryText.length;
        } catch { continue; }
      }

      if (recentEntries.length > 0) {
        recent = "\n\n[Échanges récents]\n" +
          recentEntries.map((e) => `${e.nick}: ${e.text}`).join("\n");
      }
    } catch {
      // No entries yet
    }

    return (summary + recent).trim();
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
    console.log(`[context] Compacting ${channel}: ${lines.length} entries`);

    // Split: older 80% goes to summary, keep recent 20%
    const splitIdx = Math.floor(lines.length * 0.8);
    const toSummarize = lines.slice(0, splitIdx);
    const toKeep = lines.slice(splitIdx);

    // Build text to summarize
    const entries: ContextEntry[] = [];
    for (const line of toSummarize) {
      try { entries.push(JSON.parse(line)); } catch { continue; }
    }

    const textToSummarize = entries
      .map((e) => `${e.nick}: ${e.text}`)
      .join("\n")
      .slice(0, 30000); // cap for LLM context

    // Load existing summary
    let existingSummary = "";
    try {
      const raw = await fs.readFile(this.summaryFile(channel), "utf-8");
      const data: ContextSummary = JSON.parse(raw);
      existingSummary = data.summaryText || "";
    } catch { /* no previous summary */ }

    // Ask LLM to summarize
    const prompt = existingSummary
      ? `Voici un résumé existant des conversations précédentes:\n${existingSummary}\n\nVoici les nouveaux échanges à intégrer:\n${textToSummarize}\n\nProduis un résumé consolidé et concis (max 2000 mots) qui capture les sujets abordés, les opinions exprimées, les faits importants, et les préférences des utilisateurs. Garde les informations clés et supprime les redondances.`
      : `Voici des échanges de conversation:\n${textToSummarize}\n\nProduis un résumé concis (max 2000 mots) qui capture les sujets abordés, les opinions exprimées, les faits importants, et les préférences des utilisateurs.`;

    let summaryText = existingSummary; // fallback
    try {
      const response = await fetch(`${this.options.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.options.compactionModel,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (response.ok) {
        const data = (await response.json()) as { message?: { content?: string } };
        summaryText = data.message?.content || existingSummary;
      }
    } catch (err) {
      console.error(`[context] LLM summarization failed for ${channel}:`, err);
      // Keep existing summary, still compact the raw file
    }

    // Save summary
    const summaryData: ContextSummary = {
      channel,
      summaryText: summaryText.slice(0, 10000),
      entriesCompacted: entries.length + (existingSummary ? 1 : 0),
      lastCompactedAt: new Date().toISOString(),
      totalCompactions: 1, // increment from existing
    };

    // Update total compactions
    try {
      const raw = await fs.readFile(this.summaryFile(channel), "utf-8");
      const prev: ContextSummary = JSON.parse(raw);
      summaryData.totalCompactions = (prev.totalCompactions || 0) + 1;
      summaryData.entriesCompacted = (prev.entriesCompacted || 0) + entries.length;
    } catch { /* first compaction */ }

    await fs.writeFile(this.summaryFile(channel), JSON.stringify(summaryData, null, 2), "utf-8");

    // Replace raw file with only recent entries
    const newContent = toKeep.join("\n") + "\n";
    await fs.writeFile(this.channelFile(channel), newContent, "utf-8");

    console.log(`[context] Compacted ${channel}: ${toSummarize.length} entries → summary, kept ${toKeep.length} recent`);
  }

  // --- Maintenance ---

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
