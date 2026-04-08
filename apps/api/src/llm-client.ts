/**
 * Canonical LLM client.
 *
 * Local runtime:
 *   vLLM / TurboQuant exposed via OpenAI-compatible `/v1/chat/completions`
 *
 * Optional cloud routing:
 *   Mascarade `/v1/chat/completions` for explicit cloud provider models
 */

import logger from "./logger.js";
import { incrementCounter } from "./perf.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MASCARADE_URL = process.env.MASCARADE_URL || "http://127.0.0.1:8100";
const MASCARADE_API_KEY = process.env.MASCARADE_API_KEY || "";
const LLM_URL = process.env.LLM_URL || "http://127.0.0.1:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen-14b-awq";
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "45000", 10);
const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || LLM_MODEL;

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
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatToolCall {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
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
  toolCalls?: ChatToolCall[];
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
// Parse model: detect "provider:model" vs local runtime model
// ---------------------------------------------------------------------------

function parseModel(model: string | undefined): { provider: string | null; model: string } {
  const m = model || DEFAULT_MODEL;
  const knownProviders = ["claude", "openai", "mistral-api", "google", "bedrock", "huggingface"];
  const colonIdx = m.indexOf(":");
  if (colonIdx > 0) {
    const prefix = m.slice(0, colonIdx);
    if (knownProviders.includes(prefix)) {
      return { provider: prefix, model: m.slice(colonIdx + 1) };
    }
  }
  // Local runtime model (qwen3.5:9b, qwen-14b-awq, mistral:7b, etc.)
  return { provider: null, model: m };
}

function resolveRuntimeModel(model: string | undefined): string {
  const parsed = parseModel(model);
  if (parsed.provider) {
    return DEFAULT_MODEL;
  }
  return parsed.model || DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// RouteLLM — complexity scoring for smart routing
// ---------------------------------------------------------------------------

/**
 * Score message complexity (0-1). Higher = needs stronger model.
 * 0.0-0.3: trivial (salut, oui, merci) → runtime local
 * 0.3-0.6: moderate (short questions) → runtime local
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
 * Returns "runtime" to force local, "mascarade" to prefer strong provider, or null for default behavior.
 */
function routeByComplexity(messages: ChatMessage[]): { route: "runtime" | "mascarade" | null; complexity: number } {
  if (!ROUTELLM_ENABLED) return { route: null, complexity: -1 };
  const complexity = scoreComplexity(messages);
  if (complexity < ROUTELLM_THRESHOLD) {
    return { route: "runtime", complexity };
  }
  return { route: "mascarade", complexity };
}

// ---------------------------------------------------------------------------
// Non-streaming: local runtime primary, mascarade only for explicit cloud/provider routing
// ---------------------------------------------------------------------------

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
  const { provider } = parseModel(opts.model);
  const { route, complexity } = routeByComplexity(messages);

  if (!provider) {
    if (route === "runtime") {
      logger.debug({ complexity, threshold: ROUTELLM_THRESHOLD }, "[llm] routeLLM → runtime (simple)");
    }
    return chatViaRuntime(messages, opts);
  }

  if (route === "mascarade") {
    logger.debug({ complexity, threshold: ROUTELLM_THRESHOLD }, "[llm] routeLLM → mascarade (complex)");
  }

  if (!shouldTryMascarade()) {
    throw new Error("Mascarade unavailable for explicit cloud provider routing");
  }
  return chatViaMascarade(messages, opts);
}

// ---------------------------------------------------------------------------
// Streaming: mascarade SSE for cloud providers, direct runtime for local
// ---------------------------------------------------------------------------

export async function* streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, ChatResponse> {
  const isCloudProvider = Boolean(opts.model && /^(claude|openai|mistral-api|google|bedrock):/.test(opts.model));

  // Cloud providers → stream via mascarade SSE (real streaming, not dump-all)
  if (isCloudProvider && shouldTryMascarade()) {
    try {
      return yield* streamViaMascarade(messages, opts);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[llm] mascarade stream failed");
      mascaradeAvailable = false;
      mascaradeLastCheck = Date.now();
      mascaradeFailCount++;
      throw err;
    }
  }

  // Local models → stream via runtime directly (fastest path)
  return yield* streamViaRuntime(messages, opts);
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
      headers: { "Content-Type": "application/json", ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
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
      choices?: Array<{ message?: { content?: string; thinking?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = data.choices?.[0];
    let content = choice?.message?.content || "";

    // Strip inline <think>...</think> blocks (qwen3.5 may embed them in content)
    if (content.includes("<think>")) {
      content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    }

    // If content is still empty but thinking field has content (qwen3.5 thinking mode),
    // extract the actual response from thinking
    if (!content && choice?.message?.thinking) {
      const thinking = choice.message.thinking;
      const stripped = thinking.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
      if (stripped) {
        content = stripped;
      } else {
        const answerMatch = thinking.match(/(?:Answer|Response|Réponse|Output|Conclusion)\s*:\s*([\s\S]+)$/i);
        content = answerMatch ? answerMatch[1]!.trim() : thinking.split("\n\n").pop()?.trim() || "";
      }
      if (content) {
        logger.debug("[llm] mascarade: extracted content from thinking field");
      }
    }

    incrementCounter("llm_mascarade_calls");
    if (data.usage?.total_tokens) incrementCounter("llm_tokens", data.usage.total_tokens);

    logger.debug({
      model: data.model || modelStr,
      usage: data.usage,
    }, "[llm] mascarade /v1/chat/completions response");

    return {
      content,
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
// Mascarade SSE streaming (cloud providers: Claude, OpenAI, Mistral, Google)
// ---------------------------------------------------------------------------

async function* streamViaMascarade(
  messages: ChatMessage[],
  opts: ChatOptions,
): AsyncGenerator<string, ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const { provider, model } = parseModel(opts.model);
  const modelStr = provider ? `${provider}:${model}` : model;

  try {
    const resp = await fetch(`${MASCARADE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(MASCARADE_API_KEY ? { Authorization: `Bearer ${MASCARADE_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: modelStr,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens || 800,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`mascarade stream ${resp.status}: ${resp.statusText}`);

    // Mark mascarade as available on successful connection
    mascaradeAvailable = true;
    mascaradeFailCount = 0;
    mascaradeLastCheck = Date.now();

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body from mascarade");

    const decoder = new TextDecoder();
    let fullText = "";
    let respModel = modelStr;
    let buffer = "";
    let inThinking = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6); // Remove "data: " prefix
        if (payload === "[DONE]") continue;

        try {
          const chunk = JSON.parse(payload) as {
            model?: string;
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
          };
          if (chunk.model) respModel = chunk.model;
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            // Suppress <think>...</think> blocks from streaming to client
            if (content.includes("<think>")) inThinking = true;
            if (!inThinking) {
              yield content;
            }
            if (content.includes("</think>")) {
              inThinking = false;
              const after = content.split("</think>").pop() || "";
              if (after.trim()) yield after;
            }
          }
        } catch { /* partial JSON, skip */ }
      }
    }

    // Strip thinking blocks from final accumulated text
    const cleanedText = fullText.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

    incrementCounter("llm_mascarade_stream");
    logger.debug({ model: respModel, chars: cleanedText.length }, "[llm] mascarade SSE stream complete");

    return {
      content: cleanedText,
      model: respModel,
      provider: "mascarade",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Direct runtime (vLLM / TurboQuant)
// ---------------------------------------------------------------------------

function toOpenAIMessage(message: ChatMessage): Record<string, unknown> {
  const base: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };
  if (message.tool_calls && message.tool_calls.length > 0) {
    base.tool_calls = message.tool_calls.map((toolCall) => ({
      id: toolCall.id,
      type: toolCall.type || "function",
      function: {
        name: toolCall.function.name,
        arguments: typeof toolCall.function.arguments === "string"
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function.arguments),
      },
    }));
  }
  if (message.role === "tool" && message.tool_call_id) {
    base.tool_call_id = message.tool_call_id;
  }
  return base;
}

async function chatViaRuntime(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const model = resolveRuntimeModel(opts.model);

  try {
    const resp = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({
        model,
        messages: messages.map(toOpenAIMessage),
        stream: false,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens || 800,
        ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`vLLM ${resp.status}: ${resp.statusText}`);
    incrementCounter("llm_runtime_calls");

    const data = await resp.json() as {
      choices?: [{ message?: { content?: string; tool_calls?: ChatResponse["toolCalls"] } }];
    };

    const msg = data.choices?.[0]?.message;
    return {
      content: msg?.content || "",
      model,
      provider: "vllm",
      toolCalls: msg?.tool_calls,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function* streamViaRuntime(
  messages: ChatMessage[],
  opts: ChatOptions,
): AsyncGenerator<string, ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const model = resolveRuntimeModel(opts.model);

  try {
    const resp = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({
        model,
        messages: messages.map(toOpenAIMessage),
        stream: true,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens || 800,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`vLLM ${resp.status}: ${resp.statusText}`);

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";
    let inThinking = false;
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") break;
        try {
          const parsed = JSON.parse(raw) as { choices?: [{ delta?: { content?: string } }] };
          const c = parsed.choices?.[0]?.delta?.content;
          if (c) {
            fullText += c;
            if (c.includes("<think>")) inThinking = true;
            if (!inThinking) yield c;
            if (c.includes("</think>")) inThinking = false;
          }
        } catch { /* partial JSON */ }
      }
    }

    const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    return { content: cleaned, model, provider: "vllm" };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export async function getProviders(): Promise<string[]> {
  const providers = ["vllm-turboquant"];
  try {
    const resp = await fetch(`${MASCARADE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return providers;
    const data = await resp.json() as { providers?: string[] };
    return [...providers, ...(data.providers || [])];
  } catch {
    return providers;
  }
}
