import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildConversationInput, createConversationRouter, detectGenerationIntent, type ConversationRouterDeps } from "./ws-conversation-router.js";
import type { ChatLogEntry, ChatPersona, OutboundMessage } from "./chat-types.js";

const PERSONAS: ChatPersona[] = [
  {
    id: "pharmacius",
    nick: "Pharmacius",
    model: "llama3",
    systemPrompt: "Tu es Pharmacius.",
    color: "#c84c0c",
  },
  {
    id: "sherlock",
    nick: "Sherlock",
    model: "llama3",
    systemPrompt: "Tu es Sherlock.",
    color: "#2c6e49",
  },
];

type BroadcastRecord = { channel: string; msg: OutboundMessage };
type MemoryUpdateRecord = { persona: ChatPersona; recentMessages: string[]; ollamaUrl: string };

interface TestHarness {
  deps: ConversationRouterDeps;
  broadcasts: BroadcastRecord[];
  logs: ChatLogEntry[];
  contexts: Array<{ channel: string; nick: string; text: string }>;
  plainCalls: Array<{ persona: ChatPersona; message: string }>;
  toolCalls: Array<{ persona: ChatPersona; message: string; tools: unknown[] }>;
  memoryUpdates: MemoryUpdateRecord[];
  ttsCalls: Array<{ nick: string; text: string; channel: string }>;
  errors: string[];
}

const originalTtsEnabled = process.env.TTS_ENABLED;

afterEach(() => {
  if (originalTtsEnabled === undefined) {
    delete process.env.TTS_ENABLED;
  } else {
    process.env.TTS_ENABLED = originalTtsEnabled;
  }
});

function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHarness(overrides: Partial<ConversationRouterDeps> = {}): TestHarness {
  const broadcasts: BroadcastRecord[] = [];
  const logs: ChatLogEntry[] = [];
  const contexts: Array<{ channel: string; nick: string; text: string }> = [];
  const plainCalls: Array<{ persona: ChatPersona; message: string }> = [];
  const toolCalls: Array<{ persona: ChatPersona; message: string; tools: unknown[] }> = [];
  const memoryUpdates: MemoryUpdateRecord[] = [];
  const ttsCalls: Array<{ nick: string; text: string; channel: string }> = [];
  const errors: string[] = [];

  const deps: ConversationRouterDeps = {
    ollamaUrl: "http://ollama.test",
    getPersonas: () => PERSONAS,
    broadcast: (channel, msg) => {
      broadcasts.push({ channel, msg });
    },
    logChatMessage: (entry) => {
      logs.push(entry);
    },
    addToContext: (channel, nick, text) => {
      contexts.push({ channel, nick, text });
    },
    getContextString: async () => "",
    getToolsForPersona: () => [],
    loadPersonaMemory: async (subject) => ({
      nick: typeof subject === "string" ? subject : subject.nick,
      personaId: typeof subject === "string" ? undefined : subject.id,
      facts: [],
      summary: "",
      lastUpdated: "",
    }),
    updatePersonaMemory: async (persona, recentMessages, ollamaUrl) => {
      memoryUpdates.push({ persona, recentMessages, ollamaUrl });
    },
    streamOllamaChat: async (_ollamaUrl, persona, message, _onChunk, onDone) => {
      plainCalls.push({ persona, message });
      onDone(`Reponse ${persona.nick}`);
    },
    streamOllamaChatWithTools: async (_ollamaUrl, persona, message, tools, _rag, _onChunk, onDone) => {
      toolCalls.push({ persona, message, tools });
      onDone(`Reponse outils ${persona.nick}`);
    },
    synthesizeTTS: async (nick, text, channel) => {
      ttsCalls.push({ nick, text, channel });
    },
    isTTSAvailable: () => true,
    acquireTTS: () => {},
    releaseTTS: () => {},
    interPersonaDelayMs: 0,
    logger: {
      error: (...args: unknown[]) => {
        errors.push(args.map((item) => String(item)).join(" "));
      },
    },
    ...overrides,
  };

  return {
    deps,
    broadcasts,
    logs,
    contexts,
    plainCalls,
    toolCalls,
    memoryUpdates,
    ttsCalls,
    errors,
  };
}

describe("ws-conversation-router", () => {
  it("combines context store and RAG results in the enriched input", async () => {
    const enriched = await buildConversationInput(
      "Question utilisateur assez longue pour activer le RAG, avec plus de contexte ici et encore plus de texte pour depasser la limite",
      "#general",
      async () => "Historique compact",
      {
        size: 1,
        search: async () => [{ text: "Document A" }, { text: "Document B" }],
      },
    );

    assert.match(enriched, /Question utilisateur/);
    assert.match(enriched, /\[Contexte conversationnel\]/);
    assert.match(enriched, /Historique compact/);
    assert.match(enriched, /\[Contexte pertinent\]/);
    assert.match(enriched, /Document A/);
    assert.match(enriched, /Document B/);
  });

  it("routes a direct @mention only to the mentioned persona", async () => {
    const harness = createHarness();
    const routeToPersonas = createConversationRouter(harness.deps);

    await routeToPersonas("#general", "@Sherlock analyse ceci");

    const replies = harness.broadcasts
      .filter((entry) => entry.msg.type === "message")
      .map((entry) => (entry.msg.type === "message" ? entry.msg.nick : ""));
    assert.deepEqual(replies, ["Sherlock"]);
  });

  it("falls back to Pharmacius without a direct mention", async () => {
    const harness = createHarness();
    const routeToPersonas = createConversationRouter(harness.deps);

    await routeToPersonas("#general", "bonjour tout le monde");

    const replies = harness.broadcasts
      .filter((entry) => entry.msg.type === "message")
      .map((entry) => (entry.msg.type === "message" ? entry.msg.nick : ""));
    assert.deepEqual(replies, ["Pharmacius"]);
  });

  it("switches to the tool-calling path when a persona has tools", async () => {
    const harness = createHarness({
      getToolsForPersona: (nick) => (nick === "Pharmacius" ? [{ type: "function", function: { name: "web_search", description: "", parameters: { type: "object", properties: {}, required: [] } } }] : []),
    });
    const routeToPersonas = createConversationRouter(harness.deps);

    await routeToPersonas("#general", "question sans mention");

    assert.equal(harness.toolCalls.length, 1);
    assert.equal(harness.toolCalls[0]?.persona.nick, "Pharmacius");
    assert.equal(harness.plainCalls.length, 0);
  });

  it("updates persona memory every five responses with serialized recent messages", async () => {
    const harness = createHarness();
    const routeToPersonas = createConversationRouter(harness.deps);

    for (let index = 1; index <= 5; index += 1) {
      await routeToPersonas("#general", `message ${index}`);
    }
    await sleep();

    assert.equal(harness.memoryUpdates.length, 1);
    assert.equal(harness.memoryUpdates[0]?.persona.nick, "Pharmacius");
    assert.equal(harness.memoryUpdates[0]?.recentMessages.length, 5);
    assert.match(harness.memoryUpdates[0]?.recentMessages[4] || "", /message 5/);
  });

  it("triggers TTS only when the feature flag is enabled", async () => {
    process.env.TTS_ENABLED = "0";
    const disabledHarness = createHarness();
    const disabledRouter = createConversationRouter(disabledHarness.deps);
    await disabledRouter("#general", "premier message");

    process.env.TTS_ENABLED = "1";
    const enabledHarness = createHarness();
    const enabledRouter = createConversationRouter(enabledHarness.deps);
    await enabledRouter("#general", "second message");
    await sleep();

    assert.equal(disabledHarness.ttsCalls.length, 0);
    assert.equal(enabledHarness.ttsCalls.length, 1);
    assert.equal(enabledHarness.ttsCalls[0]?.nick, "Pharmacius");
  });

  it("caps inter-persona rebounds at the configured depth", async () => {
    const harness = createHarness({
      streamOllamaChat: async (_ollamaUrl, persona, _message, _onChunk, onDone) => {
        harness.plainCalls.push({ persona, message: _message });
        if (persona.nick === "Pharmacius") {
          onDone("Sherlock, regarde ca. @Sherlock");
          return;
        }
        onDone("Je reponds a Pharmacius. @Pharmacius");
      },
      maxInterPersonaDepth: 1,
    });
    const routeToPersonas = createConversationRouter(harness.deps);

    await routeToPersonas("#general", "ouvre le debat");
    await sleep();
    await sleep();

    const replies = harness.broadcasts
      .filter((entry) => entry.msg.type === "message")
      .map((entry) => (entry.msg.type === "message" ? entry.msg.nick : ""));
    assert.deepEqual(replies, ["Pharmacius", "Sherlock"]);
  });

  it("broadcasts a system error when streaming fails without throwing", async () => {
    const harness = createHarness({
      streamOllamaChat: async (_ollamaUrl, _persona, _message, _onChunk, _onDone, onError) => {
        onError(new Error("boom"));
      },
    });
    const routeToPersonas = createConversationRouter(harness.deps);

    await assert.doesNotReject(() => routeToPersonas("#general", "message casse"));
    const systemMessages = harness.broadcasts.filter((entry) => entry.msg.type === "system");
    assert.ok(systemMessages.some((entry) => entry.msg.type === "system" && entry.msg.text.includes("erreur Ollama — boom")));
  });
});

describe("detectGenerationIntent", () => {
  // Image detection — French
  it("detects 'fais-moi une image de' as image intent", () => {
    const r = detectGenerationIntent("fais-moi une image de chat cosmique");
    assert.equal(r.type, "image");
    assert.equal(r.prompt, "chat cosmique");
  });

  it("detects 'fais moi une image' (with space) as image intent", () => {
    const r = detectGenerationIntent("fais moi une image d'un dragon");
    assert.equal(r.type, "image");
    assert.match(r.prompt, /dragon/);
  });

  it("detects 'genere une image' as image intent", () => {
    const r = detectGenerationIntent("genere une image de paysage futuriste");
    assert.equal(r.type, "image");
    assert.equal(r.prompt, "paysage futuriste");
  });

  it("detects 'dessine un portrait' as image intent", () => {
    const r = detectGenerationIntent("dessine un portrait de clown triste");
    assert.equal(r.type, "image");
    assert.match(r.prompt, /portrait/);
  });

  // Image detection — English
  it("detects 'generate an image of' as image intent", () => {
    const r = detectGenerationIntent("generate an image of a sunset over mountains");
    assert.equal(r.type, "image");
    assert.match(r.prompt, /sunset/);
  });

  it("detects 'picture of' as image intent", () => {
    const r = detectGenerationIntent("picture of a cyberpunk city at night");
    assert.equal(r.type, "image");
    assert.match(r.prompt, /cyberpunk/);
  });

  // Music detection — French
  it("detects 'fais-moi de la musique' as music intent", () => {
    const r = detectGenerationIntent("fais-moi de la musique electro ambient");
    assert.equal(r.type, "music");
    assert.match(r.prompt, /electro/);
  });

  it("detects 'compose-moi' as music intent", () => {
    const r = detectGenerationIntent("compose-moi un morceau de jazz lo-fi");
    assert.equal(r.type, "music");
    assert.match(r.prompt, /jazz/);
  });

  it("detects 'genere une musique' as music intent", () => {
    const r = detectGenerationIntent("genere une musique de meditation calme");
    assert.equal(r.type, "music");
    assert.match(r.prompt, /meditation/);
  });

  // Music detection — English
  it("detects 'make music' as music intent", () => {
    const r = detectGenerationIntent("make music with a deep bass drone");
    assert.equal(r.type, "music");
    assert.match(r.prompt, /deep bass/);
  });

  // Negative cases
  it("returns null for short messages", () => {
    const r = detectGenerationIntent("salut");
    assert.equal(r.type, null);
  });

  it("returns null for unrelated long messages", () => {
    const r = detectGenerationIntent("je voudrais comprendre comment fonctionne le systeme de routing des personas");
    assert.equal(r.type, null);
  });

  it("returns null for messages that just contain 'image' without a generation verb", () => {
    const r = detectGenerationIntent("j'ai vu une belle image dans le journal hier soir");
    assert.equal(r.type, null);
  });
});
