/**
 * LLM Client — routes through mascarade (/send) with Ollama fallback
 *
 * mascarade /send endpoint:
 *   POST { messages, strategy, provider, model, system, temperature, max_tokens }
 *   Returns: { content, model, provider, tokens_used, cached }
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

// Track mascarade availability
let mascaradeAvailable = true;
let mascaradeLastCheck = 0;
const MASCARADE_RECHECK_MS = 30_000;

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
    return resp.ok;
  } catch {
    mascaradeAvailable = false;
    mascaradeLastCheck = Date.now();
    return false;
  }
}

function shouldTryMascarade(): boolean {
  if (mascaradeAvailable) return true;
  return Date.now() - mascaradeLastCheck > MASCARADE_RECHECK_MS;
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
// Non-streaming: mascarade /send → Ollama fallback
// ---------------------------------------------------------------------------

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
  if (shouldTryMascarade()) {
    try {
      return await chatViaMascarade(messages, opts);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[llm] mascarade /send failed, falling back to Ollama");
      mascaradeAvailable = false;
      mascaradeLastCheck = Date.now();
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
  // mascarade /send is non-streaming → use direct Ollama for streaming
  // This still benefits from mascarade for non-streaming calls (tool probes, etc.)
  return yield* streamViaOllama(messages, opts);
}

// ---------------------------------------------------------------------------
// Mascarade /send (non-streaming, with full routing + cache + metrics)
// ---------------------------------------------------------------------------

async function chatViaMascarade(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MASCARADE_API_KEY) headers["Authorization"] = `Bearer ${MASCARADE_API_KEY}`;

  const { provider, model } = parseModel(opts.model);

  // Extract system message from messages array
  const systemMsg = messages.find(m => m.role === "system");
  const chatMessages = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const resp = await fetch(`${MASCARADE_URL}/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: chatMessages,
        system: systemMsg?.content || undefined,
        provider: provider || undefined,
        model: model,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens || 800,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`mascarade /send ${resp.status}: ${resp.statusText}`);

    const data = await resp.json() as {
      content?: string;
      model?: string;
      provider?: string;
      tokens_used?: number;
      cached?: boolean;
      error?: string;
    };

    if (data.error) throw new Error(`mascarade: ${data.error}`);

    logger.debug({
      provider: data.provider,
      model: data.model,
      tokens: data.tokens_used,
      cached: data.cached,
    }, "[llm] mascarade response");

    return {
      content: data.content || "",
      model: data.model || model,
      provider: data.provider || "mascarade",
      usage: data.tokens_used ? {
        promptTokens: 0,
        completionTokens: data.tokens_used,
        totalTokens: data.tokens_used,
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
