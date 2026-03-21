/**
 * Tool definitions for persona tool-calling via Ollama.
 * Each tool maps to an existing function in the codebase.
 */

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

// Available tools
export const TOOLS: Record<string, ToolDefinition> = {
  web_search: {
    type: "function",
    function: {
      name: "web_search",
      description: "Recherche sur le web pour trouver des informations actuelles. Utilise quand tu as besoin de données factuelles ou récentes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "La requête de recherche" },
        },
        required: ["query"],
      },
    },
  },
  image_generate: {
    type: "function",
    function: {
      name: "image_generate",
      description: "Génère une image à partir d'une description textuelle via ComfyUI.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Description détaillée de l'image à générer en anglais" },
        },
        required: ["prompt"],
      },
    },
  },
  rag_search: {
    type: "function",
    function: {
      name: "rag_search",
      description: "Recherche dans la base de connaissances locale (manifeste, documents indexés).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Le sujet à rechercher" },
        },
        required: ["query"],
      },
    },
  },
  music_generate: {
    type: "function",
    function: {
      name: "music_generate",
      description: "Génère de la musique via AI Bridge. Types: music (prompt+style), noise (white/pink/brown), drone, glitch, circus, honk.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "Type: music, noise, drone, grain, glitch, circus, honk" },
          prompt: { type: "string", description: "Description ou paramètres (pour music: style, pour noise: type)" },
          duration: { type: "number", description: "Durée en secondes (5-60)" },
        },
        required: ["type"],
      },
    },
  },
  voice_synthesize: {
    type: "function",
    function: {
      name: "voice_synthesize",
      description: "Synthèse vocale via Kokoro TTS (rapide, 12 voix) ou Piper. Génère un fichier audio WAV.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Texte à prononcer" },
          voice: { type: "string", description: "Voix Kokoro: af_heart, am_adam, bf_emma, etc." },
        },
        required: ["text"],
      },
    },
  },
  audio_analyze: {
    type: "function",
    function: {
      name: "audio_analyze",
      description: "Analyse un fichier audio: détection BPM, durée, format. Suggère des traitements.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Description de ce qu'on cherche dans l'audio" },
        },
        required: ["description"],
      },
    },
  },
};

// Per-persona tool permissions
const PERSONA_TOOLS: Record<string, string[]> = {
  pharmacius: [],  // routeur pur — délègue via @mentions, pas de tools
  sherlock: ["web_search", "rag_search"],
  picasso: ["image_generate", "rag_search"],
  schaeffer: ["music_generate", "audio_analyze", "rag_search"],
  merzbow: ["music_generate", "audio_analyze"],
  radigue: ["music_generate", "audio_analyze", "rag_search"],
  cage: ["music_generate", "rag_search"],
  sunra: ["music_generate", "voice_synthesize"],
  // Default for other personas: rag_search only
};

export function getToolsForPersona(nick: string): ToolDefinition[] {
  const toolNames = PERSONA_TOOLS[nick.toLowerCase()] || ["rag_search"];
  return toolNames.map(name => TOOLS[name]).filter(Boolean);
}

export function getToolNames(nick: string): string[] {
  return PERSONA_TOOLS[nick.toLowerCase()] || ["rag_search"];
}
