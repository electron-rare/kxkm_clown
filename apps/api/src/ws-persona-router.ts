import fs from "node:fs";
import path from "node:path";
import logger from "./logger.js";
import type { ChatPersona, PersonaMemory } from "./chat-types.js";

// ---------------------------------------------------------------------------
// Persona memory (persistent, file-based)
// ---------------------------------------------------------------------------

const PERSONA_MEMORY_DIR = path.resolve(process.cwd(), "data/persona-memory");

// RAM cache for persona memory (avoids disk I/O on every message)
const memoryCache = new Map<string, { data: PersonaMemory; loadedAt: number }>();
const MEMORY_CACHE_TTL = 30_000; // 30s TTL

export async function loadPersonaMemory(nick: string): Promise<PersonaMemory> {
  const cached = memoryCache.get(nick);
  if (cached && Date.now() - cached.loadedAt < MEMORY_CACHE_TTL) {
    return cached.data;
  }
  const memPath = path.join(PERSONA_MEMORY_DIR, `${nick}.json`);
  try {
    const data = await fs.promises.readFile(memPath, "utf-8");
    const memory = JSON.parse(data) as PersonaMemory;
    memoryCache.set(nick, { data: memory, loadedAt: Date.now() });
    return memory;
  } catch { /* missing or corrupted file — start fresh */ }
  const fresh: PersonaMemory = { nick, facts: [], summary: "", lastUpdated: "" };
  memoryCache.set(nick, { data: fresh, loadedAt: Date.now() });
  return fresh;
}

export async function savePersonaMemory(memory: PersonaMemory): Promise<void> {
  await fs.promises.mkdir(PERSONA_MEMORY_DIR, { recursive: true });
  memory.lastUpdated = new Date().toISOString();
  await fs.promises.writeFile(
    path.join(PERSONA_MEMORY_DIR, `${memory.nick}.json`),
    JSON.stringify(memory, null, 2),
  );
  // Invalidate cache so next load picks up the new data
  memoryCache.set(memory.nick, { data: memory, loadedAt: Date.now() });
}

export async function updatePersonaMemory(
  persona: ChatPersona,
  recentMessages: string[],
  ollamaUrl: string,
): Promise<void> {
  const memory = await loadPersonaMemory(persona.nick);

  const prompt =
    `Tu es ${persona.nick}. Voici les derniers échanges:\n${recentMessages.join("\n")}\n\n` +
    `Extrais 2-3 faits importants à retenir sur l'utilisateur ou le sujet. ` +
    `Réponds en JSON: {"facts": ["fait1", "fait2"], "summary": "résumé en une phrase"}`;

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

    const data = (await response.json()) as { message?: { content?: string } };
    let extracted: { facts?: string[]; summary?: string } = {};
    try {
      extracted = JSON.parse(data.message?.content || "{}");
    } catch (parseErr) {
      logger.error({ err: parseErr }, "[persona-router] Failed to parse LLM JSON");
    }

    if (extracted.facts && Array.isArray(extracted.facts)) {
      const allFacts = [...new Set([...memory.facts, ...extracted.facts])].slice(-20);
      memory.facts = allFacts;
    }
    if (extracted.summary) {
      memory.summary = extracted.summary;
    }

    await savePersonaMemory(memory);
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
