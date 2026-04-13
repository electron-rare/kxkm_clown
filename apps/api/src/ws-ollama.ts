import http from "node:http";
import pLimit from "p-limit";
import { generateImage } from "./comfyui.js";
import { searchWeb } from "./web-search.js";
import { trackError } from "./error-tracker.js";
import logger from "./logger.js";
import type { ToolDefinition } from "./mcp-tools.js";
import type { ChatPersona } from "./chat-types.js";
import type { ChatMessage } from "./llm-client.js";

const LLM_URL = process.env.LLM_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen-14b-awq";
const LLM_API_KEY = process.env.LLM_API_KEY || "";

function resolveRuntimeModel(model: string | undefined): string {
  if (!model) return LLM_MODEL;
  const cloudPrefixed = /^(claude|openai|mistral-api|google|bedrock|huggingface):/i.test(model);
  if (cloudPrefixed) return LLM_MODEL;
  const compatPrefixed = /^(ollama|vllm|runtime):/i.test(model);
  if (compatPrefixed) return model.slice(model.indexOf(":") + 1);
  // Persona specifies a local model name — use it if it matches the loaded runtime,
  // otherwise fall back to LLM_MODEL (the actually-loaded model)
  return model === LLM_MODEL ? model : LLM_MODEL;
}

/** Complete a chat via vLLM OpenAI-compatible API (non-streaming). Strips <think> blocks. */
export async function vllmComplete(
  messages: Array<{ role: string; content: string }>,
  opts?: { maxTokens?: number; model?: string },
): Promise<string> {
  const resp = await fetch(`${LLM_URL}/v1/chat/completions`, {
    method: "POST",
    headers: llmHeaders(),
    body: JSON.stringify({
      model: resolveRuntimeModel(opts?.model),
      messages,
      max_tokens: opts?.maxTokens ?? 800,
      stream: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!resp.ok) throw new Error(`vLLM ${resp.status}: ${resp.statusText}`);
  const data = await resp.json() as { choices?: [{ message?: { content?: string } }] };
  return (data.choices?.[0]?.message?.content || "")
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

// HTTP keep-alive agent: reuses TCP connections to the local runtime
const ollamaAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
  keepAliveMsecs: 30_000,
});

// Dispatcher helper for Node fetch with keep-alive
const ollamaFetchOpts = { dispatcher: undefined as unknown } as Record<string, unknown>;
try {
  // Node 18+ supports { dispatcher } for undici-based fetch
  const { Agent: UndiciAgent } = await import("undici");
  ollamaFetchOpts.dispatcher = new UndiciAgent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 10,
  });
} catch {
  // undici not available — fall back to default fetch (still OK, just no keep-alive)
}

/** Common headers for LLM runtime requests.
 *  Reads API key from env at call time (not module load) to handle
 *  ESM import ordering where module code runs before dotenv/env injection. */
function llmHeaders(): Record<string, string> {
  const key = process.env.LLM_API_KEY || LLM_API_KEY;
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (key) h["Authorization"] = `Bearer ${key}`;
  return h;
}

/** Fetch with keep-alive connection pooling to the local runtime */
function ollamaFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, ...ollamaFetchOpts } as RequestInit);
}

// Dynamic context sizing based on prompt length
// Rough estimate: 1 token ≈ 4 chars for French text
function estimateNumCtx(systemPrompt: string, userMessage: string, _baseCtx = 8192): number {
  const totalChars = systemPrompt.length + userMessage.length;
  const promptTokens = Math.ceil(totalChars / 4);
  // Short messages (< 200 chars user input) get minimal context for fastest TTFT
  const minResponse = userMessage.length < 200 ? 1024 : 2048;
  const needed = promptTokens + minResponse;
  // Round up to nearest 2048
  const ctx = Math.ceil(needed / 2048) * 2048;
  return Math.max(2048, Math.min(ctx, 32768)); // clamp 2k-32k
}

/** Adaptive num_predict: short for trivial, full for complex.
 *  Adds headroom for thinking tokens (reasoning budget consumed from max_tokens).
 *  qwen3-32b-awq routinely uses 1000-1500 thinking tokens even for simple messages,
 *  so headroom must be generous to leave room for the actual visible response. */
const THINKING_HEADROOM = 2048;
function estimateMaxTokens(userMessage: string, personaMax: number | undefined): number {
  const base = personaMax || 800;
  const len = userMessage.length;
  if (len < 20) return Math.min(base, 600) + THINKING_HEADROOM;
  if (len < 60) return Math.min(base, 800) + THINKING_HEADROOM;
  return base + THINKING_HEADROOM;
}


/** Decide whether to enable Qwen3 thinking mode based on message complexity.
 *  Short greetings and trivial messages don't need 1500 tokens of reasoning. */
function shouldThink(userMessage: string): boolean {
  const len = userMessage.length;
  if (len < 40) return false;
  // Questions, analysis requests, multi-sentence messages benefit from thinking
  if (/\?|expliqu|pourquoi|comment|analyse|compare|raconte|décri/i.test(userMessage)) return true;
  if (len > 120) return true;
  return false;
}

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

// ---------------------------------------------------------------------------
// Ollama concurrency limiter (replaces manual semaphore)
// ---------------------------------------------------------------------------

// Match local runtime concurrency limits
const ollamaLimit = pLimit(Number(process.env.MAX_OLLAMA_CONCURRENT) || 2);

// ---------------------------------------------------------------------------
// Local runtime streaming chat
// ---------------------------------------------------------------------------

export async function streamOllamaChat(
  ollamaUrl: string,
  persona: ChatPersona,
  userMessage: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
  onThinking?: (text: string) => void,
  opts?: { think?: boolean },
): Promise<void> {
  await ollamaLimit(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const runtimeModel = resolveRuntimeModel(persona.model);
    const runtimeUrl = ollamaUrl || LLM_URL;

    try {
      // Qwen3 thinking control via chat_template_kwargs.
      // Caller decides via opts.think (defaults to shouldThink heuristic on raw message).
      const think = opts?.think ?? shouldThink(userMessage);
      const response = await ollamaFetch(`${runtimeUrl}/v1/chat/completions`, {
        method: "POST",
        headers: llmHeaders(),
        body: JSON.stringify({
          model: runtimeModel,
          messages: [
            { role: "system", content: persona.systemPrompt },
            { role: "user", content: userMessage },
          ],
          stream: true,
          max_tokens: estimateMaxTokens(userMessage, persona.maxTokens),
          ...(think ? {} : { chat_template_kwargs: { enable_thinking: false } }),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`vLLM returned ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body from vLLM");
      }

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
          const raw = line.startsWith("data: ") ? line.slice(6).trim() : line.trim();
          if (!raw) continue;
          if (raw === "[DONE]") break;
          const { content: c, reasoning: r } = parseStreamingPayload(raw);
          // Stream reasoning tokens as thinking preview (deepseek format)
          if (r && onThinking) onThinking(r);
          if (c) {
            fullText += c;
            // Detect opening tags for both <think> and <reasoning>
            if (c.includes("<think>") || c.includes("<reasoning>")) inThinking = true;
            // Detect closing tags
            if (c.includes("</think>") || c.includes("</reasoning>")) {
              inThinking = false;
              const afterThink = c.split(/<\/(?:think|reasoning)>/).pop()?.trim();
              if (afterThink) onChunk(afterThink);
            } else if (inThinking) {
              // Forward inline thinking content to onThinking preview
              if (onThinking) {
                const clean = c.replace(/<\/?(?:think|reasoning)>/g, "");
                if (clean.trim()) onThinking(clean);
              }
            } else {
              const visible = stripThinkingFromChunk(c);
              if (visible) onChunk(visible);
            }
          }
        }
      }

      // Pass raw text to onDone — the caller (cleanPersonaResponse) handles
      // stripping + fallback extraction when thinking consumes the entire budget
      onDone(fullText);
    } catch (err) {
      trackError("ollama", err, { persona: persona.nick, model: persona.model });
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timeout);
    }
  });
}

/** Strip thinking blocks from text — supports <think> and <reasoning> tags.
 *  Also handles UNTERMINATED opening tags (when the model hits reasoning-budget
 *  and never emits </think>) by dropping everything from the opening tag to EOS. */
function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .replace(/<reasoning>[\s\S]*$/g, "")
    .trim();
}

function stripThinkingFromChunk(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\/?think>/g, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, "")
    .replace(/<\/?reasoning>/g, "");
}

/** Clean persona response: strip thinking tokens, self-reference prefix, whitespace. */
export function cleanPersonaResponse(text: string, personaNick: string): string {
  let cleaned = stripThinking(text);
  // Remove persona self-reference prefix like "**Pharmacius** :\n" or "Pharmacius : "
  const prefixPattern = new RegExp(`^\\*{0,2}${personaNick}\\*{0,2}\\s*[:：]?\\s*\\n?`, 'i');
  cleaned = cleaned.replace(prefixPattern, '');
  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// Tool-calling support for personas (MCP-style via Ollama tool_calls)
// ---------------------------------------------------------------------------

interface OllamaToolCall {
  id?: string;
  type?: "function";
  function: { name: string; arguments: Record<string, unknown> | string };
}

function toRuntimeMessage(message: ChatMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };
  if (message.tool_calls?.length) {
    payload.tool_calls = message.tool_calls.map((toolCall) => ({
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
    payload.tool_call_id = message.tool_call_id;
  }
  return payload;
}

function parseToolArguments(value: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseStreamingPayload(raw: string): { content: string | null; reasoning: string | null } {
  try {
    const parsed = JSON.parse(raw) as {
      choices?: [{ delta?: { content?: string; reasoning_content?: string } }];
      message?: { content?: string };
    };
    const delta = parsed.choices?.[0]?.delta;
    return {
      content: delta?.content ?? parsed.message?.content ?? null,
      reasoning: delta?.reasoning_content ?? null,
    };
  } catch {
    return { content: null, reasoning: null };
  }
}

function extractAssistantMessage(data: {
  choices?: [{
    message?: {
      role?: string;
      content?: string;
      tool_calls?: OllamaToolCall[];
    };
  }];
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
}): { role?: string; content?: string; tool_calls?: OllamaToolCall[] } | undefined {
  return data.choices?.[0]?.message || data.message;
}

/**
 * Execute a single tool call and return its textual result.
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  rag: { size: number; search(q: string, k?: number): Promise<{ text: string }[]> } | undefined,
): Promise<string> {
  switch (toolName) {
    case "web_search": {
      const query = String(args.query || "");
      return await searchWeb(query);
    }
    case "image_generate": {
      const prompt = String(args.prompt || "");
      const result = await generateImage(prompt);
      return result ? `[Image générée: seed ${result.seed}]` : "[Erreur génération image]";
    }
    case "rag_search": {
      const query = String(args.query || "");
      if (!rag || rag.size === 0) return "(Pas de documents indexés)";
      const results = await rag.search(query);
      return results.map(r => r.text).join("\n---\n") || "(Aucun résultat)";
    }
    case "music_generate": {
      const AI_BRIDGE = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
      const type = String(args.type || "noise");
      const duration = Math.min(60, Math.max(3, Number(args.duration) || 15));
      const prompt = String(args.prompt || "");
      const instruments = ["drone", "grain", "glitch", "circus", "honk"];
      const endpoint = instruments.includes(type)
        ? `/instrument/${type}`
        : type === "music" ? "/generate/music" : "/generate/noise";
      const body = instruments.includes(type)
        ? { duration }
        : type === "music" ? { prompt: prompt || "ambient", duration, style: "experimental" }
        : { type: prompt || "pink", duration };
      try {
        const resp = await fetch(`${AI_BRIDGE}${endpoint}`, {
          method: "POST", headers: llmHeaders(),
          body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
        });
        return resp.ok ? `[Audio généré: ${type} ${duration}s]` : `[Erreur génération: HTTP ${resp.status}]`;
      } catch { return "[AI Bridge indisponible]"; }
    }
    case "voice_synthesize": {
      const AI_BRIDGE = process.env.AI_BRIDGE_URL || "http://127.0.0.1:8301";
      const text = String(args.text || "Bonjour");
      const voice = String(args.voice || "af_heart");
      try {
        const resp = await fetch(`${AI_BRIDGE}/generate/voice-fast`, {
          method: "POST", headers: llmHeaders(),
          body: JSON.stringify({ text, voice, speed: 1.0 }), signal: AbortSignal.timeout(30_000),
        });
        return resp.ok ? `[Voix synthétisée: ${voice}, "${text.slice(0, 50)}"]` : `[Erreur TTS: HTTP ${resp.status}]`;
      } catch { return "[Kokoro TTS indisponible]"; }
    }
    case "audio_analyze": {
      const desc = String(args.description || "analyse générale");
      return `[Analyse audio: ${desc} — utilise /stem pour séparer les stems, /fx pour appliquer des effets]`;
    }
    default:
      return `(Outil inconnu: ${toolName})`;
  }
}

/**
 * Stream local runtime chat with optional tool-calling support.
 * When tools are provided:
 *   1. First do a non-streaming call to see if Ollama wants to use tools
 *   2. If tool_calls present, execute them and re-call with tool results
 *   3. Stream the final response normally
 * Max 1 round of tool calls to avoid infinite loops.
 */
// Quick check: does the message look like it might need tools?
function mightNeedTools(text: string): boolean {
  const lower = text.toLowerCase();
  const toolHints = [
    "cherche", "search", "trouve", "find", "web", "internet", "google",
    "image", "genere", "generate", "dessine", "draw", "imagine",
    "rag", "document", "contexte", "knowledge",
    "calcul", "compute", "execute", "run",
  ];
  return toolHints.some(h => lower.includes(h));
}

export async function streamOllamaChatWithTools(
  ollamaUrl: string,
  persona: ChatPersona,
  userMessage: string,
  tools: ToolDefinition[],
  rag: { size: number; search(q: string, k?: number): Promise<{ text: string }[]> } | undefined,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  // Fast path: if message doesn't look like it needs tools, skip probe and stream directly
  // This saves 200-2000ms on simple messages
  if (!mightNeedTools(userMessage)) {
    return streamOllamaChat(ollamaUrl, persona, userMessage, onChunk, onDone, onError);
  }

  await ollamaLimit(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const runtimeUrl = ollamaUrl || LLM_URL;

    try {
      const runtimeModel = resolveRuntimeModel(persona.model);
      const messages: ChatMessage[] = [
        { role: "system", content: persona.systemPrompt },
        { role: "user", content: userMessage },
      ];

      // Step 1: Non-streaming probe with tools
      const probeResp = await ollamaFetch(`${runtimeUrl}/v1/chat/completions`, {
        method: "POST",
        headers: llmHeaders(),
        body: JSON.stringify({
          model: runtimeModel,
          messages: messages.map(toRuntimeMessage),
          tools: tools.map(t => t),
          stream: false,
          max_tokens: estimateMaxTokens(userMessage, persona.maxTokens),
        }),
        signal: controller.signal,
      });

      if (!probeResp.ok) {
        throw new Error(`vLLM returned ${probeResp.status}: ${probeResp.statusText}`);
      }

      const probeData = await probeResp.json() as {
        choices?: [{
          message?: {
            role?: string;
            content?: string;
            tool_calls?: OllamaToolCall[];
          };
        }];
        message?: {
          role?: string;
          content?: string;
          tool_calls?: OllamaToolCall[];
        };
      };

      const probeMsg = extractAssistantMessage(probeData);
      const toolCalls = probeMsg?.tool_calls;

      // If no tool calls, use the response directly (caller handles strip)
      if (!toolCalls || toolCalls.length === 0) {
        const content = probeMsg?.content || "";
        const visible = stripThinking(content);
        if (visible) {
          onChunk(visible);
        }
        onDone(content);
        return;
      }

      // Step 2: Execute tool calls (max 1 round)
      messages.push({
        role: "assistant",
        content: probeMsg?.content || "",
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const name = tc.function.name;
        const args = parseToolArguments(tc.function.arguments);
        if (DEBUG) console.log(`[mcp-tools] ${persona.nick} calling ${name}(${JSON.stringify(args)})`);

        let result: string;
        try {
          result = await executeToolCall(name, args, rag);
        } catch (err) {
          result = `(Erreur outil ${name}: ${err instanceof Error ? err.message : String(err)})`;
        }

        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }

      // Step 3: Stream the final response with tool context
      const streamResp = await ollamaFetch(`${runtimeUrl}/v1/chat/completions`, {
        method: "POST",
        headers: llmHeaders(),
        body: JSON.stringify({
          model: runtimeModel,
          messages: messages.map(toRuntimeMessage),
          stream: true,
          max_tokens: estimateMaxTokens(userMessage, persona.maxTokens),
        }),
        signal: controller.signal,
      });

      if (!streamResp.ok) {
        throw new Error(`vLLM returned ${streamResp.status}: ${streamResp.statusText}`);
      }

      const reader = streamResp.body?.getReader();
      if (!reader) {
        throw new Error("No response body from vLLM");
      }

      const decoder = new TextDecoder();
      let fullText = "";
      let toolStreamBuf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        toolStreamBuf += decoder.decode(value, { stream: true });
        const tsLines = toolStreamBuf.split("\n");
        toolStreamBuf = tsLines.pop() || "";

        for (const line of tsLines) {
          const raw = line.startsWith("data: ") ? line.slice(6).trim() : line.trim();
          if (!raw) continue;
          if (raw === "[DONE]") break;
          const { content: c } = parseStreamingPayload(raw);
          if (c) {
            fullText += c;
            const visible = stripThinkingFromChunk(c);
            if (visible) onChunk(visible);
          }
        }
      }

      onDone(fullText);
    } catch (err) {
      trackError("ollama", err, { persona: persona.nick, model: persona.model, withTools: true });
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timeout);
    }
  });
}

// ---------------------------------------------------------------------------
// LLM Client — mascarade-backed streaming (OpenAI-compatible)
// Uses mascarade only for explicit cloud-provider streaming.
// Drop-in replacement for streamOllamaChat with same signature.
// ---------------------------------------------------------------------------

import { streamChat as llmStreamChat } from "./llm-client.js";

const USE_MASCARADE = process.env.USE_MASCARADE !== "0"; // enabled by default

/**
 * Parse enrichedText to extract RAG/context sections for better system prompt structuring.
 * enrichedText format:
 *   <user message>
 *
 *   [Contexte conversationnel]
 *   ...
 *
 *   [Contexte pertinent]
 *   ...
 */
function splitEnrichedText(enrichedText: string): { userMsg: string; context: string } {
  const contextMarker = /\n\n\[Contexte (?:conversationnel|pertinent)\]\n/;
  const match = enrichedText.match(contextMarker);
  if (!match || match.index === undefined) {
    return { userMsg: enrichedText, context: "" };
  }
  return {
    userMsg: enrichedText.slice(0, match.index).trim(),
    context: enrichedText.slice(match.index).trim(),
  };
}

export async function streamLLMChat(
  _ollamaUrl: string,
  persona: ChatPersona,
  userMessage: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
  onThinking?: (text: string) => void,
): Promise<void> {
  if (!USE_MASCARADE) {
    return streamOllamaChat(_ollamaUrl, persona, userMessage, onChunk, onDone, onError, onThinking);
  }

  await ollamaLimit(async () => {
    try {
      // Split enriched text: user message vs RAG/context (inject context into system prompt)
      const { userMsg, context } = splitEnrichedText(userMessage);
      const systemPrompt = context
        ? `${persona.systemPrompt}\n\n${context}`
        : persona.systemPrompt;

      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ];

      const gen = llmStreamChat(messages, {
        model: persona.model,
        maxTokens: estimateMaxTokens(userMsg, persona.maxTokens),
        numCtx: estimateNumCtx(systemPrompt, userMsg),
        numBatch: 512,
        keepAlive: "30m",
        think: false,
      });

      let result: { content: string } | undefined;
      let masqInThinking = false;
      while (true) {
        const { done, value } = await gen.next();
        if (done) {
          result = value as { content: string };
          break;
        }
        // State machine for <think>/<reasoning> tags in mascarade stream
        if (value.includes("<think>") || value.includes("<reasoning>")) masqInThinking = true;
        if (value.includes("</think>") || value.includes("</reasoning>")) {
          masqInThinking = false;
          const afterTag = value.split(/<\/(?:think|reasoning)>/).pop()?.trim();
          if (afterTag) onChunk(afterTag);
        } else if (masqInThinking) {
          if (onThinking) {
            const clean = value.replace(/<\/?(?:think|reasoning)>/g, "");
            if (clean.trim()) onThinking(clean);
          }
        } else {
          const visible = stripThinkingFromChunk(value);
          if (visible) onChunk(visible);
        }
      }

      onDone(result?.content || "");
    } catch (err) {
      trackError("llm_stream", err, { persona: persona.nick, model: persona.model });
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
