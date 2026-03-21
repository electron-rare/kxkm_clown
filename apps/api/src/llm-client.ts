/**
 * OpenAI-compatible LLM client
 *
 * Routes chat requests through mascarade (multi-provider orchestrator)
 * or falls back to direct Ollama if mascarade is unavailable.
 *
 * Supports:
 *   - Streaming (SSE) and non-streaming
 *   - Model routing via "provider:model" syntax (e.g. "claude:claude-sonnet-4-6")
 *   - Fallback chain: mascarade → direct Ollama
 *   - Connection pooling (keep-alive)
 */

import logger from "./logger.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MASCARADE_URL = process.env.MASCARADE_URL || "http://127.0.0.1:8100";
const MASCARADE_API_KEY = process.env.MASCARADE_API_KEY || "";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "45000", 10);

// Default model when persona doesn't specify one
const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || "ollama:qwen3.5:9b";

// Track mascarade availability to avoid repeated timeouts
let mascaradeAvailable = true;
let mascaradeLastCheck = 0;
const MASCARADE_CHECK_INTERVAL_MS = 30_000; // re-check every 30s after failure

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

export interface ChatOptions {
  model?: string;        // "provider:model" or just "model" (uses Ollama)
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
// Health check
// ---------------------------------------------------------------------------

export async function checkMascaradeHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${MASCARADE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const ok = resp.ok;
    mascaradeAvailable = ok;
    mascaradeLastCheck = Date.now();
    return ok;
  } catch {
    mascaradeAvailable = false;
    mascaradeLastCheck = Date.now();
    return false;
  }
}

function shouldTryMascarade(): boolean {
  if (mascaradeAvailable) return true;
  // Re-check periodically
  if (Date.now() - mascaradeLastCheck > MASCARADE_CHECK_INTERVAL_MS) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Parse model string: "provider:model" or just "model" (defaults to ollama)
// ---------------------------------------------------------------------------

function parseModel(model: string | undefined): { provider: string; model: string; isOllamaOnly: boolean } {
  const m = model || DEFAULT_MODEL;
  if (m.includes(":") && !m.startsWith("qwen") && !m.startsWith("mistral:") && !m.startsWith("llama")) {
    // Looks like "provider:model" (e.g. "claude:claude-sonnet-4-6")
    // But Ollama models also use ":" (e.g. "qwen3.5:9b") — detect by known providers
    const knownProviders = ["claude", "openai", "mistral-api", "google", "bedrock", "huggingface", "ollama", "llama_cpp"];
    const prefix = m.split(":")[0];
    if (knownProviders.includes(prefix)) {
      return { provider: prefix, model: m.slice(prefix.length + 1), isOllamaOnly: prefix === "ollama" };
    }
  }
  // Default: treat as Ollama model name
  return { provider: "ollama", model: m, isOllamaOnly: true };
}

// ---------------------------------------------------------------------------
// Non-streaming chat (returns complete response)
// ---------------------------------------------------------------------------

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResponse> {
  const { provider, model, isOllamaOnly } = parseModel(opts.model);

  // Try mascarade first (unless Ollama-only and mascarade is down)
  if (shouldTryMascarade()) {
    try {
      return await chatViaMascarade(messages, { ...opts, model: `${provider}:${model}` });
    } catch (err) {
      logger.warn({ err: (err as Error).message, provider, model }, "[llm] mascarade failed, falling back to Ollama");
      mascaradeAvailable = false;
      mascaradeLastCheck = Date.now();
    }
  }

  // Fallback: direct Ollama
  return chatViaOllama(messages, { ...opts, model });
}

// ---------------------------------------------------------------------------
// Streaming chat (yields tokens)
// ---------------------------------------------------------------------------

export async function* streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, ChatResponse> {
  const { provider, model, isOllamaOnly } = parseModel(opts.model);

  // Try mascarade first
  if (shouldTryMascarade() && !isOllamaOnly) {
    try {
      return yield* streamViaMascarade(messages, { ...opts, model: `${provider}:${model}` });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[llm] mascarade stream failed, falling back to Ollama");
      mascaradeAvailable = false;
      mascaradeLastCheck = Date.now();
    }
  }

  // Fallback (or Ollama-only): direct Ollama streaming
  return yield* streamViaOllama(messages, { ...opts, model });
}

// ---------------------------------------------------------------------------
// Mascarade (OpenAI-compatible)
// ---------------------------------------------------------------------------

async function chatViaMascarade(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MASCARADE_API_KEY) headers["Authorization"] = `Bearer ${MASCARADE_API_KEY}`;

  try {
    const resp = await fetch(`${MASCARADE_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens || 800,
        stream: false,
        ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`mascarade ${resp.status}: ${resp.statusText}`);

    const data = await resp.json() as {
      model?: string;
      choices?: Array<{
        message?: { content?: string; tool_calls?: ChatResponse["toolCalls"] };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || "",
      model: data.model || opts.model || "unknown",
      provider: "mascarade",
      toolCalls: choice?.message?.tool_calls,
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

async function* streamViaMascarade(
  messages: ChatMessage[],
  opts: ChatOptions,
): AsyncGenerator<string, ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MASCARADE_API_KEY) headers["Authorization"] = `Bearer ${MASCARADE_API_KEY}`;

  try {
    const resp = await fetch(`${MASCARADE_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens || 800,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`mascarade ${resp.status}: ${resp.statusText}`);

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";
    let model = opts.model || "unknown";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Parse SSE: "data: {...}\n\n"
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload) as {
            model?: string;
            choices?: Array<{ delta?: { content?: string } }>;
          };
          if (parsed.model) model = parsed.model;
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullText += token;
            yield token;
          }
        } catch { /* partial JSON — skip */ }
      }
    }

    return {
      content: fullText,
      model,
      provider: "mascarade",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Direct Ollama (fallback)
// ---------------------------------------------------------------------------

async function chatViaOllama(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
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
      model: opts.model || "unknown",
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

  try {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
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
    return {
      content: cleaned,
      model: opts.model || "unknown",
      provider: "ollama",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Convenience: get available providers from mascarade
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
