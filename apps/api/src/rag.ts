/**
 * Minimal local RAG using Ollama embeddings.
 * Stores document chunks with their embeddings in memory.
 * Uses cosine similarity for retrieval.
 */

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
}

export class LocalRAG {
  private chunks: DocumentChunk[] = [];
  private options: RAGOptions;

  constructor(options: RAGOptions) {
    this.options = options;
  }

  /** Embed text via Ollama /api/embed */
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.options.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.embeddingModel || "nomic-embed-text",
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
          console.log(`[rag:lightrag] DEBUG addDocument to LightRAG OK (source=${source})`);
        } else {
          console.warn(`[rag:lightrag] addDocument failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        console.warn("[rag:lightrag] addDocument error (continuing local):", err);
      }
    }

    // Always index locally
    const textChunks = splitIntoChunks(text, 500);
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
   *  If LightRAG is configured, queries it first; falls back to local on failure. */
  async search(
    query: string,
    maxResults = 3,
  ): Promise<Array<{ text: string; source: string; score: number }>> {
    // Try LightRAG first if configured
    if (this.options.lightragUrl) {
      try {
        console.log(`[rag:lightrag] DEBUG search query="${query.slice(0, 80)}"`);
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
          console.log(
            `[rag:lightrag] DEBUG search OK refs=${data.references?.length ?? 0}`,
          );
          const results: Array<{ text: string; source: string; score: number }> = [];
          if (data.references && data.references.length > 0) {
            for (const ref of data.references.slice(0, maxResults)) {
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
          if (results.length > 0) return results;
          // Empty results from LightRAG → fall through to local
        } else {
          console.warn(`[rag:lightrag] search failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        console.warn("[rag:lightrag] search error (falling back to local):", err);
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
    return scored
      .filter((s) => s.score >= (this.options.minSimilarity ?? 0.3))
      .slice(0, maxResults);
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
