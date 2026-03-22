/**
 * LLM Client — routes through mascarade /v1/chat/completions with Ollama fallback
 *
 * mascarade /v1/chat/completions endpoint (OpenAI-compatible):
 *   POST { model, messages, temperature, max_tokens }
 *   Returns: { model, choices: [{ message: { content } }], usage }
 *
 * Fallback: direct Ollama /api/chat if mascarade is unavailable
 */

import logger from "./logger.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MASCARADE_URL = process.env.MASCARADE_URL || "http://127.0.0.1:8100";
const MASCARADE_API_KEY = process.env.MASCARADE_API_KEY || "";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "45000", 10);
const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || "qwen3.5:9b";

// RouteLLM-style complexity routing
const ROUTELLM_ENABLED = process.env.ROUTELLM_ENABLED === "true";
const ROUTELLM_THRESHOLD = parseFloat(process.env.ROUTELLM_THRESHOLD || "0.6");

// Track mascarade availability with exponential backoff
let mascaradeAvailable = true;
let mascaradeLastCheck = 0;
let mascaradeFailCount = 0;
function mascaradeRecheckMs(): number {
  if (mascaradeFailCount <= 1) return 5_000;
  if (mascaradeFailCount <= 3) return 15_000;
  return 60_000; // After 3+ failures, check every 60s
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  numCtx?: number;
  numBatch?: number;
  keepAlive?: string;
  think?: boolean | undefined;
  tools?: unknown[];
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  toolCalls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  thinking?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function checkMascaradeHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${MASCARADE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    mascaradeAvailable = resp.ok;
    mascaradeLastCheck = Date.now();
    if (resp.ok) mascaradeFailCount = 0;
    else mascaradeFailCount++;
    return resp.ok;
  } catch {
    mascaradeAvailable = false;
    mascaradeLastCheck = Date.now();
    mascaradeFailCount++;
    return false;
  }
}

function shouldTryMascarade(): boolean {
  if (mascaradeAvailable) return true;
  return Date.now() - mascaradeLastCheck > mascaradeRecheckMs();
}

// ---------------------------------------------------------------------------
// Parse model: detect "provider:model" vs plain Ollama model
// ---------------------------------------------------------------------------

function parseModel(model: string | undefined): { provider: string | null; model: string } {
  const m = model || DEFAULT_MODEL;
  const knownProviders = ["claude", "openai", "mistral-api", "google", "bedrock", "huggingface", "ollama", "llama_cpp"];
  const colonIdx = m.indexOf(":");
  if (colonIdx > 0) {
    const prefix = m.slice(0, colonIdx);
    if (knownProviders.includes(prefix)) {
      return { provider: prefix, model: m.slice(colonIdx + 1) };
    }
  }
  // Ollama model (qwen3.5:9b, mistral:7b, etc.) — let mascarade route via default provider
  return { provider: null, model: m };
}

// ---------------------------------------------------------------------------
// RouteLLM — complexity scoring for smart routing
// ---------------------------------------------------------------------------

/**
 * Score message complexity (0-1). Higher = needs stronger model.
 * 0.0-0.3: trivial (salut, oui, merci) → local Ollama
 * 0.3-0.6: moderate (short questions) → local Ollama
 * 0.6-1.0: complex (analysis, code, multilingual) → strong provider if available
 */
function scoreComplexity(messages: ChatMessage[]): number {
  const lastUser = messages.filter(m => m.role === "user").pop();
  if (!lastUser) return 0;
  const text = lastUser.content;
  const len = text.length;
  let score = 0;

  // Length factor
  if (len < 20) score += 0;
  else if (len < 100) score += 0.1;
  else if (len < 300) score += 0.3;
  else score += 0.5;

  // Complexity keywords (FR + EN)
  const complexKeywords = [
    "explique", "explain", "analyse", "analyze", "compare", "pourquoi",
    "comment fonctionne", "how does", "architecture", "conception",
    "avantages et inconvenients", "pros and cons", "difference entre",
    "en detail", "approfondi", "comprehensive", "strategie",
    "code", "function", "class", "import", "const ", "let ",
    "algorithme", "algorithm", "optimise", "debug", "refactor",
  ];
  if (complexKeywords.some(kw => text.toLowerCase().includes(kw))) score += 0.3;

  // Code detection
  if (/```|{[\s\S]*}|function\s|class\s|import\s|const\s/.test(text)) score += 0.2;

  // Multi-step request
  if (/\d+\.\s|premierement|deuxiemement|d'abord.*ensuite|step\s*\d/i.test(text)) score += 0.15;

  // Question marks (more = more complex)
  const qCount = (text.match(/\?/g) || []).length;
  if (qCount >= 3) score += 0.1;

  return Math.min(score, 1.0);
}

/**
 * Decide routing based on complexity score.
 * Returns "ollama" to force local, "mascarade" to prefer strong provider, or null for default behavior.
 */
function routeByComplexity(messages: ChatMessage[]): { route: "ollama" | "mascarade" | null; complexity: number } {
  if (!ROUTELLM_ENABLED) return { route: null, complexity: -1 };
  const complexity = scoreComplexity(messages);
  if (complexity < ROUTELLM_THRESHOLD) {
    return { route: "ollama", complexity };
  }
  return { route: "mascarade", complexity };
}

// ---------------------------------------------------------------------------
// Non-streaming: mascarade /send → Ollama fallback
// ---------------------------------------------------------------------------

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
  const { route, complexity } = routeByComplexity(messages);

  // RouteLLM: skip mascarade entirely for simple messages
  if (route === "ollama") {
    logger.debug({ complexity, threshold: ROUTELLM_THRESHOLD }, "[llm] routeLLM → ollama (simple)");
    return chatViaOllama(messages, opts);
  }

  if (route === "mascarade") {
    logger.debug({ complexity, threshold: ROUTELLM_THRESHOLD }, "[llm] routeLLM → mascarade (complex)");
  }

  if (shouldTryMascarade()) {
    try {
      return await chatViaMascarade(messages, opts);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[llm] mascarade /v1/chat/completions failed, falling back to Ollama");
      mascaradeAvailable = false;
      mascaradeLastCheck = Date.now();
      mascaradeFailCount++;
    }
  }
  return chatViaOllama(messages, opts);
}

// ---------------------------------------------------------------------------
// Streaming: direct Ollama (mascarade /send is non-streaming)
// When mascarade adds streaming support, we can route through it.
// For now: non-streaming probe via mascarade, streaming via Ollama.
// ---------------------------------------------------------------------------

export async function* streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, ChatResponse> {
  // Streaming = ALWAYS direct Ollama for minimum latency.
  // mascarade /v1/chat/completions is non-streaming → would add 2-3s overhead.
  // Only use mascarade for non-streaming calls (tool probes, /agent, /orchestrate).
  // When mascarade adds SSE streaming, we can route through it.
  const { model } = parseModel(opts.model);
  const isCloudProvider = opts.model && /^(claude|openai|mistral-api|google|bedrock):/.test(opts.model);

  // Exception: if user explicitly requests a cloud provider, use mascarade (non-streaming)
  if (isCloudProvider && shouldTryMascarade()) {
    try {
      const result = await chatViaMascarade(messages, opts);
      if (result.content) { yield result.content; return result; }
    } catch { /* fall through to Ollama */ }
  }

  // Stream via Ollama (fastest path for real-time chat)
  return yield* streamViaOllama(messages, opts);
}

// ---------------------------------------------------------------------------
// Mascarade /v1/chat/completions (OpenAI-compatible, with full routing)
// ---------------------------------------------------------------------------

async function chatViaMascarade(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const { provider, model } = parseModel(opts.model);
    const modelStr = provider ? `${provider}:${model}` : model;

    const resp = await fetch(`${MASCARADE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelStr,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens || 800,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`mascarade ${resp.status}: ${resp.statusText}`);

    const data = await resp.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = data.choices?.[0];

    logger.debug({
      model: data.model || modelStr,
      usage: data.usage,
    }, "[llm] mascarade /v1/chat/completions response");

    return {
      content: choice?.message?.content || "",
      model: data.model || modelStr,
      provider: "mascarade",
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      } : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Direct Ollama (fallback + streaming)
// ---------------------------------------------------------------------------

async function chatViaOllama(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const { model } = parseModel(opts.model);

  try {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          num_predict: opts.maxTokens || 800,
          ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
          num_batch: opts.numBatch || 512,
        },
        keep_alive: opts.keepAlive || "30m",
        ...(opts.think !== undefined ? { think: opts.think } : {}),
        ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${resp.statusText}`);

    const data = await resp.json() as {
      message?: { content?: string; thinking?: string; tool_calls?: ChatResponse["toolCalls"] };
    };

    return {
      content: data.message?.content || "",
      model,
      provider: "ollama",
      toolCalls: data.message?.tool_calls,
      thinking: data.message?.thinking,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function* streamViaOllama(
  messages: ChatMessage[],
  opts: ChatOptions,
): AsyncGenerator<string, ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const { model } = parseModel(opts.model);

  try {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        options: {
          num_predict: opts.maxTokens || 800,
          ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
          num_batch: opts.numBatch || 512,
        },
        keep_alive: opts.keepAlive || "30m",
        think: false,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${resp.statusText}`);

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";
    let inThinking = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n").filter(Boolean)) {
        if (line.length > 102_400) continue; // Skip oversized chunks (100KB max)
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          if (parsed.message?.content) {
            const c = parsed.message.content;
            fullText += c;
            if (c.includes("<think>")) inThinking = true;
            if (!inThinking) yield c;
            if (c.includes("</think>")) inThinking = false;
          }
        } catch { /* partial JSON */ }
      }
    }

    const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    return { content: cleaned, model, provider: "ollama" };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export async function getProviders(): Promise<string[]> {
  try {
    const resp = await fetch(`${MASCARADE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return ["ollama"];
    const data = await resp.json() as { providers?: string[] };
    return data.providers || ["ollama"];
  } catch {
    return ["ollama"];
  }
}
