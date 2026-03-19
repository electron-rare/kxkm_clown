process.env.NODE_ENV = "test";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchWeb } from "./web-search.js";

// Save original fetch
const originalFetch = globalThis.fetch;

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SEARXNG_URL;
  delete process.env.WEB_SEARCH_API_BASE;
});

describe("searchWeb", () => {
  it("returns results from SearXNG when available", async () => {
    process.env.SEARXNG_URL = "http://fake-searxng:8080";
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("fake-searxng")) {
        return new Response(JSON.stringify({
          results: [
            { title: "Result 1", content: "Snippet 1", url: "https://example.com/1" },
            { title: "Result 2", content: "Snippet 2", url: "https://example.com/2" },
          ],
        }), { status: 200 });
      }
      throw new Error("unexpected fetch: " + url);
    });

    const result = await searchWeb("test query");
    assert.ok(result.includes("Result 1"), "should contain first result title");
    assert.ok(result.includes("Snippet 1"), "should contain first result content");
    assert.ok(result.includes("https://example.com/1"), "should contain first result URL");
    assert.ok(result.includes("Result 2"), "should contain second result title");
  });

  it("falls back to DuckDuckGo when SearXNG fails", async () => {
    process.env.SEARXNG_URL = "http://fake-searxng:8080";
    delete process.env.WEB_SEARCH_API_BASE;
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("fake-searxng")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      if (url.includes("api.duckduckgo.com")) {
        return new Response(JSON.stringify({
          Abstract: "DuckDuckGo abstract text",
          AbstractSource: "Wikipedia",
          AbstractURL: "https://en.wikipedia.org/wiki/Test",
          RelatedTopics: [],
        }), { status: 200 });
      }
      if (url.includes("lite.duckduckgo.com")) {
        return new Response("<html></html>", { status: 200 });
      }
      throw new Error("unexpected fetch: " + url);
    });

    const result = await searchWeb("test query");
    assert.ok(result.includes("Wikipedia"), "should contain DDG abstract source");
    assert.ok(result.includes("DuckDuckGo abstract text"), "should contain DDG abstract");
  });

  it("handles no results gracefully", async () => {
    process.env.SEARXNG_URL = "http://fake-searxng:8080";
    delete process.env.WEB_SEARCH_API_BASE;
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("fake-searxng")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (url.includes("api.duckduckgo.com")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.includes("lite.duckduckgo.com")) {
        return new Response("<html></html>", { status: 200 });
      }
      throw new Error("unexpected fetch: " + url);
    });

    const result = await searchWeb("nonexistent thing");
    assert.ok(
      result.includes("Aucun résultat") || result.includes("aucun"),
      `should indicate no results, got: ${result}`,
    );
  });

  it("formats results with numbered list", async () => {
    process.env.SEARXNG_URL = "http://fake-searxng:8080";
    mockFetch(async () =>
      new Response(JSON.stringify({
        results: [
          { title: "A", content: "aa", url: "https://a.com" },
          { title: "B", content: "bb", url: "https://b.com" },
          { title: "C", content: "cc", url: "https://c.com" },
        ],
      }), { status: 200 }),
    );

    const result = await searchWeb("format test");
    assert.ok(result.includes("1. A"), "should have numbered item 1");
    assert.ok(result.includes("2. B"), "should have numbered item 2");
    assert.ok(result.includes("3. C"), "should have numbered item 3");
  });

  it("limits results to 5 items", async () => {
    process.env.SEARXNG_URL = "http://fake-searxng:8080";
    const results = Array.from({ length: 10 }, (_, i) => ({
      title: `R${i}`, content: `c${i}`, url: `https://${i}.com`,
    }));
    mockFetch(async () =>
      new Response(JSON.stringify({ results }), { status: 200 }),
    );

    const result = await searchWeb("many results");
    assert.ok(result.includes("5."), "should have item 5");
    assert.ok(!result.includes("6."), "should NOT have item 6");
  });
});
