import logger from "./logger.js";

// ---------------------------------------------------------------------------
// Web search (DuckDuckGo Lite scraping)
// ---------------------------------------------------------------------------

export async function searchWeb(query: string): Promise<string> {
  // Try SearXNG first (self-hosted, no API key)
  const searxngUrl = process.env.SEARXNG_URL || "http://localhost:8080";
  try {
    const response = await fetch(`${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&engines=google,bing,duckduckgo`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "KXKM_Clown/2.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const data = await response.json() as { results?: Array<{ title?: string; content?: string; url?: string }> };
      if (data.results && data.results.length > 0) {
        return data.results
          .slice(0, 5)
          .map((r, i) => `${i + 1}. ${r.title || "Sans titre"}\n   ${r.content || ""}\n   ${r.url || ""}`)
          .join("\n\n");
      }
    }
  } catch {
    // SearXNG unavailable, fallback to DuckDuckGo
  }

  // Existing DuckDuckGo/custom API code continues below...
  const apiBase = process.env.WEB_SEARCH_API_BASE;

  if (apiBase) {
    // Custom search API
    const response = await fetch(`${apiBase}?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "KXKM_Clown/2.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Search API returned ${response.status}`);
    const data = (await response.json()) as { results?: Array<{ title?: string; snippet?: string; url?: string }> };
    if (data.results && data.results.length > 0) {
      return data.results
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.title || "Sans titre"}\n   ${r.snippet || ""}\n   ${r.url || ""}`)
        .join("\n\n");
    }
    return "(Aucun résultat)";
  }

  // DuckDuckGo HTML API (json format, more reliable than Lite HTML scraping)
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const response = await fetch(url, {
    headers: { "User-Agent": "KXKM_Clown/2.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`DuckDuckGo returned ${response.status}`);

  const data = (await response.json()) as {
    Abstract?: string;
    AbstractSource?: string;
    AbstractURL?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const results: Array<{ title: string; snippet: string; link: string }> = [];

  // Abstract (main result)
  if (data.Abstract && data.AbstractURL) {
    results.push({
      title: data.AbstractSource || "Résultat principal",
      snippet: data.Abstract.slice(0, 300),
      link: data.AbstractURL,
    });
  }

  // Related topics
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics) {
      if (results.length >= 5) break;
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(" - ")[0]?.slice(0, 80) || "",
          snippet: topic.Text.slice(0, 200),
          link: topic.FirstURL,
        });
      }
    }
  }

  if (results.length === 0) {
    // Fallback: try DuckDuckGo Lite HTML
    const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const liteRes = await fetch(liteUrl, {
      headers: { "User-Agent": "KXKM_Clown/2.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (liteRes.ok) {
      const html = await liteRes.text();
      // Extract any <a> with href containing http
      const linkRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(html)) !== null && results.length < 5) {
        const link = m[1] || "";
        const title = (m[2] || "").replace(/<[^>]*>/g, "").trim();
        if (title && link && !link.includes("duckduckgo.com")) {
          results.push({ title, snippet: "", link });
        }
      }
    }
  }

  if (results.length === 0) {
    logger.warn(`[web-search] No results for "${query}"`);
    return "(Aucun résultat trouvé)";
  }


  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.link}`)
    .join("\n\n");
}
