/**
 * Deep Research Agent — multi-step search inspired by OpenSeeker.
 *
 * Pipeline:  question → search → visit pages → extract → refine query → repeat → synthesize
 *
 * Uses existing infrastructure:
 *   - SearXNG (web-search.ts) for queries
 *   - fetch for page visiting (SSRF-safe)
 *   - LLM (llm-client.ts) for reasoning/synthesis
 *   - RAG (rag.ts) for local knowledge (optional)
 */

import logger from "./logger.js";
import { searchWeb } from "./web-search.js";
import { chat, type ChatMessage, type ChatOptions } from "./llm-client.js";
import type { LocalRAG } from "./rag.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_STEPS = parseInt(process.env.DEEPRESEARCH_MAX_STEPS || "5", 10);
const MAX_PAGES = parseInt(process.env.DEEPRESEARCH_MAX_PAGES || "3", 10);
const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_CHARS = 8_000;
const STEP_TIMEOUT_MS = 30_000;

// SSRF protection — block private IPs
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1|\[::1\])/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResearchStep {
  type: "search" | "visit" | "think" | "synthesize";
  query?: string;
  url?: string;
  result: string;
  durationMs: number;
}

export interface ResearchResult {
  question: string;
  answer: string;
  steps: ResearchStep[];
  sources: string[];
  totalDurationMs: number;
}

export type ProgressCallback = (step: ResearchStep, stepIndex: number, total: number) => void;

// ---------------------------------------------------------------------------
// Page fetcher (SSRF-safe)
// ---------------------------------------------------------------------------

async function fetchPage(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      return "";
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "KXKM-DeepResearch/1.0 (compatible; research bot)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });

    if (!resp.ok) return "";

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("text/") && !contentType.includes("html") && !contentType.includes("json")) {
      return "";
    }

    const raw = await resp.text();
    return extractText(raw).slice(0, PAGE_MAX_CHARS);
  } catch {
    return "";
  }
}

/** Strip HTML tags, scripts, styles → plain text. */
function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// LLM helper — short call with tight token budget
// ---------------------------------------------------------------------------

async function llmCall(
  systemPrompt: string,
  userPrompt: string,
  opts?: Partial<ChatOptions>,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const result = await chat(messages, {
    maxTokens: 600,
    temperature: 0.3,
    think: false,
    ...opts,
  });
  return result.content.trim();
}

// ---------------------------------------------------------------------------
// Agent steps
// ---------------------------------------------------------------------------

/** Ask LLM to decompose a question into search queries. */
async function planQueries(question: string, previousFindings: string): Promise<string[]> {
  const prompt = previousFindings
    ? `Question originale: ${question}\n\nDécouvertes précédentes:\n${previousFindings}\n\nGénère 1 à 2 nouvelles requêtes de recherche web pour approfondir. Une par ligne, sans numérotation ni ponctuation superflue.`
    : `Question: ${question}\n\nGénère 2 à 3 requêtes de recherche web pertinentes pour répondre à cette question. Une par ligne, sans numérotation ni ponctuation superflue.`;

  const raw = await llmCall(
    "Tu es un assistant de recherche. Tu génères des requêtes de recherche web concises et pertinentes. Réponds uniquement avec les requêtes, une par ligne.",
    prompt,
  );

  return raw
    .split("\n")
    .map((l) => l.replace(/^\d+[\.\)]\s*/, "").replace(/^[-•]\s*/, "").trim())
    .filter((l) => l.length > 3 && l.length < 200)
    .slice(0, 3);
}

/** Ask LLM which URLs are worth visiting from search results. */
async function pickUrls(searchResults: string, question: string): Promise<string[]> {
  const raw = await llmCall(
    "Tu extrais les URLs les plus pertinentes des résultats de recherche. Réponds uniquement avec les URLs, une par ligne. Maximum 3.",
    `Question: ${question}\n\nRésultats:\n${searchResults}\n\nQuelles URLs visiter pour répondre au mieux ?`,
  );

  const urlRegex = /https?:\/\/[^\s"<>]+/g;
  const urls = raw.match(urlRegex) || [];
  return [...new Set(urls)].slice(0, MAX_PAGES);
}

/** Ask LLM to extract relevant facts from a page. */
async function extractFacts(pageText: string, question: string): Promise<string> {
  if (!pageText || pageText.length < 50) return "";
  return llmCall(
    "Tu extrais les faits pertinents d'un texte de page web pour répondre à une question. Sois concis et factuel. Si le texte n'est pas pertinent, réponds 'RIEN'.",
    `Question: ${question}\n\nContenu de la page (extrait):\n${pageText.slice(0, 4000)}\n\nFaits pertinents :`,
  );
}

/** Ask LLM if more research is needed. */
async function shouldContinue(question: string, findings: string, step: number): Promise<boolean> {
  if (step >= MAX_STEPS) return false;
  const answer = await llmCall(
    "Tu décides si une recherche supplémentaire est nécessaire. Réponds uniquement OUI ou NON.",
    `Question: ${question}\n\nDécouvertes actuelles:\n${findings}\n\nLes informations sont-elles suffisantes pour répondre de manière complète ? Réponds NON si tu as besoin de plus d'informations, OUI si c'est suffisant.`,
    { maxTokens: 10 },
  );
  return answer.toUpperCase().startsWith("NON");
}

/** Final synthesis with all gathered facts. */
async function synthesize(question: string, findings: string, sources: string[], ragContext?: string): Promise<string> {
  const ragPart = ragContext ? `\n\nConnaissances locales (RAG):\n${ragContext}` : "";
  return llmCall(
    "Tu es un chercheur expert. Tu synthétises des résultats de recherche approfondie en une réponse claire, structurée et sourcée. Utilise du markdown. Cite tes sources.",
    `Question: ${question}\n\nDécouvertes de la recherche:\n${findings}${ragPart}\n\nSources consultées:\n${sources.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nSynthèse complète :`,
    { maxTokens: 2000, temperature: 0.5 },
  );
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

export async function deepResearch(
  question: string,
  onProgress?: ProgressCallback,
  rag?: LocalRAG,
): Promise<ResearchResult> {
  const t0 = Date.now();
  const steps: ResearchStep[] = [];
  const sources: string[] = [];
  let findings = "";
  let stepIndex = 0;

  // Optional: check local RAG first
  let ragContext = "";
  if (rag) {
    try {
      const ragResults = await rag.search(question, 3);
      if (ragResults.length > 0) {
        ragContext = ragResults.map((r) => `[${r.source}] ${r.text}`).join("\n\n");
      }
    } catch {
      // RAG unavailable, continue without
    }
  }

  for (let round = 0; round < MAX_STEPS; round++) {
    // Step 1: Plan search queries
    const t1 = Date.now();
    const queries = await planQueries(question, findings);
    steps.push({
      type: "think",
      result: `Requêtes planifiées: ${queries.join(" | ")}`,
      durationMs: Date.now() - t1,
    });
    onProgress?.(steps[steps.length - 1]!, stepIndex++, MAX_STEPS * 3);

    // Step 2: Execute searches
    for (const query of queries) {
      const ts = Date.now();
      try {
        const results = await Promise.race([
          searchWeb(query),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), STEP_TIMEOUT_MS),
          ),
        ]);
        const step: ResearchStep = {
          type: "search",
          query,
          result: results.slice(0, 2000),
          durationMs: Date.now() - ts,
        };
        steps.push(step);
        onProgress?.(step, stepIndex++, MAX_STEPS * 3);

        // Step 3: Pick and visit best URLs
        const urls = await pickUrls(results, question);
        for (const url of urls) {
          if (sources.includes(url)) continue; // skip already visited
          const tv = Date.now();
          const pageText = await fetchPage(url);
          if (pageText) {
            const facts = await extractFacts(pageText, question);
            if (facts && !facts.startsWith("RIEN")) {
              findings += `\n\n[Source: ${url}]\n${facts}`;
              sources.push(url);
            }
            const visitStep: ResearchStep = {
              type: "visit",
              url,
              result: facts ? facts.slice(0, 500) : "(pas de contenu pertinent)",
              durationMs: Date.now() - tv,
            };
            steps.push(visitStep);
            onProgress?.(visitStep, stepIndex++, MAX_STEPS * 3);
          }
        }
      } catch (err) {
        logger.warn({ query, err: (err as Error).message }, "[deep-research] search step failed");
      }
    }

    // Step 4: Decide if we need more research
    if (round < MAX_STEPS - 1 && findings.length > 100) {
      const needMore = await shouldContinue(question, findings, round + 1);
      if (!needMore) break;
    }
  }

  // Step 5: Final synthesis
  const tSynth = Date.now();
  const answer = await synthesize(question, findings || "(aucune découverte)", sources, ragContext);
  const synthStep: ResearchStep = {
    type: "synthesize",
    result: answer.slice(0, 500),
    durationMs: Date.now() - tSynth,
  };
  steps.push(synthStep);
  onProgress?.(synthStep, stepIndex++, stepIndex);

  return {
    question,
    answer,
    steps,
    sources,
    totalDurationMs: Date.now() - t0,
  };
}
