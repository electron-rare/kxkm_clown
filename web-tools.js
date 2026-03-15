const DEFAULT_SEARCH_BASE = "https://html.duckduckgo.com/html/";
const DEFAULT_TIMEOUT_MS = 12000;

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripHtml(text) {
  return decodeHtml(
    String(text || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function extractDuckDuckGoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, DEFAULT_SEARCH_BASE);
    const redirected = url.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : url.toString();
  } catch {
    return rawUrl;
  }
}

function parseDuckDuckGoResults(html, limit) {
  const results = [];
  const blockRegex = /<div[^>]+class="[^"]*result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi;
  const blocks = html.match(blockRegex) || [];

  for (const block of blocks) {
    if (results.length >= limit) break;

    const titleMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const snippetMatch = block.match(/<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const url = extractDuckDuckGoUrl(titleMatch[1]);
    const title = stripHtml(titleMatch[2]);
    const snippet = stripHtml(snippetMatch?.[1] || "");

    if (!url || !title) continue;
    results.push({ title, url, snippet });
  }

  return results.slice(0, limit);
}

function normalizeSearchResults(payload, limit) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  return items
    .map((item) => ({
      title: stripHtml(item.title || item.name || ""),
      url: String(item.url || item.link || "").trim(),
      snippet: stripHtml(item.snippet || item.description || item.summary || ""),
    }))
    .filter((item) => item.title && item.url)
    .slice(0, limit);
}

function extractTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : "";
}

function enforceHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    const error = new Error(`URL invalide: ${rawUrl}`);
    error.statusCode = 400;
    throw error;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    const error = new Error("Seules les URLs http(s) sont autorisées");
    error.statusCode = 400;
    throw error;
  }

  return url.toString();
}

function truncate(text, maxLength) {
  return String(text || "").slice(0, maxLength);
}

function createWebTools({
  searchApiBase = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  async function searchWeb(query, limit = 5) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      const error = new Error("La recherche web exige une requête");
      error.statusCode = 400;
      throw error;
    }

    const { signal, clear } = getAbortSignal(timeoutMs);

    try {
      if (searchApiBase) {
        const url = new URL(searchApiBase);
        url.searchParams.set("q", normalizedQuery);
        url.searchParams.set("limit", String(limit));
        const response = await fetch(url, {
          headers: { accept: "application/json" },
          signal,
        });
        if (!response.ok) {
          throw new Error(`Web search ${response.status}`);
        }
        return normalizeSearchResults(await response.json(), limit);
      }

      const url = new URL(DEFAULT_SEARCH_BASE);
      url.searchParams.set("q", normalizedQuery);
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "KXKM_Clown/0.3 web-search",
        },
        signal,
      });
      if (!response.ok) {
        throw new Error(`Web search ${response.status}`);
      }

      const html = await response.text();
      return parseDuckDuckGoResults(html, limit);
    } finally {
      clear();
    }
  }

  async function fetchWebPage(rawUrl) {
    const url = enforceHttpUrl(rawUrl);
    const { signal, clear } = getAbortSignal(timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain,application/json",
          "user-agent": "KXKM_Clown/0.3 web-fetch",
        },
        redirect: "follow",
        signal,
      });

      if (!response.ok) {
        throw new Error(`Page ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      const pageTitle = contentType.includes("html") ? extractTitle(text) : "";
      const cleaned = contentType.includes("html") ? stripHtml(text) : text.replace(/\s+/g, " ").trim();

      return {
        url: response.url || url,
        title: pageTitle,
        contentType,
        excerpt: truncate(cleaned, 1200),
        text: truncate(cleaned, 6000),
      };
    } finally {
      clear();
    }
  }

  return {
    searchWeb,
    fetchWebPage,
  };
}

module.exports = {
  createWebTools,
};
