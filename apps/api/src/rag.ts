/**
 * Minimal local RAG using Ollama embeddings.
 * Stores document chunks with their embeddings in memory.
 * Uses cosine similarity for retrieval.
 */

import logger from "./logger.js";
import { trackError } from "./error-tracker.js";

// ---------------------------------------------------------------------------
// Configurable via environment variables
// ---------------------------------------------------------------------------
const RAG_CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE) || 500;
const RAG_MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY) || 0.3;
const RAG_MAX_RESULTS = Number(process.env.RAG_MAX_RESULTS) || 3;
const RAG_EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || "bge-m3";

interface DocumentChunk {
  id: string;
  text: string;
  source: string; // e.g. "manifeste", "persona:Schaeffer"
  embedding: number[];
}

interface RAGOptions {
  ollamaUrl: string;
  embeddingModel?: string; // default: "nomic-embed-text"
  maxChunks?: number; // max chunks to return
  minSimilarity?: number; // minimum cosine similarity threshold
  lightragUrl?: string; // e.g. "http://localhost:9621"
  rerankerUrl?: string; // e.g. "http://localhost:9500"
}

export class LocalRAG {
  private chunks: DocumentChunk[] = [];
  private options: RAGOptions;
  private _rerankerFailCount = 0;
  private _rerankerLastFail = 0;

  constructor(options: RAGOptions) {
    this.options = options;
  }

  /** Verify embedding model is available on Ollama, pull if missing. */
  async init(): Promise<void> {
    const ollamaUrl = this.options.ollamaUrl;
    const model = this.options.embeddingModel || RAG_EMBEDDING_MODEL;
    try {
      const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) || [];
      const available = models.some((m) => m.startsWith(model));
      if (!available) {
        logger.warn({ model, available: models.slice(0, 5) }, "[rag] Embedding model not found, pulling...");
        await fetch(`${ollamaUrl}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model }),
          signal: AbortSignal.timeout(300_000),
        });
        logger.info({ model }, "[rag] Embedding model pulled successfully");
      } else {
        logger.debug({ model }, "[rag] Embedding model available");
      }
    } catch (err) {
      logger.warn({ err }, "[rag] Could not verify embedding model");
    }
  }

  /** Embed text via Ollama /api/embed */
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.options.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.embeddingModel || RAG_EMBEDDING_MODEL,
        input: text,
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama embed returned ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as { embeddings?: number[][] };
    return data.embeddings?.[0] || [];
  }

  /** Add a document (split into chunks, embed each).
   *  If LightRAG is configured, also pushes the full text there (dual write). */
  async addDocument(text: string, source: string): Promise<number> {
    // Dual-write to LightRAG if configured
    if (this.options.lightragUrl) {
      try {
        const res = await fetch(`${this.options.lightragUrl}/documents/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          logger.debug({ source }, "[rag:lightrag] addDocument to LightRAG OK");
        } else {
          logger.warn(`[rag:lightrag] addDocument failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        logger.warn({ err }, "[rag:lightrag] addDocument error (continuing local)");
      }
    }

    // Always index locally
    const textChunks = splitIntoChunks(text, RAG_CHUNK_SIZE);
    for (const chunk of textChunks) {
      const embedding = await this.embed(chunk);
      this.chunks.push({
        id: `${source}_${this.chunks.length}`,
        text: chunk,
        source,
        embedding,
      });
    }
    return textChunks.length;
  }

  /** Search for relevant chunks.
   *  If LightRAG is configured, queries it first; falls back to local on failure.
   *  If a reranker is configured, reranks results with a cross-encoder for better precision. */
  async search(
    query: string,
    maxResults?: number,
  ): Promise<Array<{ text: string; source: string; score: number }>> {
    const limit = maxResults ?? RAG_MAX_RESULTS;
    let results: Array<{ text: string; source: string; score: number }> = [];

    // Try LightRAG first if configured
    if (this.options.lightragUrl) {
      try {
        logger.debug({ query: query.slice(0, 80) }, "[rag:lightrag] search");
        const res = await fetch(`${this.options.lightragUrl}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, mode: "hybrid" }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            response?: string;
            references?: Array<{ content?: string; text?: string }>;
          };
          logger.debug({ refs: data.references?.length ?? 0 }, "[rag:lightrag] search OK");
          if (data.references && data.references.length > 0) {
            for (const ref of data.references.slice(0, limit)) {
              results.push({
                text: ref.content || ref.text || "",
                source: "lightrag",
                score: 1.0,
              });
            }
          } else if (data.response) {
            // No structured references — use the full response as a single chunk
            results.push({ text: data.response, source: "lightrag", score: 1.0 });
          }
          if (results.length > 0) return this.rerank(query, results, limit);
          // Empty results from LightRAG → fall through to local
        } else {
          logger.warn(`[rag:lightrag] search failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        trackError("rag_lightrag_search", err, { query: query.slice(0, 80) });
      }
    }

    // Local in-memory RAG
    if (this.chunks.length === 0) return [];

    const queryEmbedding = await this.embed(query);
    const scored = this.chunks.map((chunk) => ({
      text: chunk.text,
      source: chunk.source,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    results = scored
      .filter((s) => s.score >= (this.options.minSimilarity ?? RAG_MIN_SIMILARITY))
      .slice(0, limit);

    return this.rerank(query, results, limit);
  }

  /** Rerank results using BGE cross-encoder for improved precision.
   *  Falls back to original ordering if the reranker is unavailable. */
  private async rerank(
    query: string,
    results: Array<{ text: string; source: string; score: number }>,
    maxResults: number,
  ): Promise<Array<{ text: string; source: string; score: number }>> {
    const rerankerUrl = this.options.rerankerUrl || process.env.RERANKER_URL;
    if (!rerankerUrl || results.length <= 1) return results;
    // Skip reranker if it failed recently (circuit breaker)
    if (this._rerankerFailCount >= 2 && Date.now() - this._rerankerLastFail < 60_000) return results;

    try {
      const resp = await fetch(`${rerankerUrl}/rerank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          documents: results.map((r) => r.text),
          top_k: maxResults,
        }),
        signal: AbortSignal.timeout(2_000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          results?: Array<{ text: string; score: number }>;
        };
        if (data.results && data.results.length > 0) {
          this._rerankerFailCount = 0;
          const sourceMap = new Map(results.map((r) => [r.text, r.source]));
          logger.info(`[rag:reranker] reranked ${results.length} → ${data.results.length} results`);
          return data.results.map((r) => ({
            text: r.text,
            source: sourceMap.get(r.text) || "unknown",
            score: r.score,
          }));
        }
      }
    } catch (err) {
      this._rerankerFailCount++;
      this._rerankerLastFail = Date.now();
      trackError("rag_rerank", err, { query: query.slice(0, 80), failCount: this._rerankerFailCount });
    }
    return results;
  }

  get size(): number {
    return this.chunks.length;
  }
}

function splitIntoChunks(text: string, maxChars: number): string[] {
  // Split by paragraphs, then merge short ones
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length > maxChars && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += p + "\n\n";
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
