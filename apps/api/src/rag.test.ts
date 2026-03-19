import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { LocalRAG } from "./rag.js";

// ── helpers ──────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof mock.fn>;

/** Build a fake Ollama /api/embed response that returns a fixed embedding */
function ollamaEmbedResponse(embedding: number[]) {
  return new Response(JSON.stringify({ embeddings: [embedding] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeRAG(opts?: Partial<{ minSimilarity: number; embeddingModel: string }>) {
  return new LocalRAG({
    ollamaUrl: "http://localhost:11434",
    embeddingModel: opts?.embeddingModel,
    minSimilarity: opts?.minSimilarity,
  });
}

// ── tests ────────────────────────────────────────────────────────────

describe("LocalRAG", () => {
  beforeEach(() => {
    fetchMock = mock.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    mock.restoreAll();
    // Restore original fetch (may be undefined in test env)
    delete (globalThis as any).fetch;
  });

  // ── constructor ──────────────────────────────────────────────────

  it("constructor creates an empty RAG (size === 0)", () => {
    const rag = makeRAG();
    assert.equal(rag.size, 0);
  });

  // ── embed() ──────────────────────────────────────────────────────

  it("embed() calls fetch with correct URL and model", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse([0.1, 0.2, 0.3])),
    );

    const rag = makeRAG({ embeddingModel: "bge-m3" });
    const result = await rag.embed("hello");

    assert.deepEqual(result, [0.1, 0.2, 0.3]);
    assert.equal(fetchMock.mock.callCount(), 1);

    const [url, opts] = fetchMock.mock.calls[0].arguments as [string, any];
    assert.equal(url, "http://localhost:11434/api/embed");
    assert.equal(opts.method, "POST");
    const body = JSON.parse(opts.body);
    assert.equal(body.model, "bge-m3");
    assert.equal(body.input, "hello");
  });

  it("embed() uses default model nomic-embed-text", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse([1])),
    );

    const rag = makeRAG();
    await rag.embed("test");

    const body = JSON.parse((fetchMock.mock.calls[0].arguments[1] as any).body);
    assert.equal(body.model, "nomic-embed-text");
  });

  it("embed() throws on non-ok response", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response("fail", { status: 500, statusText: "Internal Server Error" })),
    );

    const rag = makeRAG();
    await assert.rejects(() => rag.embed("x"), /Ollama embed returned 500/);
  });

  // ── addDocument() ────────────────────────────────────────────────

  it("addDocument() splits text and adds chunks", async () => {
    let callCount = 0;
    fetchMock.mock.mockImplementation(() => {
      callCount++;
      return Promise.resolve(ollamaEmbedResponse([callCount, 0, 0]));
    });

    const rag = makeRAG();
    // Each paragraph > 500 chars forces split into separate chunks
    const para = "X".repeat(300);
    const count = await rag.addDocument(`${para}\n\n${para}`, "src");

    assert.equal(count, 2);
    assert.equal(rag.size, 2);
  });

  it("addDocument() with long text splits into multiple chunks", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse([1, 0])),
    );

    const rag = makeRAG();
    // Create text with paragraphs > 500 chars each to force multiple chunks
    const longParagraph = "A".repeat(300);
    const text = `${longParagraph}\n\n${longParagraph}\n\n${longParagraph}`;
    const count = await rag.addDocument(text, "long");

    assert.ok(count >= 2, `Expected >= 2 chunks, got ${count}`);
    assert.equal(rag.size, count);
  });

  // ── search() ─────────────────────────────────────────────────────

  it("search() returns [] if empty", async () => {
    const rag = makeRAG();
    // Should not even call fetch
    const results = await rag.search("anything");
    assert.deepEqual(results, []);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("search() returns chunks ranked by cosine similarity", async () => {
    // We control embeddings to get known cosine similarities
    // chunk A embedding = [1,0,0], chunk B = [0.7,0.7,0]
    // query embedding   = [1,0,0]  →  sim(A)=1.0, sim(B)≈0.707
    const embeddings: number[][] = [];
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse(embeddings.shift()!)),
    );

    embeddings.push([1, 0, 0]); // chunk A embed
    const rag = makeRAG({ minSimilarity: 0 });
    await rag.addDocument("alpha", "a");

    embeddings.push([0.7, 0.7, 0]); // chunk B embed
    await rag.addDocument("beta", "b");

    embeddings.push([1, 0, 0]); // query embed
    const results = await rag.search("alpha");
    assert.equal(results.length, 2);
    assert.equal(results[0].source, "a");
    assert.equal(results[0].score, 1.0);
    assert.equal(results[1].source, "b");
    assert.ok(results[1].score > 0.5); // ~0.707
  });

  it("search() filters by minSimilarity", async () => {
    // chunk = [1,0,0], query = [0.7,0.7,0]  → sim ≈ 0.707
    const embeddings = [
      [1, 0, 0],
      [0.7, 0.7, 0], // query
    ];
    let idx = 0;
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse(embeddings[idx++])),
    );

    const rag = makeRAG({ minSimilarity: 0.8 });
    await rag.addDocument("doc", "src");

    const results = await rag.search("q");
    assert.equal(results.length, 0);
  });

  it("search() respects maxResults", async () => {
    const embeddings = [
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0.8, 0.2, 0],
      [1, 0, 0], // query
    ];
    let idx = 0;
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse(embeddings[idx++])),
    );

    const rag = makeRAG({ minSimilarity: 0 });
    await rag.addDocument("a", "s1");
    await rag.addDocument("b", "s2");
    await rag.addDocument("c", "s3");

    const results = await rag.search("q", 2);
    assert.equal(results.length, 2);
  });

  // ── size ──────────────────────────────────────────────────────────

  it("size returns the number of chunks", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse([1])),
    );

    const rag = makeRAG();
    assert.equal(rag.size, 0);

    await rag.addDocument("single chunk", "s");
    assert.equal(rag.size, 1);

    // Force two chunks by making paragraphs > 500 chars
    const para = "Y".repeat(300);
    await rag.addDocument(`${para}\n\n${para}`, "s2");
    assert.equal(rag.size, 3);
  });

  // ── cosine similarity edge cases (tested via search) ─────────────

  it("identical vectors yield score 1.0", async () => {
    const embeddings = [
      [0.5, 0.5, 0.5], // doc
      [0.5, 0.5, 0.5], // query (identical)
    ];
    let idx = 0;
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse(embeddings[idx++])),
    );

    const rag = makeRAG({ minSimilarity: 0 });
    await rag.addDocument("x", "s");
    const results = await rag.search("x");

    assert.equal(results.length, 1);
    assert.ok(Math.abs(results[0].score - 1.0) < 1e-9);
  });

  it("orthogonal vectors are filtered out by default minSimilarity", async () => {
    // cosine([1,0,0], [0,1,0]) = 0.0, below default threshold 0.3
    const embeddings = [
      [1, 0, 0], // doc
      [0, 1, 0], // query (orthogonal)
    ];
    let idx = 0;
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(ollamaEmbedResponse(embeddings[idx++])),
    );

    const rag = makeRAG(); // default minSimilarity → 0.3
    await rag.addDocument("x", "s");
    const results = await rag.search("x");

    // Score 0.0 < 0.3, so filtered out
    assert.equal(results.length, 0);
  });
});
