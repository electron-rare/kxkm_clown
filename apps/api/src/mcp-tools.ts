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
};

// Per-persona tool permissions
const PERSONA_TOOLS: Record<string, string[]> = {
  // Pharmacius is a router — no tools, delegates to specialists via @mentions
  sherlock: ["web_search", "rag_search"],
  picasso: ["image_generate", "rag_search"],
  // Default for other personas: rag_search only
};

export function getToolsForPersona(nick: string): ToolDefinition[] {
  const toolNames = PERSONA_TOOLS[nick.toLowerCase()] || ["rag_search"];
  return toolNames.map(name => TOOLS[name]).filter(Boolean);
}

export function getToolNames(nick: string): string[] {
  return PERSONA_TOOLS[nick.toLowerCase()] || ["rag_search"];
}
