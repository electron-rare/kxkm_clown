import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mock dependencies BEFORE importing the module under test
// ---------------------------------------------------------------------------

// Mock web-search
const mockSearchWeb = mock.fn(async (_q: string) => "search result");
mock.module("./web-search.js", {
  namedExports: { searchWeb: mockSearchWeb },
});

// Mock comfyui
const mockGenerateImage = mock.fn(async (_p: string) => ({ imageBase64: "abc", seed: 42 }));
mock.module("./comfyui.js", {
  namedExports: { generateImage: mockGenerateImage },
});

// Mock error-tracker
mock.module("./error-tracker.js", {
  namedExports: { trackError: mock.fn() },
});

// Now import the module under test
const {
  streamOllamaChat,
  executeToolCall,
  streamOllamaChatWithTools,
  cleanPersonaResponse,
} = await import("./ws-ollama.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePersona() {
  return {
    id: "test-id",
    nick: "test",
    model: "test:7b",
    systemPrompt: "You are a test",
    color: "#fff",
    maxTokens: 100,
  };
}

/** Build a ReadableStream that yields NDJSON lines like Ollama */
function ollamaStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = chunks.map(
    (c) => JSON.stringify({ message: { content: c }, done: false }) + "\n",
  );
  lines.push(JSON.stringify({ message: { content: "" }, done: true }) + "\n");
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx < lines.length) {
        controller.enqueue(encoder.encode(lines[idx++]));
      } else {
        controller.close();
      }
    },
  });
}

/** Create a mock Response with a streaming body */
function mockStreamResponse(chunks: string[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    body: ollamaStream(chunks),
  } as unknown as Response;
}

/** Create a mock Response with a JSON body (non-streaming) */
function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
  } as unknown as Response;
}

// Store original fetch
const originalFetch = globalThis.fetch;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ws-ollama", () => {
  let fetchMock: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    fetchMock = mock.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    mockSearchWeb.mock.resetCalls();
    mockGenerateImage.mock.resetCalls();
    // Drain the semaphore state by releasing enough times
    // (we need a fresh state; simplest approach is to accept leaks for now)
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // streamOllamaChat tests
  // =========================================================================

  describe("streamOllamaChat", () => {
    it("calls fetch with correct URL and body", async () => {
      fetchMock.mock.mockImplementation(async () => mockStreamResponse(["hello"]));

      const persona = makePersona();
      await streamOllamaChat(
        "http://localhost:11434",
        persona,
        "Hi",
        () => {},
        () => {},
        () => {},
      );

      assert.equal(fetchMock.mock.callCount(), 1);
      const [url, opts] = fetchMock.mock.calls[0].arguments as [string, RequestInit & { body: string }];
      assert.equal(url, "http://localhost:11434/api/chat");
      assert.equal(opts.method, "POST");
      const body = JSON.parse(opts.body as string);
      assert.equal(body.model, "test:7b");
      assert.equal(body.stream, true);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[0].content, "You are a test");
      assert.equal(body.messages[1].role, "user");
      assert.equal(body.messages[1].content, "Hi");
      assert.equal(body.options.num_predict, 100);
    });

    it("streams chunks via onChunk and calls onDone with full text", async () => {
      fetchMock.mock.mockImplementation(async () => mockStreamResponse(["Hello", " world"]));

      const chunks: string[] = [];
      let doneText = "";

      await streamOllamaChat(
        "http://localhost:11434",
        makePersona(),
        "Hi",
        (t) => chunks.push(t),
        (t) => { doneText = t; },
        () => {},
      );

      assert.deepEqual(chunks, ["Hello", " world"]);
      assert.equal(doneText, "Hello world");
    });

    it("strips <think>...</think> blocks from onDone text", async () => {
      fetchMock.mock.mockImplementation(async () =>
        mockStreamResponse(["<think>reasoning</think>", "Answer"]),
      );

      let doneText = "";
      await streamOllamaChat(
        "http://localhost:11434",
        makePersona(),
        "Hi",
        () => {},
        (t) => { doneText = t; },
        () => {},
      );

      assert.equal(doneText, "Answer");
    });

    it("suppresses <think> content from onChunk", async () => {
      fetchMock.mock.mockImplementation(async () =>
        mockStreamResponse(["<think>", "internal", "</think>", "visible"]),
      );

      const chunks: string[] = [];
      await streamOllamaChat(
        "http://localhost:11434",
        makePersona(),
        "Hi",
        (t) => chunks.push(t),
        () => {},
        () => {},
      );

      // Only "visible" should have been sent via onChunk
      assert.deepEqual(chunks, ["visible"]);
    });

    it("calls onError on fetch failure", async () => {
      fetchMock.mock.mockImplementation(async () => {
        throw new Error("Network error");
      });

      let caughtError: Error | null = null;
      await streamOllamaChat(
        "http://localhost:11434",
        makePersona(),
        "Hi",
        () => {},
        () => {},
        (err) => { caughtError = err; },
      );

      assert.notEqual(caughtError, null);
      assert.match(caughtError!.message, /Network error/);
    });

    it("calls onError when response is not ok", async () => {
      fetchMock.mock.mockImplementation(async () => mockStreamResponse([], 500));

      let caughtError: Error | null = null;
      await streamOllamaChat(
        "http://localhost:11434",
        makePersona(),
        "Hi",
        () => {},
        () => {},
        (err) => { caughtError = err; },
      );

      assert.notEqual(caughtError, null);
      assert.match(caughtError!.message, /Ollama returned 500/);
    });

  });

  // =========================================================================
  // cleanPersonaResponse tests
  // =========================================================================

  describe("cleanPersonaResponse", () => {
    it("strips thinking blocks", () => {
      assert.equal(cleanPersonaResponse("<think>reasoning</think>Answer", "Bot"), "Answer");
    });

    it("strips persona name prefix with bold", () => {
      assert.equal(cleanPersonaResponse("**Pharmacius** : Bonjour!", "Pharmacius"), "Bonjour!");
    });

    it("strips persona name prefix without bold", () => {
      assert.equal(cleanPersonaResponse("Pharmacius : Bonjour!", "Pharmacius"), "Bonjour!");
    });

    it("strips persona name prefix with newline", () => {
      assert.equal(cleanPersonaResponse("**Bot** :\nHello", "Bot"), "Hello");
    });

    it("returns text unchanged if no prefix", () => {
      assert.equal(cleanPersonaResponse("Just a response", "Bot"), "Just a response");
    });

    it("trims whitespace", () => {
      assert.equal(cleanPersonaResponse("  hello  ", "Bot"), "hello");
    });
  });

  // =========================================================================
  // executeToolCall tests
  // =========================================================================

  describe("executeToolCall", () => {
    it("web_search returns searchWeb result", async () => {
      mockSearchWeb.mock.mockImplementation(async () => "web results");
      const result = await executeToolCall("web_search", { query: "test" }, undefined);
      assert.equal(result, "web results");
      assert.equal(mockSearchWeb.mock.callCount(), 1);
    });

    it("image_generate returns seed message on success", async () => {
      mockGenerateImage.mock.mockImplementation(async () => ({ imageBase64: "x", seed: 99 }));
      const result = await executeToolCall("image_generate", { prompt: "cat" }, undefined);
      assert.match(result, /seed 99/);
    });

    it("image_generate returns error message on null", async () => {
      mockGenerateImage.mock.mockImplementation(async () => null as unknown as { imageBase64: string; seed: number });
      const result = await executeToolCall("image_generate", { prompt: "cat" }, undefined);
      assert.match(result, /Erreur/);
    });

    it("rag_search returns joined results", async () => {
      const rag = {
        size: 5,
        search: mock.fn(async () => [{ text: "doc1" }, { text: "doc2" }]),
      };
      const result = await executeToolCall("rag_search", { query: "find" }, rag);
      assert.match(result, /doc1/);
      assert.match(result, /doc2/);
      assert.match(result, /---/);
    });

    it("rag_search without RAG returns message", async () => {
      const result = await executeToolCall("rag_search", { query: "find" }, undefined);
      assert.match(result, /Pas de documents/);
    });

    it("rag_search with empty RAG returns message", async () => {
      const rag = { size: 0, search: mock.fn(async () => []) };
      const result = await executeToolCall("rag_search", { query: "find" }, rag);
      assert.match(result, /Pas de documents/);
    });

    it("unknown tool returns error message", async () => {
      const result = await executeToolCall("unknown_tool", {}, undefined);
      assert.match(result, /Outil inconnu.*unknown_tool/);
    });
  });

  // =========================================================================
  // streamOllamaChatWithTools tests
  // =========================================================================

  describe("streamOllamaChatWithTools", () => {
    const sampleTool = {
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the web",
        parameters: {
          type: "object" as const,
          properties: { query: { type: "string", description: "query" } },
          required: ["query"],
        },
      },
    };

    it("fast-paths to streaming when message has no tool hints", async () => {
      fetchMock.mock.mockImplementation(async () => mockStreamResponse(["streamed"]));

      const chunks: string[] = [];
      let doneText = "";

      await streamOllamaChatWithTools(
        "http://localhost:11434",
        makePersona(),
        "Hi",
        [sampleTool],
        undefined,
        (t) => chunks.push(t),
        (t) => { doneText = t; },
        () => {},
      );

      // Should stream directly (no probe), so 1 fetch call
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.deepEqual(chunks, ["streamed"]);
      assert.equal(doneText, "streamed");
    });

    it("returns direct response when no tool calls", async () => {
      fetchMock.mock.mockImplementation(async () =>
        mockJsonResponse({ message: { role: "assistant", content: "Direct answer" } }),
      );

      const chunks: string[] = [];
      let doneText = "";

      await streamOllamaChatWithTools(
        "http://localhost:11434",
        makePersona(),
        "cherche quelque chose",
        [sampleTool],
        undefined,
        (t) => chunks.push(t),
        (t) => { doneText = t; },
        () => {},
      );

      assert.deepEqual(chunks, ["Direct answer"]);
      assert.equal(doneText, "Direct answer");
    });

    it("strips thinking from direct response", async () => {
      fetchMock.mock.mockImplementation(async () =>
        mockJsonResponse({
          message: { role: "assistant", content: "<think>hmm</think>Real answer" },
        }),
      );

      let doneText = "";
      await streamOllamaChatWithTools(
        "http://localhost:11434",
        makePersona(),
        "cherche une image",
        [sampleTool],
        undefined,
        () => {},
        (t) => { doneText = t; },
        () => {},
      );

      assert.equal(doneText, "Real answer");
    });

    it("executes tool calls then streams final response", async () => {
      let callCount = 0;
      fetchMock.mock.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Probe call: respond with tool_calls
          return mockJsonResponse({
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "test" } } },
              ],
            },
          });
        }
        // Streaming call: final response
        return mockStreamResponse(["Final ", "answer"]);
      });

      mockSearchWeb.mock.mockImplementation(async () => "web result");

      const chunks: string[] = [];
      let doneText = "";

      await streamOllamaChatWithTools(
        "http://localhost:11434",
        makePersona(),
        "search for something",
        [sampleTool],
        undefined,
        (t) => chunks.push(t),
        (t) => { doneText = t; },
        () => {},
      );

      assert.equal(mockSearchWeb.mock.callCount(), 1);
      assert.deepEqual(chunks, ["Final ", "answer"]);
      assert.equal(doneText, "Final answer");
      // Two fetch calls: probe + stream
      assert.equal(fetchMock.mock.callCount(), 2);
    });

    it("calls onError on fetch failure", async () => {
      fetchMock.mock.mockImplementation(async () => {
        throw new Error("connection refused");
      });

      let caughtError: Error | null = null;
      await streamOllamaChatWithTools(
        "http://localhost:11434",
        makePersona(),
        "search the web",
        [sampleTool],
        undefined,
        () => {},
        () => {},
        (err) => { caughtError = err; },
      );

      assert.notEqual(caughtError, null);
      assert.match(caughtError!.message, /connection refused/);
    });

    it("calls onError when probe response is not ok", async () => {
      fetchMock.mock.mockImplementation(async () =>
        mockJsonResponse({}, 503),
      );

      let caughtError: Error | null = null;
      await streamOllamaChatWithTools(
        "http://localhost:11434",
        makePersona(),
        "search the internet",
        [sampleTool],
        undefined,
        () => {},
        () => {},
        (err) => { caughtError = err; },
      );

      assert.notEqual(caughtError, null);
      assert.match(caughtError!.message, /503/);
    });

    it("handles tool execution errors gracefully", async () => {
      let callCount = 0;
      fetchMock.mock.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return mockJsonResponse({
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                { function: { name: "web_search", arguments: { query: "fail" } } },
              ],
            },
          });
        }
        return mockStreamResponse(["recovered"]);
      });

      mockSearchWeb.mock.mockImplementation(async () => {
        throw new Error("search failed");
      });

      let doneText = "";
      await streamOllamaChatWithTools(
        "http://localhost:11434",
        makePersona(),
        "search for images",
        [sampleTool],
        undefined,
        () => {},
        (t) => { doneText = t; },
        () => {},
      );

      // Should still complete - tool error is caught and passed as context
      assert.equal(doneText, "recovered");
    });
  });
});
