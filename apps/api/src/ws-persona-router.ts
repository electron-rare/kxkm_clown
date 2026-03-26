import logger from "./logger.js";
import type { ChatPersona } from "./chat-types.js";
import {
  applyPersonaMemoryExtraction,
  buildPersonaMemoryExtractionPrompt,
  resolvePersonaMemoryPolicy,
} from "./persona-memory-policy.js";
import {
  loadPersonaMemory,
  resetPersonaMemory,
  savePersonaMemory,
} from "./persona-memory-store.js";

// ---------------------------------------------------------------------------
// Persona memory (persistent, file-based)
// ---------------------------------------------------------------------------
export { loadPersonaMemory, resetPersonaMemory, savePersonaMemory };

export async function updatePersonaMemory(
  persona: ChatPersona,
  recentMessages: string[],
  ollamaUrl: string,
): Promise<void> {
  const memory = await loadPersonaMemory(persona);
  const policy = resolvePersonaMemoryPolicy();
  const prompt = buildPersonaMemoryExtractionPrompt(persona, recentMessages, policy);

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: persona.model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Memory update HTTP ${response.status}`);
    }

    const data = (await response.json()) as { message?: { content?: string } };
    const rawContent = String(data.message?.content || "").trim();
    if (!rawContent) {
      logger.error({ nick: persona.nick }, "[persona-router] Empty LLM JSON");
      return;
    }

    let extracted: { facts?: string[]; summary?: string };
    try {
      extracted = JSON.parse(rawContent) as { facts?: string[]; summary?: string };
    } catch (parseErr) {
      logger.error({ err: parseErr }, "[persona-router] Failed to parse LLM JSON");
      return;
    }

    const updated = applyPersonaMemoryExtraction(memory, extracted, {
      policy,
      personaId: persona.id,
      recentMessages,
    });

    await savePersonaMemory(updated, policy);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), nick: persona.nick }, "[ws-chat] Memory update failed");
  }
}

// ---------------------------------------------------------------------------
// Persona selection (pickResponders)
// ---------------------------------------------------------------------------

export function pickResponders(text: string, pool: ChatPersona[]): ChatPersona[] {
  // 1. Direct @mentions — highest priority
  const mentioned = pool.filter((p) =>
    text.toLowerCase().includes(`@${p.nick.toLowerCase()}`),
  );
  if (mentioned.length > 0) return mentioned;

  // 2. Topic detection — route to specialists directly
  const lower = text.toLowerCase();

  const topicRoutes: Array<{ keywords: string[]; nicks: string[] }> = [
    { keywords: ["cherche", "search", "recherche", "google", "web", "trouve", "find"], nicks: ["Sherlock", "Pharmacius"] },
    { keywords: ["image", "dessine", "draw", "imagine", "génère une image", "picture"], nicks: ["Picasso"] },
    { keywords: ["musique", "compose", "music", "son", "sound", "audio", "noise"], nicks: ["Schaeffer", "Pharmacius"] },
    { keywords: ["code", "programme", "bug", "api", "hack", "script"], nicks: ["Turing"] },
    { keywords: ["philosophie", "penser", "sens", "existence", "conscience"], nicks: ["Deleuze", "Pharmacius"] },
  ];

  for (const route of topicRoutes) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      const responders = route.nicks
        .map(nick => pool.find(p => p.nick === nick))
        .filter(Boolean) as ChatPersona[];
      if (responders.length > 0) return responders;
    }
  }

  // 3. Default: Pharmacius only
  const pharmacius = pool.find((p) => p.nick.toLowerCase() === "pharmacius");
  return pharmacius ? [pharmacius] : pool.slice(0, 1);
}
