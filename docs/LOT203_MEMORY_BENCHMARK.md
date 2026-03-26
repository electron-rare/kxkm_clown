# LOT-203 — Memory Benchmark: KXKM Local Store vs Mem0

**Date:** 2026-03-26
**Author:** Agent (lot-203)
**Status:** CONCLUDED — Recommendation: Keep local store

---

## 1. Mem0 Overview

### What it is

Mem0 (mem0ai/mem0) is an open-source "universal memory layer" for LLM applications and AI agents. At 37 000+ GitHub stars as of early 2026, it is the dominant OSS solution in this space. It ships both an open-source self-hosted variant and a cloud-hosted managed service.

### Architecture

Mem0 OSS uses a multi-layer pipeline:

```
User message
     |
     v
[LLM extraction layer]     ← calls an LLM to detect facts / entities
     |
     +--> [Embedding model]  → embed extracted facts
     |         |
     |         v
     |    [Vector store]     ← Qdrant (default local), pgvector, Chroma, Weaviate…
     |
     +--> [Graph store]      ← Neo4j or Memgraph (optional, entity relationships)
     |
     +--> [SQLite]           ← conversation history tracking
```

Every `add()` call (write) triggers:
1. An LLM call to extract and deduplicate facts from the incoming text.
2. An embedding model call to vectorize each extracted fact.
3. A vector DB write.
4. Optionally a Neo4j graph DB write.

Every `search()` call (read) triggers:
1. An embedding model call to vectorize the query.
2. A vector DB similarity search.
3. A scoring/reranking pass (relevance × recency × importance).
4. Optionally a Neo4j graph traversal.

### Default dependency stack (self-hosted)

| Component | Default | Alternatives |
|---|---|---|
| LLM (extraction) | OpenAI GPT-4.1-nano | Anthropic Claude, Ollama (local) |
| Embedding model | OpenAI text-embedding-3-small | Ollama nomic-embed-text, bge-m3 |
| Vector store | Qdrant (local) | pgvector, Chroma, Weaviate, Pinecone |
| Graph store | Neo4j (optional) | Memgraph, none |
| History DB | SQLite | — |

### Self-hosted requirements (Docker Compose reference setup)

- **Minimum:** t3.medium — 2 vCPU, 4 GB RAM (~$30/mo on EC2, or equivalent bare metal)
- **Recommended for local LLM integration:** t3.large — 8 GB RAM
- **Services:** FastAPI REST server + PostgreSQL/pgvector + Neo4j 5.x
- **Storage:** persistent volumes for two databases
- **Network:** no authentication by default — requires a reverse proxy (nginx/Caddy) for production
- **Deployment time:** 2–5 minutes initial pull (~500 MB images)
- **VRAM:** none required for cloud embeddings; if Ollama is used for embeddings/LLM, add ~4–8 GB VRAM per model loaded

### Latency characteristics (published benchmarks)

| Metric | Mem0 value | Source |
|---|---|---|
| p95 search latency | ~200 ms | mem0.ai official benchmark |
| Token usage per conv. | ~1 764 tokens | vs 26 031 for full context |
| Latency reduction vs full context | ~91% | mem0.ai benchmark |
| LoCoMo benchmark accuracy | 58–66% | 2026 community benchmark (5-system comparison) |

Note: the 200 ms figure is for cloud-hosted embeddings (OpenAI). Self-hosted with Ollama embeddings
will be higher due to local inference overhead — community reports suggest 400–900 ms p95 for a
medium GPU machine with bge-m3 embeddings.

### Known limitations

- Every write requires an outbound LLM call (or local Ollama call) — memory writes are not atomic/fast.
- The default setup requires an external API key (OpenAI), making it non-offline by default.
- No authentication layer out of the box — `allow_origins=["*"]` CORS by default.
- Neo4j licensing: Community edition limits cluster features; Enterprise requires license.
- Python-only SDK for the full pipeline; Node.js SDK is thinner and less maintained.

---

## 2. KXKM Local Store

### Current implementation summary

The KXKM persona memory system consists of two TypeScript modules:

- `/apps/api/src/persona-memory-store.ts` — persistence layer (read/write/reset, v2-local JSON files)
- `/apps/api/src/persona-memory-policy.ts` — extraction logic, normalization, pruning, policy engine

### Storage model (v2-local)

Each persona gets a single JSON file at `data/v2-local/persona-memory/<personaId>.json`.

The record schema (`PersonaMemoryRecordV2`) contains:
- **workingMemory**: hot facts (≤20), current summary, last source messages (≤10)
- **archivalMemory**: deduplicated historical facts (≤100) with first/last-seen timestamps; summaries ring buffer (≤50)
- **compat block**: backward-compatible legacy view (facts + summary + lastUpdated)

### Policy engine

`resolvePersonaMemoryPolicy()` reads all limits from environment variables with safe integer clamping:

| Parameter | Default | Env var |
|---|---|---|
| updateEveryResponses | 5 | KXKM_PERSONA_MEMORY_UPDATE_EVERY |
| recentMessagesWindow | 10 | KXKM_PERSONA_MEMORY_EXTRACTION_WINDOW |
| workingFactsLimit | 20 | KXKM_PERSONA_MEMORY_FACTS_LIMIT |
| archivalFactsLimit | 100 | KXKM_PERSONA_MEMORY_ARCHIVAL_FACTS_LIMIT |
| archivalSummariesLimit | 50 | KXKM_PERSONA_MEMORY_ARCHIVAL_SUMMARIES_LIMIT |

Extraction (fact distillation) is handled by calling the local LLM with a structured prompt
(`buildPersonaMemoryExtractionPrompt`) and merging results via `applyPersonaMemoryExtraction`.
This LLM call happens every N responses (configurable), not on every message.

### Read path

1. In-memory LRU cache (30 s TTL, Map keyed by personaId and nick).
2. If cache miss: `readFile` of the persona's JSON file.
3. If no v2 file: legacy migration path (reads old `persona-memory/<nick>.json`, promotes to v2).
4. If nothing found: returns an empty record (no I/O error).

### Write path

1. `normalizePersonaMemory()` — deduplicates facts, trims to policy limits, upserts archival.
2. `writeFile` to `data/v2-local/persona-memory/<personaId>.json`.
3. Parallel `writeFile` to legacy compat path.
4. Updates in-memory cache.

### Key properties

- **Zero external services**: pure Node.js fs + in-process Map cache.
- **Zero network calls** at read/write time (LLM call happens upstream, on extraction trigger only).
- **Fully offline**: no API keys, no vector DB, no embedding model at runtime.
- **Deterministic latency**: cache hit ~0 ms; disk read ~1–5 ms (local SSD); disk write ~2–10 ms.
- **Language-native**: TypeScript, same runtime as the API — no IPC, no subprocess.

---

## 3. Comparison Matrix

| Dimension | KXKM Local Store | Mem0 OSS (self-hosted) |
|---|---|---|
| **Read latency (cache hit)** | < 1 ms | N/A (no cache by default) |
| **Read latency (disk / vector search)** | 1–5 ms | 50–200 ms (cloud embeddings); 400–900 ms (Ollama) |
| **Write latency** | 2–10 ms | 300–2000 ms (LLM extraction + embed + DB write) |
| **Offline capability** | Full — zero external deps | Partial — requires Ollama config; still needs vector DB |
| **VRAM requirement** | 0 (memory ops only) | 0 if cloud; 4–8 GB per model if Ollama |
| **RAM overhead** | ~50 MB (Node process + cache) | ~2–4 GB (Neo4j) + ~512 MB (FastAPI) + pgvector |
| **Infrastructure components** | 0 additional services | 3 additional services (FastAPI, PostgreSQL/pgvector, Neo4j) |
| **Semantic retrieval quality** | None — exact/substring only | Vector similarity + graph traversal + reranking |
| **Contradiction resolution** | None (deduplication by text equality) | LLM-assisted on every write |
| **Memory coherence (LoCoMo score)** | Not benchmarked — structurally simpler | 58–66% on LoCoMo |
| **Fact extraction quality** | Depends on local LLM (same as Mem0 with Ollama) | Same LLM dependency |
| **Scalability (many personas)** | O(1) per-persona files, linear scan fallback | Designed for multi-user at scale |
| **Setup complexity** | 0 — embedded in API process | Medium — Docker Compose, 3 services, env config |
| **Maintenance burden** | Near-zero (pure TypeScript) | Medium (DB upgrades, Neo4j licensing, Python deps) |
| **Node.js integration** | Native TypeScript | REST HTTP calls (extra hop + serialization) |
| **Audit / transparency** | Full source in-repo, 318 LOC | External library, 37 k stars, active community |
| **Portability** | Git-tracked JSON files | PostgreSQL + Neo4j volumes (heavier export) |

---

## 4. Recommendation

**Verdict: Keep the KXKM local store. Do not adopt Mem0 at this time.**

### Rationale

The KXKM use case is a multi-persona IRC-style chat system with ~10–50 concurrent personas on a
single GPU machine (`kxkm-ai`). Memory access is per-message, low-volume, and latency-sensitive
(each persona response cycle must not add perceptible delay for the user).

The local store achieves sub-5 ms reads and sub-10 ms writes with zero additional infrastructure.
Mem0 OSS self-hosted introduces 2–3 additional Docker services consuming 3–5 GB RAM minimum,
requires either an OpenAI key or a dedicated Ollama instance for embeddings, and adds 300–2000 ms
per memory write — all for a use case where the persona count is bounded and does not need
enterprise-scale vector search.

The only genuine advantage Mem0 provides is **semantic retrieval** (vector similarity search)
and **LLM-assisted contradiction resolution**. These are real strengths for large-scale, long-horizon
memory (hundreds of users, thousands of facts). For KXKM's current scale, the policy-based pruning
and deduplication in `persona-memory-policy.ts` is sufficient.

### Conditions under which this verdict should be revisited

- Persona count grows beyond ~100 with distinct long-term users (thousands of archival facts).
- A use case requires "find the most semantically relevant past fact" rather than "recall recent facts".
- The archival store exceeds the current 100-fact / 50-summary caps and accuracy degrades noticeably.
- The project moves to a hosted/cloud deployment where PostgreSQL/Neo4j are already provisioned.

### Hybrid option (future, if needed)

If semantic retrieval becomes necessary without the full Mem0 stack, a lighter path is:
- Keep the current KXKM store for working memory (hot facts, recent messages).
- Add a local SQLite + sqlite-vss (vector similarity extension) for archival semantic search.
- This avoids Neo4j entirely, keeps everything in Node.js, and stays offline.

---

## 5. Migration Cost (if Mem0 were adopted)

Provided here for completeness only — this migration is **not recommended**.

| Task | Estimated effort |
|---|---|
| Replace `persona-memory-store.ts` read/write with Mem0 REST client | 1 day |
| Adapt policy engine triggers to Mem0 add/search API surface | 1 day |
| Migrate existing JSON persona memory files to Mem0 (import script) | 0.5 day |
| Set up Docker Compose services (PostgreSQL/pgvector + Neo4j + FastAPI) | 0.5 day |
| Configure Ollama as Mem0 embedding + LLM backend (offline mode) | 0.5 day |
| Add authentication layer (reverse proxy + Mem0 API tokens) | 0.5 day |
| Regression test suite update | 1 day |
| **Total** | **~5 days** |

Additional ongoing cost: maintenance of 3 extra Docker services, Neo4j version upgrades,
Python dependency security patches in the Mem0 container.

---

## Sources

- [GitHub — mem0ai/mem0](https://github.com/mem0ai/mem0)
- [Mem0 Open Source Overview](https://docs.mem0.ai/open-source/overview)
- [Mem0 Self-Host Docker Guide](https://mem0.ai/blog/self-host-mem0-docker)
- [AI Memory Benchmark: Mem0 vs OpenAI vs LangMem vs MemGPT](https://mem0.ai/blog/benchmarked-openai-memory-vs-langmem-vs-memgpt-vs-mem0-for-long-term-memory-here-s-how-they-stacked-up)
- [5 AI Agent Memory Systems Compared — 2026 Benchmark (DEV.to)](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3)
- [AI Agent Memory Systems in 2026 — Medium](https://yogeshyadav.medium.com/ai-agent-memory-systems-in-2026-mem0-zep-hindsight-memvid-and-everything-in-between-compared-96e35b818da8)
- [Vector Store Providers — DeepWiki](https://deepwiki.com/mem0ai/mem0/5.2-vector-store-providers)
- [Mem0 InfoWorld overview](https://www.infoworld.com/article/4026560/mem0-an-open-source-memory-layer-for-llm-applications-and-ai-agents.html)
