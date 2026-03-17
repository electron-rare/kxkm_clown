import { generateImage } from "./comfyui.js";
import { searchWeb } from "./web-search.js";
import type { ToolDefinition } from "./mcp-tools.js";
import type { ChatPersona } from "./chat-types.js";

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

// ---------------------------------------------------------------------------
// Simple semaphore for Ollama concurrency
// ---------------------------------------------------------------------------

const MAX_OLLAMA_CONCURRENT = Number(process.env.MAX_OLLAMA_CONCURRENT) || 3;
let ollamaActive = 0;
const ollamaQueue: Array<() => void> = [];

export async function acquireOllama(): Promise<void> {
  if (ollamaActive < MAX_OLLAMA_CONCURRENT) {
    ollamaActive++;
    return;
  }
  return new Promise<void>(resolve => {
    ollamaQueue.push(() => { ollamaActive++; resolve(); });
  });
}

export function releaseOllama(): void {
  ollamaActive--;
  const next = ollamaQueue.shift();
  if (next) next();
}

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
  await acquireOllama();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: persona.model,
        messages: [
          { role: "system", content: persona.systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: true,
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Ollama streams newline-delimited JSON
      const lines = chunk.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          if (parsed.message?.content) {
            fullText += parsed.message.content;
            onChunk(parsed.message.content);
          }
        } catch {
          // Partial JSON — skip
        }
      }
    }

    onDone(fullText);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    clearTimeout(timeout);
    releaseOllama();
  }
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
  rag: { size: number; search(q: string, k: number): Promise<{ text: string }[]> } | undefined,
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
      const results = await rag.search(query, 3);
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
export async function streamOllamaChatWithTools(
  ollamaUrl: string,
  persona: ChatPersona,
  userMessage: string,
  tools: ToolDefinition[],
  rag: { size: number; search(q: string, k: number): Promise<{ text: string }[]> } | undefined,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  await acquireOllama();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);

  try {
    const messages: Array<{ role: string; content: string; tool_calls?: OllamaToolCall[] }> = [
      { role: "system", content: persona.systemPrompt },
      { role: "user", content: userMessage },
    ];

    // Step 1: Non-streaming call with tools to check for tool_calls
    const probeResp = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: persona.model,
        messages,
        tools: tools.map(t => t),
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!probeResp.ok) {
      throw new Error(`Ollama returned ${probeResp.status}: ${probeResp.statusText}`);
    }

    const probeData = await probeResp.json() as {
      message?: {
        role?: string;
        content?: string;
        tool_calls?: OllamaToolCall[];
      };
    };

    const toolCalls = probeData.message?.tool_calls;

    // If no tool calls, use the response directly
    if (!toolCalls || toolCalls.length === 0) {
      const content = probeData.message?.content || "";
      if (content) {
        onChunk(content);
      }
      onDone(content);
      return;
    }

    // Step 2: Execute tool calls (max 1 round)
    // Add assistant message with tool_calls to conversation
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

      // Add tool result to conversation
      messages.push({
        role: "tool",
        content: result,
      });
    }

    // Step 3: Stream the final response with tool context
    releaseOllama();
    // Re-acquire for the streaming call
    await acquireOllama();

    const streamResp = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: persona.model,
        messages,
        stream: true,
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
          // Partial JSON — skip
        }
      }
    }

    onDone(fullText);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    clearTimeout(timeout);
    releaseOllama();
  }
}
