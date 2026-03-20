import { trackError } from "./error-tracker.js";
import { getToolsForPersona as defaultGetToolsForPersona, type ToolDefinition } from "./mcp-tools.js";
import {
  streamOllamaChat as defaultStreamOllamaChat,
  streamOllamaChatWithTools as defaultStreamOllamaChatWithTools,
  cleanPersonaResponse,
} from "./ws-ollama.js";
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
import type { ChatLogEntry, ChatPersona, OutboundMessage, PersonaMemory } from "./chat-types.js";

const DEBUG = process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";

// ---------------------------------------------------------------------------
// Sentence-boundary detection for streaming TTS chunking
// ---------------------------------------------------------------------------

const SENTENCE_END = /[.!?;:]\s/;

export function extractSentences(buffer: string): { sentences: string[]; remaining: string } {
  const sentences: string[] = [];
  let remaining = buffer;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(remaining)) !== null) {
    const sentence = remaining.slice(0, match.index + 1).trim();
    if (sentence.length >= 10) {
      sentences.push(sentence);
    }
    remaining = remaining.slice(match.index + 2);
  }
  return { sentences, remaining };
}

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

export type ConversationRouter = (channel: string, text: string, depth?: number) => Promise<void>;

const DEFAULT_MAX_INTER_PERSONA_DEPTH = 3;
const DEFAULT_INTER_PERSONA_DELAY_MS = 500;

function withPersonaMemory(persona: ChatPersona, memory: Awaited<ReturnType<LoadPersonaMemoryFn>>): ChatPersona {
  if (memory.facts.length === 0 && !memory.summary) {
    return persona;
  }

  const memoryBlock = [
    "\n\n[Mémoire]",
    memory.facts.length > 0 ? `Faits retenus: ${memory.facts.join(", ")}` : "",
    memory.summary ? `Résumé: ${memory.summary}` : "",
  ].filter(Boolean).join("\n");

  return {
    ...persona,
    systemPrompt: persona.systemPrompt + memoryBlock,
  };
}

export async function buildConversationInput(
  text: string,
  channel: string,
  getContextString: (channel: string) => Promise<string>,
  rag?: ConversationRAG,
): Promise<string> {
  const sections = [text];

  const contextStr = await getContextString(channel);
  if (contextStr) {
    sections.push(`[Contexte conversationnel]\n${contextStr}`);
  }

  if (rag && rag.size > 0) {
    try {
      const results = await rag.search(text);
      if (results.length > 0) {
        const ragContext = results.map((result) => result.text).join("\n---\n");
        sections.push(`[Contexte pertinent]\n${ragContext}`);
      }
    } catch {
      // Ignore RAG errors and keep the user message flowing.
    }
  }

  return sections.join("\n\n");
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

  const personaMessageCounts = new Map<string, number>();
  const personaRecentMessages = new Map<string, string[]>();
  const personaMemoryLocks = new Map<string, Promise<void>>();
  const ttsQueues = new Map<string, Promise<void>>();
  let totalMessageCount = 0;

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
    ttsQueues.set(nick, next);
  }

  function prunePersonaState(personas: ChatPersona[]): void {
    const activeNicks = new Set(personas.map((persona) => persona.nick));
    for (const [nick] of personaMessageCounts) {
      if (!activeNicks.has(nick)) {
        personaMessageCounts.delete(nick);
        personaRecentMessages.delete(nick);
        personaMemoryLocks.delete(nick);
      }
    }
  }

  function trackPersonaMessage(nick: string, text: string): { count: number; recentMessages: string[] } {
    const count = (personaMessageCounts.get(nick) || 0) + 1;
    personaMessageCounts.set(nick, count);

    const recentMessages = personaRecentMessages.get(nick) || [];
    recentMessages.push(text);
    if (recentMessages.length > 10) {
      recentMessages.shift();
    }
    personaRecentMessages.set(nick, recentMessages);
    return { count, recentMessages: [...recentMessages] };
  }

  function scheduleMemoryUpdate(persona: ChatPersona, recentMessages: string[]): void {
    const previous = personaMemoryLocks.get(persona.nick) || Promise.resolve();
    const next = previous
      .then(() => updatePersonaMemory(persona, recentMessages, ollamaUrl))
      .catch((err) => {
        trackError("memory_update", err, { persona: persona.nick });
      });
    personaMemoryLocks.set(persona.nick, next);
  }


  function findNextMentionedPersona(
    fullText: string,
    personas: ChatPersona[],
    currentNick: string,
  ): ChatPersona | null {
    const mentionRegex = /@(\w+)/g;
    let match: RegExpExecArray | null;
    const mentioned = new Set<string>();

    while ((match = mentionRegex.exec(fullText)) !== null) {
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
  ): Promise<void> {
    let memory: PersonaMemory = { nick: persona.nick, facts: [], summary: "", lastUpdated: "" };
    try {
      memory = await loadPersonaMemory(persona.nick);
    } catch (err) {
      trackError("memory_load", err, { persona: persona.nick });
    }
    const personaWithMemory = withPersonaMemory(persona, memory);
    const tools = getToolsForPersona(persona.nick);
    if (DEBUG) console.log(`[ws-chat] ${persona.nick} responding (tools=${tools.length}, model=${persona.model}, depth=${depth})`);

    // Typing indicator sent AFTER enrichment, right before Ollama call
    const isThinking = persona.model.startsWith("qwen3.5") && text.length > 200;
    broadcast(channel, {
      type: "system",
      text: `${persona.nick} ${isThinking ? "reflechit" : "est en train d'ecrire"}...`,
    });

    let chunkSeq = 0;
    let sentenceBuffer = "";
    let sentenceTTSFired = false;

    const onChunk = (token: string) => {
      chunkSeq++;
      broadcast(channel, {
        type: "chunk" as any,
        nick: persona.nick,
        text: token,
        color: persona.color,
        seq: chunkSeq,
      });

      // Accumulate tokens for sentence-boundary TTS
      sentenceBuffer += token;
      const { sentences, remaining } = extractSentences(sentenceBuffer);
      sentenceBuffer = remaining;
      for (const sentence of sentences) {
        enqueueTTS(persona.nick, sentence, channel);
        sentenceTTSFired = true;
      }
    };

    const onDone = (rawText: string) => {
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

      // Flush remaining sentence buffer to TTS
      if (sentenceBuffer.trim().length >= 10) {
        enqueueTTS(persona.nick, sentenceBuffer.trim(), channel);
        sentenceTTSFired = true;
      }
      sentenceBuffer = "";

      // Fallback: if no sentences were detected during streaming, send full text
      if (!sentenceTTSFired && process.env.TTS_ENABLED === "1" && isTTSAvailable()) {
        enqueueTTS(persona.nick, fullText, channel);
      }

      // Auto-generate image if Picasso responds
      if (persona.nick === "Picasso" && dispatchCommand) {
        const imgMatch = fullText.match(/\[image[_:].*?"(.+?)"\]/i)
          || fullText.match(/imagin(?:e|ons|ez)\s*:?\s*"?([^"\n]{10,80})"?/i);
        if (imgMatch) {
          dispatchCommand(channel, "/imagine " + imgMatch[1].trim(), persona.nick).catch(() => {});
        }
      }

      const { count, recentMessages } = trackPersonaMessage(
        persona.nick,
        `User: ${text}\n${persona.nick}: ${fullText}`,
      );
      if (count > 0 && count % 5 === 0) {
        scheduleMemoryUpdate(persona, recentMessages);
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
        const contextMessage = `${persona.nick} a dit: "${fullText.slice(0, 500)}". @${nextPersona.nick}, réponds-lui.`;
        routeToPersonas(channel, contextMessage, depth + 1).catch((err) => {
          trackError("inter_persona", err, { persona: nextPersona.nick, depth: depth + 1 });
        });
      }, interPersonaDelayMs);
    };

    const onError = (err: Error) => {
      trackError("ollama", err, { persona: persona.nick, model: persona.model });
      broadcast(channel, {
        type: "system",
        text: `${persona.nick}: erreur Ollama — ${err.message}`,
      });
    };

    try {
      if (tools.length > 0) {
        await streamOllamaChatWithTools(
          ollamaUrl,
          personaWithMemory,
          enrichedText,
          tools,
          rag,
          onChunk,
          onDone,
          onError,
        );
        return;
      }

      await streamOllamaChat(
        ollamaUrl,
        personaWithMemory,
        enrichedText,
        onChunk,
        onDone,
        onError,
      );
    } catch (err) {
      trackError("ollama_connection", err, { persona: persona.nick, model: persona.model });
      broadcast(channel, {
        type: "system",
        text: `${persona.nick}: erreur de connexion`,
      });
    }
  }

  // Auto-detect image/music generation requests in natural language
  function detectGenerationIntent(text: string): { type: "image" | "music" | null; prompt: string } {
    const lower = text.toLowerCase();

    // Image generation keywords (French + English)
    const imageKeywords = [
      "fais.moi une image", "fait.moi une image", "genere.moi une image",
      "dessine", "draw", "imagine", "cree.moi une image", "montre.moi",
      "genere une image", "generate an image", "make an image", "picture of",
      "illustration de", "portrait de", "photo de",
    ];
    for (const kw of imageKeywords) {
      const regex = new RegExp(kw.replace(/\./g, "[- ]?"), "i");
      if (regex.test(lower)) {
        // Extract the prompt (everything after the keyword match)
        const match = text.match(new RegExp(kw.replace(/\./g, "[- ]?") + "\s*(?:de |d'|of |:)?\s*(.*)", "i"));
        return { type: "image", prompt: match?.[1]?.trim() || text };
      }
    }

    // Music generation keywords
    const musicKeywords = [
      "fais.moi un son", "fait.moi un son", "fais.moi de la musique",
      "genere.moi une musique", "compose.moi", "genere un son",
      "genere une musique", "generate music", "make music", "make a sound",
      "cree.moi une musique", "joue.moi",
    ];
    for (const kw of musicKeywords) {
      const regex = new RegExp(kw.replace(/\./g, "[- ]?"), "i");
      if (regex.test(lower)) {
        const match = text.match(new RegExp(kw.replace(/\./g, "[- ]?") + "\s*(?:de |d'|of |:)?\s*(.*)", "i"));
        return { type: "music", prompt: match?.[1]?.trim() || text };
      }
    }

    return { type: null, prompt: text };
  }

  async function routeToPersonas(channel: string, text: string, depth: number = 0): Promise<void> {
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

    const enrichedText = await buildConversationInput(text, channel, getContextString, rag);

    await Promise.all(responders.map((persona) =>
      streamPersonaResponse(
        channel,
        text,
        enrichedText,
        persona,
        personasSnapshot,
        depth,
        routeToPersonas,
      ),
    ));
  }

  return routeToPersonas;
}
