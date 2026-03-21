import http from "node:http";
import pLimit from "p-limit";
import { generateImage } from "./comfyui.js";
import { searchWeb } from "./web-search.js";
import { trackError } from "./error-tracker.js";
import logger from "./logger.js";
import type { ToolDefinition } from "./mcp-tools.js";
import type { ChatPersona } from "./chat-types.js";

const FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL || "qwen3:4b";

// HTTP keep-alive agent: reuses TCP connections to Ollama (saves ~5-20ms per request)
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

/** Fetch with keep-alive connection pooling to Ollama */
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

/** Adaptive num_predict: short for trivial, full for complex */
function estimateMaxTokens(userMessage: string, personaMax: number | undefined): number {
  const base = personaMax || 800;
  const len = userMessage.length;
  if (len < 20) return Math.min(base, 200);   // "oui", "salut" → 200 max
  if (len < 60) return Math.min(base, 400);   // Short question → 400 max
  return base;
}

// Adaptive thinking: enable for complex prompts, disable for simple ones
function shouldThink(userMessage: string, model: string): boolean {
  // Only qwen3.5 supports thinking mode
  if (!model.startsWith("qwen3.5")) return false;

  const lower = userMessage.toLowerCase();
  const len = userMessage.length;

  // Always think for deep/complex requests
  const deepKeywords = [
    "explique", "explain", "analyse", "analyze", "compare", "pourquoi",
    "comment fonctionne", "how does", "philosophie", "theorie", "theory",
    "architecture", "conception", "design", "strategie", "strategy",
    "avantages et inconvenients", "pros and cons", "difference entre",
    "en detail", "in detail", "approfondi", "comprehensive",
    "reflexion", "pense a", "think about", "raisonne", "reason",
  ];
  if (deepKeywords.some(kw => lower.includes(kw))) return true;

  // Think for long messages (likely complex questions)
  if (len > 200) return true;

  // Don't think for short/simple messages
  if (len < 50) return false;

  // Don't think for greetings, commands, simple questions
  const simplePatterns = [
    /^(salut|bonjour|hello|hey|hi|coucou)/i,
    /^(merci|thanks|ok|oui|non|yes|no)/i,
    /^(quoi de neuf|ca va)/i,
    /^@\w+/,  // direct mentions
  ];
  if (simplePatterns.some(p => p.test(lower))) return false;

  // Default: don't think (faster responses)
  return false;
}

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

// ---------------------------------------------------------------------------
// Ollama concurrency limiter (replaces manual semaphore)
// ---------------------------------------------------------------------------

const ollamaLimit = pLimit(Number(process.env.MAX_OLLAMA_CONCURRENT) || 5);

// ---------------------------------------------------------------------------
// Ollama streaming chat
// ---------------------------------------------------------------------------

export async function streamOllamaChat(
  ollamaUrl: string,
  persona: ChatPersona,
  userMessage: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  // Always disable thinking for streaming — thinking output goes to separate field, not content stream
  const useThinking = false;
  await ollamaLimit(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
      const response = await ollamaFetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: persona.model,
          messages: [
            { role: "system", content: persona.systemPrompt },
            { role: "user", content: userMessage },
          ],
          stream: true,
          options: { num_predict: estimateMaxTokens(userMessage, persona.maxTokens), num_ctx: estimateNumCtx(persona.systemPrompt, userMessage), num_batch: 512 }, keep_alive: "30m", think: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body from Ollama");
      }

      const decoder = new TextDecoder();
      let fullText = "";
      let inThinking = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            if (parsed.message?.content) {
              const c = parsed.message.content;
              fullText += c;
              // Suppress <think>...</think> from streaming to client
              if (c.includes("<think>")) inThinking = true;
              if (!inThinking) onChunk(c);
              if (c.includes("</think>")) inThinking = false;
            }
          } catch {
            // Partial JSON -- skip
          }
        }
      }

      // Strip <think>...</think> blocks (qwen3 reasoning tokens)
      const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
      onDone(cleaned);
    } catch (err) {
      // Try fallback model if primary fails
      if (persona.model !== FALLBACK_MODEL) {
        logger.warn({ nick: persona.nick, primaryModel: persona.model, fallback: FALLBACK_MODEL }, "Trying fallback model");
        const fallbackPersona = { ...persona, model: FALLBACK_MODEL };
        try {
          const fallbackController = new AbortController();
          const fallbackTimeout = setTimeout(() => fallbackController.abort(), 45_000);
          try {
            const fallbackResp = await ollamaFetch(`${ollamaUrl}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: FALLBACK_MODEL,
                messages: [
                  { role: "system", content: persona.systemPrompt },
                  { role: "user", content: userMessage },
                ],
                stream: true,
                options: { num_predict: estimateMaxTokens(userMessage, persona.maxTokens), num_ctx: estimateNumCtx(persona.systemPrompt, userMessage), num_batch: 512 },
                keep_alive: "30m",
              }),
              signal: fallbackController.signal,
            });
            if (!fallbackResp.ok) throw new Error(`Fallback returned ${fallbackResp.status}`);
            const reader = fallbackResp.body?.getReader();
            if (!reader) throw new Error("No fallback response body");
            const decoder = new TextDecoder();
            let fullText = "";
            let inThinking = false;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              for (const line of chunk.split("\n").filter(Boolean)) {
                try {
                  const parsed = JSON.parse(line) as { message?: { content?: string } };
                  if (parsed.message?.content) {
                    const c = parsed.message.content;
                    fullText += c;
                    if (c.includes("<think>")) inThinking = true;
                    if (!inThinking) onChunk(c);
                    if (c.includes("</think>")) inThinking = false;
                  }
                } catch { /* partial JSON */ }
              }
            }
            const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
            onDone(cleaned);
            return;
          } finally {
            clearTimeout(fallbackTimeout);
          }
        } catch { /* fallback also failed */ }
      }
      trackError("ollama", err, { persona: persona.nick, model: persona.model });
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timeout);
    }
  });
}

/** Strip qwen3 thinking blocks from text */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

/** Clean persona response: strip thinking tokens, self-reference prefix, whitespace */
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
  function: { name: string; arguments: Record<string, unknown> };
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
    default:
      return `(Outil inconnu: ${toolName})`;
  }
}

/**
 * Stream Ollama chat with optional tool-calling support.
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
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
      const messages: Array<{ role: string; content: string; tool_calls?: OllamaToolCall[] }> = [
        { role: "system", content: persona.systemPrompt },
        { role: "user", content: userMessage },
      ];

      // Step 1: Non-streaming probe with tools (only for tool-like messages)
      const probeResp = await ollamaFetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: persona.model,
          messages,
          tools: tools.map(t => t),
          stream: false,
          options: { num_predict: estimateMaxTokens(userMessage, persona.maxTokens), num_ctx: estimateNumCtx(persona.systemPrompt, userMessage), num_batch: 512 }, keep_alive: "30m", think: shouldThink(userMessage, persona.model) ? undefined : false,
        }),
        signal: controller.signal,
      });

      if (!probeResp.ok) {
        throw new Error(`Ollama returned ${probeResp.status}: ${probeResp.statusText}`);
      }

      const probeData = await probeResp.json() as {
        message?: {
          role?: string;
          content?: string; thinking?: string;
          tool_calls?: OllamaToolCall[];
        };
      };

      const toolCalls = probeData.message?.tool_calls;

      // If no tool calls, use the response directly
      if (!toolCalls || toolCalls.length === 0) {
        let content = stripThinking(probeData.message?.content || "");
    // If thinking was enabled and content is empty, extract from thinking field
    if (!content && probeData.message?.thinking) {
      content = probeData.message.thinking.replace(/^.*?(?:Answer|Response|Reponse|Output):\s*/si, "").trim();
      // If still looks like thinking (starts with reasoning markers), take the last paragraph
      if (content.startsWith("1.") || content.startsWith("*") || content.startsWith("Here")) {
        const paragraphs = content.split("\n\n").filter(p => p.trim().length > 20);
        content = paragraphs[paragraphs.length - 1] || content;
      }
    }
        if (content) {
          onChunk(content);
        }
        onDone(content);
        return;
      }

      // Step 2: Execute tool calls (max 1 round)
      messages.push({
        role: "assistant",
        content: probeData.message?.content || "",
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const name = tc.function.name;
        const args = tc.function.arguments;
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
        });
      }

      // Step 3: Stream the final response with tool context
      const streamResp = await ollamaFetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: persona.model,
          messages,
          stream: true,
          options: { num_predict: estimateMaxTokens(userMessage, persona.maxTokens), num_ctx: estimateNumCtx(persona.systemPrompt, userMessage), num_batch: 512 }, keep_alive: "30m", think: false,
        }),
        signal: controller.signal,
      });

      if (!streamResp.ok) {
        throw new Error(`Ollama returned ${streamResp.status}: ${streamResp.statusText}`);
      }

      const reader = streamResp.body?.getReader();
      if (!reader) {
        throw new Error("No response body from Ollama");
      }

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            if (parsed.message?.content) {
              fullText += parsed.message.content;
              onChunk(parsed.message.content);
            }
          } catch {
            // Partial JSON -- skip
          }
        }
      }

      onDone(stripThinking(fullText));
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
// Falls back to direct Ollama if mascarade is unavailable.
// Drop-in replacement for streamOllamaChat with same signature.
// ---------------------------------------------------------------------------

import { streamChat as llmStreamChat, type ChatMessage } from "./llm-client.js";

const USE_MASCARADE = process.env.USE_MASCARADE !== "0"; // enabled by default

export async function streamLLMChat(
  _ollamaUrl: string,
  persona: ChatPersona,
  userMessage: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  if (!USE_MASCARADE) {
    return streamOllamaChat(_ollamaUrl, persona, userMessage, onChunk, onDone, onError);
  }

  await ollamaLimit(async () => {
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: persona.systemPrompt },
        { role: "user", content: userMessage },
      ];

      const gen = llmStreamChat(messages, {
        model: persona.model,
        maxTokens: estimateMaxTokens(userMessage, persona.maxTokens),
        numCtx: estimateNumCtx(persona.systemPrompt, userMessage),
        numBatch: 512,
        keepAlive: "30m",
        think: false,
      });

      let result: { content: string } | undefined;
      while (true) {
        const { done, value } = await gen.next();
        if (done) {
          result = value as { content: string };
          break;
        }
        onChunk(value);
      }

      const cleaned = stripThinking(result?.content || "");
      onDone(cleaned);
    } catch (err) {
      trackError("llm_stream", err, { persona: persona.nick, model: persona.model });
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
