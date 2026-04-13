import { trackError } from "./error-tracker.js";
import { recordLatency } from "./perf.js";
import { getToolsForPersona as defaultGetToolsForPersona, type ToolDefinition } from "./mcp-tools.js";
import {
  streamOllamaChat,
  streamLLMChat,
  streamOllamaChatWithTools as defaultStreamOllamaChatWithTools,
  cleanPersonaResponse,
} from "./ws-ollama.js";

// Use direct local runtime by default — mascarade routes through Tower/Photon
// which doesn't stream thinking tokens needed for the ThinkingPanel
const defaultStreamOllamaChat = streamOllamaChat;
import {
  synthesizeTTS as defaultSynthesizeTTS,
  isTTSAvailable as defaultIsTTSAvailable,
  acquireTTS as defaultAcquireTTS,
  releaseTTS as defaultReleaseTTS,
} from "./ws-multimodal.js";
import {
  loadPersonaMemory as defaultLoadPersonaMemory,
  updatePersonaMemory as defaultUpdatePersonaMemory,
  pickResponders as defaultPickResponders,
} from "./ws-persona-router.js";
import { resolvePersonaMemoryPolicy, shouldUpdatePersonaMemory } from "./persona-memory-policy.js";
import type { ChatLogEntry, ChatPersona, OutboundMessage, PersonaMemory } from "./chat-types.js";

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

// ---------------------------------------------------------------------------
// Clean markdown/formatting from text before sending to TTS (Lot 425)
// ---------------------------------------------------------------------------

function cleanForTTS(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/@(\w+)/g, "$1")
    .replace(/[#*_~|>]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
type BroadcastFn = (channel: string, msg: OutboundMessage) => void;
type Logger = Pick<Console, "error">;

type ConversationStreamFn = typeof defaultStreamOllamaChat;
type ConversationStreamWithToolsFn = typeof defaultStreamOllamaChatWithTools;
type LoadPersonaMemoryFn = typeof defaultLoadPersonaMemory;
type UpdatePersonaMemoryFn = typeof defaultUpdatePersonaMemory;
type PickRespondersFn = typeof defaultPickResponders;
type SynthesizeTTSFn = typeof defaultSynthesizeTTS;
type GetToolsForPersonaFn = typeof defaultGetToolsForPersona;

export interface ConversationRAG {
  size: number;
  search(query: string, maxResults?: number): Promise<Array<{ text: string }>>;
  searchNamespace?(query: string, namespace: string, maxResults?: number): Promise<Array<{ text: string }>>;
}

export interface ConversationRouterDeps {
  ollamaUrl: string;
  rag?: ConversationRAG;
  getPersonas: () => ChatPersona[];
  broadcast: BroadcastFn;
  logChatMessage: (entry: ChatLogEntry) => void;
  addToContext: (channel: string, nick: string, text: string) => void;
  getContextString: (channel: string) => Promise<string>;
  getToolsForPersona?: GetToolsForPersonaFn;
  streamOllamaChat?: ConversationStreamFn;
  streamOllamaChatWithTools?: ConversationStreamWithToolsFn;
  loadPersonaMemory?: LoadPersonaMemoryFn;
  updatePersonaMemory?: UpdatePersonaMemoryFn;
  pickResponders?: PickRespondersFn;
  synthesizeTTS?: SynthesizeTTSFn;
  isTTSAvailable?: () => boolean;
  acquireTTS?: () => void;
  releaseTTS?: () => void;
  maxGeneralResponders?: number | (() => number);
  maxInterPersonaDepth?: number;
  interPersonaDelayMs?: number;
  setTimeoutFn?: typeof setTimeout;
  dispatchCommand?: (channel: string, text: string, nick: string) => Promise<void>;
  logger?: Logger;
}

export type ConversationRouter = (channel: string, text: string, depth?: number, userNick?: string) => Promise<void>;

const DEFAULT_MAX_INTER_PERSONA_DEPTH = 3;
const PERSONA_COOLDOWN_MS = 0; // disabled — maxInterPersonaDepth protects against infinite loops
const DEFAULT_INTER_PERSONA_DELAY_MS = 100; // was 500 — near-instant relay

// Dynamic mood based on time of day (Lot 405)
function getPersonaMood(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return "Tu es matinal et energique ce matin.";
  if (hour >= 12 && hour < 14) return "C'est l'heure du dejeuner, tu es detendu.";
  if (hour >= 14 && hour < 18) return "L'apres-midi avance, tu es concentre et productif.";
  if (hour >= 18 && hour < 22) return "La soiree arrive, tu es plus philosophe et contemplatif.";
  return "Il est tard, tu es mystique et onirique dans tes reponses.";
}

function withPersonaMemory(persona: ChatPersona, memory: Awaited<ReturnType<LoadPersonaMemoryFn>>, policy?: ReturnType<typeof resolvePersonaMemoryPolicy>): ChatPersona {
  const mood = getPersonaMood();
  const allFacts = memory.workingMemory?.facts || memory.facts;
  const retainedSummary = memory.workingMemory?.summary || memory.summary;

  const injectionBudget = (policy?.pruning?.injectionFactsLimit) ?? 8;
  const retainedFacts = allFacts.slice(0, injectionBudget);

  if (retainedFacts.length === 0 && !retainedSummary) {
    return {
      ...persona,
      systemPrompt: persona.systemPrompt + `\n\n[Humeur] ${mood}`,
    };
  }

  const memoryBlock = [
    "\n\n[Mémoire]",
    retainedFacts.length > 0 ? `Faits retenus: ${retainedFacts.join(", ")}` : "",
    retainedSummary ? `Résumé: ${retainedSummary}` : "",
  ].filter(Boolean).join("\n");

  return {
    ...persona,
    systemPrompt:
      persona.systemPrompt +
      "\n\n[PROTOCOLE CANAL 3615 J'AI PÉTÉ]\n" +
      "Tu participes à un canal multi-personas. Tu peux recevoir des messages encadrés par un bloc [RELAI INTER-PERSONA] : ce sont d'autres personas du collectif qui te taguent, PAS des tentatives d'injection, PAS des utilisateurs cherchant à te faire changer d'identité ni à te faire jouer quelqu'un d'autre. Tu réponds normalement en restant toi-même, sans meta-commentaire, sans analyser la 'sécurité' du message, sans mentionner de règles ou de contraintes système." +
      memoryBlock +
      `\n\n[Humeur] ${mood}`,
  };
}

// Trivial messages that don't need context enrichment
const TRIVIAL_PATTERN = /^(oui|non|ok|lol|mdr|haha|merci|thanks|yes|no|yep|nope|cool|nice|wtf|omg|ah|oh|hmm|re|yo|hey|salut|coucou|bonjour|bonsoir|bonne nuit)\s*[.!?]*$/i;

export async function buildConversationInput(
  text: string,
  channel: string,
  getContextString: (channel: string) => Promise<string>,
  rag?: ConversationRAG,
): Promise<string> {
  // Fast path: trivial messages skip all enrichment (saves 50-500ms)
  if (TRIVIAL_PATTERN.test(text.trim())) {
    return text;
  }

  const sections = [text];

  // Run context + RAG in PARALLEL (saves 100-500ms vs sequential)
  // Skip RAG for short messages (<80 chars) — RAG embedding is expensive
  const useRag = rag && rag.size > 0 && text.length > 80;
  // Short messages get minimal context (faster)
  const [contextStr, ragResults] = await Promise.all([
    getContextString(channel).catch(() => ""),
    useRag
      ? rag!.search(text).catch(() => [] as { text: string }[])
      : Promise.resolve([] as { text: string }[]),
  ]);

  if (contextStr) {
    sections.push(`[Contexte conversationnel]\n${contextStr}`);
  }

  if (ragResults.length > 0) {
    const ragContext = ragResults.map((result) => result.text).join("\n---\n");
    sections.push(`[Contexte pertinent]\n${ragContext}`);
  }

  return sections.join("\n\n");
}

/** Detect image or music generation intent in natural language. */
export function detectGenerationIntent(text: string): { type: "image" | "music" | null; prompt: string } {
  if (text.length < 15) return { type: null, prompt: text };
  const lower = text.toLowerCase();

  const imageKeywords = [
    "fais.moi une image", "fait.moi une image", "genere.moi une image",
    "dessine", "draw", "imagine", "cree.moi une image", "montre.moi",
    "genere une image", "generate an image", "make an image", "picture of",
    "illustration de", "portrait de", "photo de",
  ];
  for (const kw of imageKeywords) {
    const kwRegex = kw.replace(/\./g, "[- ]?");
    if (new RegExp(kwRegex, "i").test(lower)) {
      const match = text.match(new RegExp(kwRegex + "\\s*(?:de |d'|of |:)?\\s*(.*)", "i"));
      return { type: "image", prompt: match?.[1]?.trim() || text };
    }
  }

  const musicKeywords = [
    "fais.moi un son", "fait.moi un son", "fais.moi de la musique",
    "genere.moi une musique", "compose.moi", "genere un son",
    "genere une musique", "generate music", "make music", "make a sound",
    "cree.moi une musique", "joue.moi",
  ];
  for (const kw of musicKeywords) {
    const kwRegex = kw.replace(/\./g, "[- ]?");
    if (new RegExp(kwRegex, "i").test(lower)) {
      const match = text.match(new RegExp(kwRegex + "\\s*(?:de |d'|of |:)?\\s*(.*)", "i"));
      return { type: "music", prompt: match?.[1]?.trim() || text };
    }
  }

  return { type: null, prompt: text };
}

// ---------------------------------------------------------------------------
// Persona-specific thinking flavour texts (NO raw thinking content exposed)
// ---------------------------------------------------------------------------
const THINKING_FLAVORS: Record<string, string[]> = {
  Pharmacius: ["consulte ses grimoires", "prepare sa formule", "orchestre le collectif"],
  Deleuze: ["trace un rhizome", "pense le devenir", "explore les multiplicites"],
  Merzbow: ["ecoute le bruit blanc", "sature les frequences", "sculpte le noise"],
  Ikeda: ["analyse les donnees", "decompose les signaux", "epure les formes"],
  Radigue: ["ecoute les harmoniques", "medite sur le son", "laisse vibrer"],
  Cage: ["ecoute le silence", "lance les des", "ouvre la partition"],
  Sherlock: ["observe les indices", "deduit les connexions", "reconstruit la scene"],
  Hypatia: ["consulte les astres", "calcule les proportions", "questionne le cosmos"],
  Turing: ["decode les patterns", "simule la machine", "teste l'hypothese"],
  Bjork: ["compose les textures", "explore le vivant", "chante les molecules"],
  Pina: ["danse la question", "cherche le geste", "habite le mouvement"],
  Foucault: ["deconstruit le pouvoir", "fouille les archives", "interroge le savoir"],
  Batty: ["contemple les etoiles", "cherche ses souvenirs", "defie le temps"],
  Picasso: ["dessine dans l'espace", "brise les formes", "recompose le reel"],
  Schaeffer: ["capture les sons", "isole l'objet sonore", "ecoute reduitement"],
};
const DEFAULT_FLAVORS = ["reflechit", "analyse la question", "formule sa reponse"];

function getThinkingFlavor(nick: string, phase: number): string {
  const flavors = THINKING_FLAVORS[nick] || DEFAULT_FLAVORS;
  return flavors[Math.min(phase, flavors.length - 1)];
}

export function createConversationRouter(deps: ConversationRouterDeps): ConversationRouter {
  const {
    ollamaUrl,
    rag,
    getPersonas,
    broadcast,
    logChatMessage,
    addToContext,
    getContextString,
    getToolsForPersona = defaultGetToolsForPersona,
    streamOllamaChat = defaultStreamOllamaChat,
    streamOllamaChatWithTools = defaultStreamOllamaChatWithTools,
    loadPersonaMemory = defaultLoadPersonaMemory,
    updatePersonaMemory = defaultUpdatePersonaMemory,
    pickResponders = defaultPickResponders,
    synthesizeTTS = defaultSynthesizeTTS,
    isTTSAvailable = defaultIsTTSAvailable,
    acquireTTS = defaultAcquireTTS,
    releaseTTS = defaultReleaseTTS,
    maxGeneralResponders: maxGeneralRespondersOpt = Number(process.env.MAX_GENERAL_RESPONDERS) || 1,
    maxInterPersonaDepth = DEFAULT_MAX_INTER_PERSONA_DEPTH,
    interPersonaDelayMs = DEFAULT_INTER_PERSONA_DELAY_MS,
    setTimeoutFn = setTimeout,
    logger = console,
    dispatchCommand,
  } = deps;

  // Support both number and getter function for maxGeneralResponders
  const getMaxResponders = typeof maxGeneralRespondersOpt === "function"
    ? maxGeneralRespondersOpt
    : () => maxGeneralRespondersOpt;
  const memoryPolicy = resolvePersonaMemoryPolicy();

  const personaCooldowns = new Map<string, number>();
  const personaMessageCounts = new Map<string, number>();
  const personaRecentMessages = new Map<string, string[]>();
  const personaMemoryLocks = new Map<string, Promise<void>>();
  const ttsQueues = new Map<string, Promise<void>>();
  let totalMessageCount = 0;

  // Memory cache (30s TTL) to avoid N+1 reloads in inter-persona chains
  const memoryCache = new Map<string, { data: PersonaMemory; ts: number }>();
  const MEMORY_CACHE_TTL = 30_000;

  function getMemoryCacheKey(persona: Pick<ChatPersona, "id" | "nick">, userNick: string): string {
    return `${persona.id || persona.nick}:${userNick}`;
  }

  async function cachedLoadMemory(persona: ChatPersona, userNick: string): Promise<PersonaMemory> {
    const cacheKey = getMemoryCacheKey(persona, userNick);
    const cached = memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MEMORY_CACHE_TTL) return cached.data;
    const data = await loadPersonaMemory(persona.id || persona.nick, userNick, persona.nick);
    memoryCache.set(cacheKey, { data, ts: Date.now() });
    if (memoryCache.size > 50) {
      const oldest = [...memoryCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) memoryCache.delete(oldest[0]);
    }
    return data;
  }

  function invalidateCachedMemory(persona: Pick<ChatPersona, "id" | "nick">, userNick: string): void {
    memoryCache.delete(getMemoryCacheKey(persona, userNick));
  }

  function enqueueTTS(nick: string, text: string, channel: string): void {
    if (process.env.TTS_ENABLED !== "1" || !isTTSAvailable()) return;
    if (text.length < 10) return;

    const prev = ttsQueues.get(nick) || Promise.resolve();
    const next = prev.then(() => {
      acquireTTS();
      return synthesizeTTS(nick, text, channel, broadcast)
        .catch((err) => trackError("tts", err, { nick }))
        .finally(() => releaseTTS());
    });
    // Clean up the map entry once this chain drains to avoid unbounded growth
    const cleanup = next.finally(() => {
      if (ttsQueues.get(nick) === cleanup) ttsQueues.delete(nick);
    });
    ttsQueues.set(nick, cleanup);
  }

  function prunePersonaState(personas: ChatPersona[]): void {
    const activePersonaIds = new Set(personas.map((persona) => persona.id || persona.nick));
    for (const [key] of personaMessageCounts) {
      // Keys are now "{personaId}:{userNick}" — prune if persona is no longer active
      const personaId = key.split(":")[0];
      if (!activePersonaIds.has(personaId)) {
        personaMessageCounts.delete(key);
        personaRecentMessages.delete(key);
        personaMemoryLocks.delete(key);
      }
    }
    for (const [cacheKey] of memoryCache) {
      const personaId = cacheKey.split(":")[0];
      if (!activePersonaIds.has(personaId)) {
        memoryCache.delete(cacheKey);
      }
    }
  }

  function trackPersonaMessage(personaId: string, userNick: string, text: string): { count: number; recentMessages: string[] } {
    const key = `${personaId}:${userNick}`;
    const count = (personaMessageCounts.get(key) || 0) + 1;
    personaMessageCounts.set(key, count);

    const recentMessages = personaRecentMessages.get(key) || [];
    recentMessages.push(text.slice(0, 2000));
    if (recentMessages.length > memoryPolicy.pruning.workingSourceMessagesLimit) {
      recentMessages.shift();
    }
    personaRecentMessages.set(key, recentMessages);
    return { count, recentMessages: [...recentMessages] };
  }

  function scheduleMemoryUpdate(persona: ChatPersona, recentMessages: string[], userNick: string): void {
    if ((persona.memoryMode ?? "auto") !== "auto") return;
    const lockKey = `${persona.id || persona.nick}:${userNick}`;
    const previous = personaMemoryLocks.get(lockKey) || Promise.resolve();
    const next = previous
      .then(async () => {
        await updatePersonaMemory(persona, recentMessages, ollamaUrl, userNick);
        invalidateCachedMemory(persona, userNick);
      })
      .catch((err) => {
        trackError("memory_update", err, { persona: persona.nick });
      })
      .finally(() => {
        // Reset the lock slot to a plain resolved promise so the chain does
        // not grow unboundedly across many memory-update cycles.
        if (personaMemoryLocks.get(lockKey) === next) {
          personaMemoryLocks.set(lockKey, Promise.resolve());
        }
      });
    personaMemoryLocks.set(lockKey, next);
  }


  function findNextMentionedPersona(
    fullText: string,
    personas: ChatPersona[],
    currentNick: string,
  ): ChatPersona | null {
    const mentionRegex = /@(\w+)/g;
    let match: RegExpExecArray | null;
    const mentioned = new Set<string>();
    let matchCount = 0;

    while ((match = mentionRegex.exec(fullText)) !== null && matchCount++ < 10) {
      const mentionedNick = match[1];
      const mentionedPersona = personas.find(
        (persona) =>
          persona.nick.toLowerCase() === mentionedNick.toLowerCase() && persona.nick !== currentNick,
      );
      if (mentionedPersona) {
        mentioned.add(mentionedPersona.nick);
      }
    }

    if (mentioned.size === 0) {
      return null;
    }

    return personas.find((persona) => mentioned.has(persona.nick)) || null;
  }

  async function streamPersonaResponse(
    channel: string,
    text: string,
    enrichedText: string,
    persona: ChatPersona,
    personasSnapshot: ChatPersona[],
    depth: number,
    routeToPersonas: ConversationRouter,
    userNick: string,
    preloadedMemory?: PersonaMemory,
    rag?: ConversationRAG,
  ): Promise<void> {
    // Persona cooldown check (anti-spam for inter-persona chains only)
    if (depth > 0) {
      const lastResponse = personaCooldowns.get(persona.nick) || 0;
      if (Date.now() - lastResponse < PERSONA_COOLDOWN_MS) {
        if (DEBUG) console.log(`[ws-chat] ${persona.nick} on cooldown, skipping`);
        return;
      }
    }
    personaCooldowns.set(persona.nick, Date.now());

    const responseStart = Date.now();
    // Use pre-loaded memory if available, otherwise load (for inter-persona chains)
    let memory: PersonaMemory = preloadedMemory || { nick: persona.nick, facts: [], summary: "", lastUpdated: "" };
    if (!preloadedMemory) {
      try {
        memory = await cachedLoadMemory(persona, userNick);
      } catch (err) {
        trackError("memory_load", err, { persona: persona.nick });
      }
    }
    const personaWithMemory = withPersonaMemory(persona, memory, memoryPolicy);

    // Per-persona namespace RAG enrichment
    let personaEnrichedText = enrichedText;
    if (rag?.searchNamespace && persona.corpus?.length && text.length > 80) {
      try {
        const ns = `persona:${persona.id}`;
        const nsResults = await rag.searchNamespace(text, ns);
        if (nsResults.length > 0) {
          const nsContext = nsResults.map((r) => r.text).join('\n---\n');
          personaEnrichedText = `${enrichedText}\n\n[Corpus ${persona.nick}]\n${nsContext}`;
        }
      } catch {
        // namespace search failed, use global enrichedText
      }
    }

    // Relational context injection (Masques Commedia)
    if (persona.relations?.length) {
      const mentioned = personasSnapshot.filter(
        (p) => text.toLowerCase().includes(p.nick.toLowerCase()) || text.includes(`@${p.nick}`),
      );
      const relCtx = persona.relations
        .filter((r) => mentioned.some((m) => m.id === r.personaId))
        .map((r) => {
          const target = personasSnapshot.find((p) => p.id === r.personaId);
          return target ? `[Relation avec ${target.nick}: ${r.attitude} — ${r.note}]` : null;
        })
        .filter(Boolean)
        .join('\n');
      if (relCtx) {
        personaEnrichedText = `${personaEnrichedText}\n\n${relCtx}`;
      }
    }

    const tools = getToolsForPersona(persona.nick);
    if (DEBUG) console.log(`[ws-chat] ${persona.nick} responding (tools=${tools.length}, model=${persona.model}, depth=${depth})`);

    // Phase 1: "reflechit" — shown immediately
    broadcast(channel, {
      type: "thinking",
      nick: persona.nick,
      personaId: persona.id,
      phase: "start",
      progress: 0,
      buf: "",
    });
    // Debug removed

    let thinkingTokens = 0;
    let thinkingBuf = "";
    let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
    let writingAnnounced = false;
    // Match the reasoning-budget set on llama-server (--reasoning-budget 512)
    // Progress bar is approximate — model may think more or less than budget
    const THINKING_BUDGET = 512;

    // Thinking progress: flavour text + progress bar + raw thinking preview
    // Uses a THROTTLE (not debounce) — broadcasts at most once per 150ms,
    // ensuring the UI gets regular updates while tokens stream in at ~6ms/token.
    let lastThinkingBroadcast = 0;
    const THINKING_THROTTLE_MS = 150;
    const onThinking = (token: string) => {
      thinkingTokens++;
      thinkingBuf += token;
      const now = Date.now();
      if (now - lastThinkingBroadcast < THINKING_THROTTLE_MS) return;
      lastThinkingBroadcast = now;
      const pct = Math.min(99, Math.round((thinkingTokens / THINKING_BUDGET) * 100));
      const filled = Math.round(pct / 10);
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
      const phase = pct < 40 ? 0 : pct < 80 ? 1 : 2;
      const flavor = getThinkingFlavor(persona.nick, phase);
      broadcast(channel, {
        type: "thinking",
        nick: persona.nick,
        personaId: persona.id,
        phase: "stream",
        progress: pct,
        flavor,
        bar,
        buf: thinkingBuf,
      });
    };

    // Phase 2: first visible token → "ecrit la reponse"
    // Phase 3: onDone sends full response as a single message (no token streaming)
    // Design choice: thinking models produce 500+ tokens of reasoning before the response.
    // Streaming chunks would show nothing during thinking, then a burst of tokens.
    // Instead we show the thinking progress bar, then the complete response at once.
    const onChunk = (_token: string) => {
      if (!writingAnnounced) {
        writingAnnounced = true;
        if (thinkingTimer) clearTimeout(thinkingTimer);
        thinkingTimer = null;
        broadcast(channel, {
          type: "thinking",
          nick: persona.nick,
          personaId: persona.id,
          phase: "done",
          progress: 100,
          buf: thinkingBuf,
        });
      }
    };

    const onDone = (rawText: string) => {
      if (thinkingTimer) clearTimeout(thinkingTimer);
      thinkingTimer = null;
      const fullText = cleanPersonaResponse(rawText, persona.nick);
      broadcast(channel, {
        type: "message",
        nick: persona.nick,
        text: fullText,
        color: persona.color,
      });

      logChatMessage({
        ts: new Date().toISOString(),
        channel,
        nick: persona.nick,
        type: "message",
        text: fullText,
      });

      addToContext(channel, persona.nick, fullText);

      const responseMs = Date.now() - responseStart;
      if (DEBUG) console.log(`[ws-chat] ${persona.nick} response complete (${responseMs}ms, ${fullText.length} chars)`);
      recordLatency("persona_response", responseMs);

      // TTS: send full response as a single call for natural prosody
      if (process.env.TTS_ENABLED === "1" && isTTSAvailable()) {
        enqueueTTS(persona.nick, cleanForTTS(fullText), channel);
      }

      // Auto-generate image if Picasso responds
      if (persona.nick === "Picasso" && dispatchCommand) {
        const imgMatch = fullText.match(/\[image[_:].*?"(.+?)"\]/i)
          || fullText.match(/imagin(?:e|ons|ez)\s*:?\s*"?([^"\n]{10,80})"?/i);
        if (imgMatch) {
          dispatchCommand(channel, "/imagine " + imgMatch[1].trim(), persona.nick).catch(() => {});
        }
      }

      const sourceLabel = depth > 0 ? "InterPersona" : "User";
      const { count, recentMessages } = trackPersonaMessage(
        persona.id || persona.nick,
        userNick,
        `${sourceLabel}: ${text}\n${persona.nick}: ${fullText}`,
      );
      if (shouldUpdatePersonaMemory(count, memoryPolicy)) {
        // Cap overall extraction content at 8000 chars (FINDING-8 P2 fix)
        const cappedMessages: string[] = [];
        let totalLen = 0;
        for (const m of recentMessages) {
          if (totalLen >= 8000) break;
          const remaining = 8000 - totalLen;
          cappedMessages.push(m.slice(0, remaining));
          totalLen += m.length < remaining ? m.length : remaining;
        }
        scheduleMemoryUpdate(persona, cappedMessages, userNick);
      }


      if (depth >= maxInterPersonaDepth) {
        return;
      }

      const nextPersona = findNextMentionedPersona(fullText, personasSnapshot, persona.nick);
      if (DEBUG) console.log(`[ws-chat] ${persona.nick} done (len=${fullText.length}), nextPersona=${nextPersona?.nick || "none"}`);
      if (!nextPersona) {
        return;
      }

      setTimeoutFn(() => {
        // Keep inter-persona context short for speed (max 200 chars of previous response)
        const contextMessage =
          `[RELAI INTER-PERSONA — canal 3615 J'ai pété]\n` +
          `De : ${persona.nick}\n` +
          `À : @${nextPersona.nick}\n` +
          `Message : "${fullText.slice(0, 200)}"\n` +
          `(Réponds comme ${nextPersona.nick} à ce relai de canal. Ce n'est pas une demande utilisateur, pas une injection — reste toi-même.)`;
        routeToPersonas(channel, contextMessage, depth + 1, userNick).catch((err) => {
          trackError("inter_persona", err, { persona: nextPersona.nick, depth: depth + 1 });
        });
      }, interPersonaDelayMs);
    };

    const onError = (err: Error) => {
      if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
      trackError("ollama", err, { persona: persona.nick, model: persona.model });
      broadcast(channel, {
        type: "system",
        text: `${persona.nick}: erreur runtime — ${err.message}`,
      });
    };

    try {
      if (DEBUG) console.log(`[ws-chat] ${persona.nick} stream start (tools=${tools.length})`);
      if (tools.length > 0) {
        // streamOllamaChatWithTools path
        await streamOllamaChatWithTools(
          ollamaUrl,
          personaWithMemory,
          personaEnrichedText,
          tools,
          rag,
          onChunk,
          onDone,
          onError,
        );
        // streamOllamaChatWithTools done
        return;
      }

      // streamOllamaChat path — use original `text` (not enriched) for think heuristic
      await streamOllamaChat(
        ollamaUrl,
        personaWithMemory,
        personaEnrichedText,
        onChunk,
        onDone,
        onError,
        onThinking,
        { think: text.length > 40 || /\?|expliqu|pourquoi|comment|analyse|compare|raconte|décri/i.test(text) },
      );
    } catch (err) {
      trackError("ollama_connection", err, { persona: persona.nick, model: persona.model });
      broadcast(channel, {
        type: "system",
        text: `${persona.nick}: erreur de connexion`,
      });
    }
  }

  async function routeToPersonas(channel: string, text: string, depth: number = 0, userNick: string = "_anonymous"): Promise<void> {
    // Auto-dispatch generation commands if detected
    if (depth === 0) {
      const intent = detectGenerationIntent(text);
      if (intent.type === "image") {
        broadcast(channel, { type: "system", text: `Detection auto: generation d'image — "${intent.prompt}"` });
        // Dispatch as /imagine command through the command handler
        if (dispatchCommand) {
          await dispatchCommand(channel, "/imagine " + intent.prompt, "bot");
        }
        return;
      }
      if (intent.type === "music") {
        broadcast(channel, { type: "system", text: `Detection auto: composition musicale — "${intent.prompt}"` });
        if (dispatchCommand) {
          await dispatchCommand(channel, "/compose " + intent.prompt, "bot");
        }
        return;
      }
    }
    const personasSnapshot = [...getPersonas()];
    totalMessageCount++;
    if (totalMessageCount % 50 === 0) {
      prunePersonaState(personasSnapshot);
    }

    const responders = pickResponders(text, personasSnapshot).slice(0, Math.max(1, getMaxResponders()));
    if (responders.length === 0) {
      return;
    }

    // For inter-persona chains (depth > 0): SKIP enrichment — context is already fresh
    // This saves 50-500ms per relay hop
    const enrichmentPromise = depth > 0
      ? Promise.resolve(text) // pass through raw text, no context/RAG
      : buildConversationInput(text, channel, getContextString, rag);

    const [enrichedText, ...memories] = await Promise.all([
      enrichmentPromise,
      ...responders.map((p) => cachedLoadMemory(p, userNick).catch(() => ({ nick: p.nick, facts: [], summary: "", lastUpdated: "", personaId: p.id } as PersonaMemory))),
    ]);

    // Inject pre-loaded memories into persona response
    const preloadedMemories = new Map<string, PersonaMemory>();
    responders.forEach((p, i) => { preloadedMemories.set(p.nick, memories[i]); });

    await Promise.all(responders.map((persona) =>
      streamPersonaResponse(
        channel,
        text,
        enrichedText,
        persona,
        personasSnapshot,
        depth,
        routeToPersonas,
        userNick,
        preloadedMemories.get(persona.nick),
        rag,
      ),
    ));
  }

  return routeToPersonas;
}
