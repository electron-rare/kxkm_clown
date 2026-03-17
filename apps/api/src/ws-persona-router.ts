import fs from "node:fs";
import path from "node:path";
import type { ChatPersona, PersonaMemory } from "./chat-types.js";

// ---------------------------------------------------------------------------
// Persona memory (persistent, file-based)
// ---------------------------------------------------------------------------

const PERSONA_MEMORY_DIR = path.resolve(process.cwd(), "data/persona-memory");

export async function loadPersonaMemory(nick: string): Promise<PersonaMemory> {
  const memPath = path.join(PERSONA_MEMORY_DIR, `${nick}.json`);
  try {
    const data = await fs.promises.readFile(memPath, "utf-8");
    return JSON.parse(data) as PersonaMemory;
  } catch { /* missing or corrupted file — start fresh */ }
  return { nick, facts: [], summary: "", lastUpdated: "" };
}

export async function savePersonaMemory(memory: PersonaMemory): Promise<void> {
  await fs.promises.mkdir(PERSONA_MEMORY_DIR, { recursive: true });
  memory.lastUpdated = new Date().toISOString();
  await fs.promises.writeFile(
    path.join(PERSONA_MEMORY_DIR, `${memory.nick}.json`),
    JSON.stringify(memory, null, 2),
  );
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
      console.error("[persona-router] Failed to parse LLM JSON:", parseErr);
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
    console.error(
      `[ws-chat] Memory update failed for ${persona.nick}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Persona selection (pickResponders)
// ---------------------------------------------------------------------------

export function pickResponders(text: string, pool: ChatPersona[]): ChatPersona[] {
  // Check for direct @mention — only mentioned personas respond
  const mentioned = pool.filter((p) =>
    text.toLowerCase().includes(`@${p.nick.toLowerCase()}`),
  );
  if (mentioned.length > 0) return mentioned;

  // Default: only Pharmacius responds (or first persona if Pharmacius not found)
  const defaultPersona = pool.find((p) => p.nick.toLowerCase() === "pharmacius");
  if (defaultPersona) return [defaultPersona];

  // Fallback: first persona in pool
  return pool.length > 0 ? [pool[0]] : [];
}
