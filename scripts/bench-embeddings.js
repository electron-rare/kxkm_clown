#!/usr/bin/env node
/**
 * Benchmark local embeddings models via Ollama.
 *
 * Usage:
 *   node scripts/bench-embeddings.js
 *   node scripts/bench-embeddings.js --models nomic-embed-text,bge-m3 --json-only
 *   node scripts/bench-embeddings.js --list-models
 */

const DEFAULT_MODELS = ["nomic-embed-text", "bge-m3"];
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

const TEST_DOCS = [
  "Pierre Schaeffer invente la musique concrete en 1948 avec les Etudes de bruits.",
  "Le cyberfeminisme radical est un acte de sabotage du big daddy mainframe.",
  "Un LLM local qui refuse le cloud centralise est un acte politique.",
  "Le Node Engine orchestre les workflows de training via graphes DAG.",
  "Eliane Radigue compose des drones minimalistes avec le synthetiseur ARP 2500.",
];

const TEST_QUERIES = [
  "musique concrete Schaeffer",
  "cyberfeminisme VNS Matrix",
  "infrastructure locale auto-hebergee",
  "pipeline training DAG",
  "drone minimaliste synthetiseur",
];

function parseArgs(argv) {
  const options = {
    ollamaUrl: DEFAULT_OLLAMA_URL,
    models: [...DEFAULT_MODELS],
    json: false,
    jsonOnly: false,
    listModels: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--ollama-url":
        index += 1;
        if (!argv[index]) throw new Error("--ollama-url requires a value");
        options.ollamaUrl = argv[index];
        break;
      case "--models":
        index += 1;
        if (!argv[index]) throw new Error("--models requires a value");
        options.models = argv[index]
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
        break;
      case "--json":
        options.json = true;
        break;
      case "--json-only":
        options.json = true;
        options.jsonOnly = true;
        break;
      case "--list-models":
        options.listModels = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          [
            "Usage: node scripts/bench-embeddings.js [options]",
            "",
            "Options:",
            "  --ollama-url URL      Ollama base URL (default: env OLLAMA_URL or http://localhost:11434)",
            "  --models A,B          Comma-separated models to benchmark",
            "  --list-models         Print models currently available in Ollama and exit",
            "  --json               Emit JSON after the human summary",
            "  --json-only          Emit JSON only",
            "  --help               Show this help",
          ].join("\n") + "\n",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  if (options.models.length === 0) {
    throw new Error("at least one model is required");
  }

  return options;
}

function log(enabled, message) {
  if (enabled) {
    process.stdout.write(`${message}\n`);
  }
}

function stripTag(name) {
  return name.split(":")[0];
}

function resolveModelName(requestedModel, availableModels) {
  if (availableModels.includes(requestedModel)) {
    return requestedModel;
  }

  const requestedBase = stripTag(requestedModel);
  const matching = availableModels.filter((model) => stripTag(model) === requestedBase);
  if (matching.length === 0) {
    return null;
  }

  return matching.find((model) => model.endsWith(":latest")) || matching[0];
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function fetchAvailableModels(ollamaUrl) {
  const response = await fetch(`${ollamaUrl}/api/tags`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Ollama tags failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return (body.models || []).map((model) => model.name).filter(Boolean);
}

async function embed(ollamaUrl, model, text) {
  const response = await fetch(`${ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`${model}: ${response.status} ${response.statusText}${details ? ` — ${details.slice(0, 200)}` : ""}`);
  }

  const body = await response.json();
  return body.embeddings?.[0] || body.embedding;
}

async function benchModel(ollamaUrl, model, humanOutput) {
  log(humanOutput, `\n  Testing ${model}...`);

  const docStart = performance.now();
  const docEmbeddings = [];
  for (const doc of TEST_DOCS) {
    docEmbeddings.push(await embed(ollamaUrl, model, doc));
  }
  const docLatency = performance.now() - docStart;

  const queryStart = performance.now();
  const similarities = [];
  for (let index = 0; index < TEST_QUERIES.length; index += 1) {
    const queryEmbedding = await embed(ollamaUrl, model, TEST_QUERIES[index]);
    similarities.push(cosineSimilarity(queryEmbedding, docEmbeddings[index]));
  }
  const queryLatency = performance.now() - queryStart;

  const avgSimilarity = similarities.reduce((sum, item) => sum + item, 0) / similarities.length;

  return {
    model,
    dims: docEmbeddings[0]?.length || 0,
    doc_embed_ms: Math.round(docLatency),
    query_embed_ms: Math.round(queryLatency),
    avg_latency_per_doc_ms: Math.round(docLatency / TEST_DOCS.length),
    avg_latency_per_query_ms: Math.round(queryLatency / TEST_QUERIES.length),
    avg_similarity: Math.round(avgSimilarity * 1000) / 1000,
    similarities: similarities.map((item) => Math.round(item * 1000) / 1000),
  };
}

function printTable(results) {
  process.stdout.write("\n  ┌─────────────────┬──────┬──────────┬──────────┬───────────┐\n");
  process.stdout.write("  │ Model           │ Dims │ Doc ms   │ Query ms │ Avg Sim   │\n");
  process.stdout.write("  ├─────────────────┼──────┼──────────┼──────────┼───────────┤\n");
  for (const result of results) {
    const name = result.model.padEnd(15);
    const dims = String(result.dims).padStart(4);
    const doc = `${String(result.avg_latency_per_doc_ms).padStart(6)}ms`;
    const query = `${String(result.avg_latency_per_query_ms).padStart(6)}ms`;
    const similarity = String(result.avg_similarity).padStart(7);
    process.stdout.write(`  │ ${name} │ ${dims} │ ${doc} │ ${query} │ ${similarity}   │\n`);
  }
  process.stdout.write("  └─────────────────┴──────┴──────────┴──────────┴───────────┘\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const humanOutput = !options.jsonOnly;

  const availableModels = await fetchAvailableModels(options.ollamaUrl);
  if (options.listModels) {
    const payload = { ollamaUrl: options.ollamaUrl, availableModels };
    if (options.jsonOnly || options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      log(true, availableModels.length > 0
        ? availableModels.join("\n")
        : "(no Ollama models available)");
    }
    return;
  }

  const requestedModels = options.models;
  const resolvedModels = requestedModels.map((model) => ({
    requested: model,
    resolved: resolveModelName(model, availableModels),
  }));
  const benchmarkableModels = [...new Set(resolvedModels.map((entry) => entry.resolved).filter(Boolean))];
  const missingModels = resolvedModels.filter((entry) => !entry.resolved).map((entry) => entry.requested);

  if (humanOutput) {
    log(true, "╔══════════════════════════════════════╗");
    log(true, "║  KXKM Embeddings Benchmark           ║");
    log(true, "╚══════════════════════════════════════╝");
    log(true, `  Ollama: ${options.ollamaUrl}`);
    log(true, `  Requested: ${requestedModels.join(", ")}`);
    log(true, `  Available: ${availableModels.length > 0 ? availableModels.join(", ") : "(none)"}`);
    if (benchmarkableModels.length > 0) {
      log(true, `  Resolved: ${benchmarkableModels.join(", ")}`);
    }
    log(true, `  Docs: ${TEST_DOCS.length}, Queries: ${TEST_QUERIES.length}`);
  }

  const results = [];
  const errors = [];
  for (const model of benchmarkableModels) {
    try {
      results.push(await benchModel(options.ollamaUrl, model, humanOutput));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ model, error: message });
      if (humanOutput) {
        log(true, `  ${model} failed: ${message}`);
      }
    }
  }

  const payload = {
    ollamaUrl: options.ollamaUrl,
    requestedModels,
    resolvedModels,
    availableModels,
    missingModels,
    benchmarkedModels: results.map((result) => result.model),
    errors,
    results,
  };

  if (results.length === 0) {
    if (humanOutput) {
      log(true, "\n  No requested benchmark models are installed in Ollama.");
      if (missingModels.length > 0) {
        log(true, `  Install with: ${missingModels.map((model) => `ollama pull ${model}`).join(" && ")}`);
      }
    }
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    }
    process.exit(1);
  }

  if (humanOutput) {
    printTable(results);
    if (results.length >= 2) {
      const best = results.reduce((left, right) => (left.avg_similarity > right.avg_similarity ? left : right));
      const fastest = results.reduce((left, right) => (left.avg_latency_per_query_ms < right.avg_latency_per_query_ms ? left : right));
      log(true, `\n  Best similarity: ${best.model} (${best.avg_similarity})`);
      log(true, `  Fastest: ${fastest.model} (${fastest.avg_latency_per_query_ms}ms/query)`);
    }
    if (errors.length > 0) {
      log(true, "\n  Model errors:");
      for (const item of errors) {
        log(true, `  - ${item.model}: ${item.error}`);
      }
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error.message}\n`);
  process.exit(1);
});
