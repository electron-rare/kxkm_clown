#!/usr/bin/env node
// Benchmark embeddings models: nomic-embed-text vs BGE-M3 (if available)
// Usage: node scripts/bench-embeddings.js [--ollama-url http://localhost:11434]
//
// Tests: latency, throughput, similarity quality on reference queries

const args = process.argv.slice(2);
const OLLAMA_URL = args.includes("--ollama-url")
  ? args[args.indexOf("--ollama-url") + 1]
  : process.env.OLLAMA_URL || "http://localhost:11434";

const MODELS = ["nomic-embed-text", "bge-m3"];

const TEST_DOCS = [
  "Pierre Schaeffer invente la musique concrete en 1948 avec les Etudes de bruits.",
  "Le cyberfeminisme radical est un acte de sabotage du big daddy mainframe.",
  "Un LLM local qui refuse le cloud centralise est un acte politique.",
  "Le Node Engine orchestre les workflows de training via graphes DAG.",
  "Eliane Radigue compose des drones minimalistes avec le synthétiseur ARP 2500.",
];

const TEST_QUERIES = [
  "musique concrete Schaeffer",
  "cyberfeminisme VNS Matrix",
  "infrastructure locale auto-hebergee",
  "pipeline training DAG",
  "drone minimaliste synthétiseur",
];

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embed(model, text) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.embeddings?.[0] || data.embedding;
}

async function benchModel(model) {
  console.log(`\n  Testing ${model}...`);

  // Check if model is available
  try {
    await embed(model, "test");
  } catch {
    console.log(`  ⚠ ${model} not available, skipping`);
    return null;
  }

  // Latency: embed all docs
  const docStart = performance.now();
  const docEmbeddings = [];
  for (const doc of TEST_DOCS) {
    docEmbeddings.push(await embed(model, doc));
  }
  const docLatency = performance.now() - docStart;

  // Query latency + similarity
  const queryStart = performance.now();
  const similarities = [];
  for (let i = 0; i < TEST_QUERIES.length; i++) {
    const qEmb = await embed(model, TEST_QUERIES[i]);
    const sim = cosineSimilarity(qEmb, docEmbeddings[i]);
    similarities.push(sim);
  }
  const queryLatency = performance.now() - queryStart;

  const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const dims = docEmbeddings[0]?.length || 0;

  return {
    model,
    dims,
    doc_embed_ms: Math.round(docLatency),
    query_embed_ms: Math.round(queryLatency),
    avg_latency_per_doc_ms: Math.round(docLatency / TEST_DOCS.length),
    avg_latency_per_query_ms: Math.round(queryLatency / TEST_QUERIES.length),
    avg_similarity: Math.round(avgSim * 1000) / 1000,
    similarities: similarities.map(s => Math.round(s * 1000) / 1000),
  };
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║  KXKM Embeddings Benchmark           ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`  Ollama: ${OLLAMA_URL}`);
  console.log(`  Models: ${MODELS.join(", ")}`);
  console.log(`  Docs: ${TEST_DOCS.length}, Queries: ${TEST_QUERIES.length}`);

  const results = [];
  for (const model of MODELS) {
    const r = await benchModel(model);
    if (r) results.push(r);
  }

  if (results.length === 0) {
    console.log("\n  No models available. Install with: ollama pull nomic-embed-text");
    process.exit(1);
  }

  console.log("\n  ┌─────────────────┬──────┬──────────┬──────────┬───────────┐");
  console.log("  │ Model           │ Dims │ Doc ms   │ Query ms │ Avg Sim   │");
  console.log("  ├─────────────────┼──────┼──────────┼──────────┼───────────┤");
  for (const r of results) {
    const name = r.model.padEnd(15);
    const dims = String(r.dims).padStart(4);
    const doc = String(r.avg_latency_per_doc_ms).padStart(6) + "ms";
    const query = String(r.avg_latency_per_query_ms).padStart(6) + "ms";
    const sim = String(r.avg_similarity).padStart(7);
    console.log(`  │ ${name} │ ${dims} │ ${doc} │ ${query} │ ${sim}   │`);
  }
  console.log("  └─────────────────┴──────┴──────────┴──────────┴───────────┘");

  if (results.length >= 2) {
    const best = results.reduce((a, b) => a.avg_similarity > b.avg_similarity ? a : b);
    const fastest = results.reduce((a, b) => a.avg_latency_per_query_ms < b.avg_latency_per_query_ms ? a : b);
    console.log(`\n  Best similarity: ${best.model} (${best.avg_similarity})`);
    console.log(`  Fastest: ${fastest.model} (${fastest.avg_latency_per_query_ms}ms/query)`);
  }

  // JSON output for piping
  if (args.includes("--json")) {
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
