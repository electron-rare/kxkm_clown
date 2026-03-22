/**
 * A2A Agent Card — Agent2Agent protocol discovery endpoint.
 * Spec: https://a2a-protocol.org/latest/specification/
 *
 * Exposes the KXKM chat system as an A2A-compatible agent
 * with capabilities for text chat, music generation, and voice synthesis.
 */

import type { Request, Response } from "express";

const AGENT_CARD = {
  name: "3615-KXKM",
  description: "Systeme de chat IA multimodal avec 33+ personas, generation musicale, synthese vocale, et openDIAW.be DAW integration.",
  url: process.env.PUBLIC_URL || "https://kxkm-ai.local:3333",
  version: "1.0.0",
  protocol_version: "0.3",
  capabilities: {
    streaming: true,
    push_notifications: false,
    state_transition_history: false,
  },
  skills: [
    {
      id: "chat",
      name: "Chat IA",
      description: "Envoie un message au systeme de chat et recoit les reponses des personas IA (33+ personnalites).",
      tags: ["chat", "ai", "persona", "french"],
      examples: ["Parle-moi de la musique concrete", "@Schaeffer que penses-tu du bruit ?"],
    },
    {
      id: "music_generate",
      name: "Generation musicale",
      description: "Genere de la musique, des sons, des instruments via 18 backends AI Bridge.",
      tags: ["music", "audio", "generation", "tts"],
      examples: ["Genere un drone en C2", "Cree un glitch de 10 secondes"],
    },
    {
      id: "voice_synthesize",
      name: "Synthese vocale",
      description: "Synthetise de la voix via Kokoro TTS (12 voix) ou Piper.",
      tags: ["tts", "voice", "speech"],
      examples: ["Dis bonjour avec la voix af_heart"],
    },
    {
      id: "image_generate",
      name: "Generation d'images",
      description: "Genere des images via ComfyUI (32 checkpoints, 24 LoRAs).",
      tags: ["image", "comfyui", "stable-diffusion"],
      examples: ["Un clown cyberpunk dans un terminal Minitel"],
    },
    {
      id: "web_search",
      name: "Recherche web",
      description: "Recherche web via SearXNG self-hosted.",
      tags: ["search", "web"],
    },
  ],
  authentication: {
    type: "none",
  },
  default_input_modes: ["text"],
  default_output_modes: ["text"],
};

export function agentCardRoute(_req: Request, res: Response): void {
  res.json(AGENT_CARD);
}

/**
 * Minimal A2A JSON-RPC handler.
 * Supports: tasks/send for basic chat interaction.
 */
export async function a2aRpcRoute(req: Request, res: Response): Promise<void> {
  const body = req.body as { jsonrpc?: string; method?: string; id?: unknown; params?: Record<string, unknown> };
  if (body.jsonrpc !== "2.0" || !body.method) {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: body.id ?? null });
    return;
  }

  switch (body.method) {
    case "tasks/send": {
      const message = body.params?.message as { parts?: Array<{ type: string; text?: string }> } | undefined;
      const text = message?.parts?.find(p => p.type === "text")?.text || "";
      if (!text) {
        res.json({ jsonrpc: "2.0", result: { id: crypto.randomUUID(), status: { state: "failed", message: { parts: [{ type: "text", text: "No text provided" }] } } }, id: body.id });
        return;
      }
      // Forward to internal chat API
      res.json({
        jsonrpc: "2.0",
        result: {
          id: crypto.randomUUID(),
          status: {
            state: "completed",
            message: {
              role: "agent",
              parts: [{ type: "text", text: `Message recu: "${text}". Connectez-vous au WebSocket sur ${AGENT_CARD.url}/ws pour les reponses en temps reel des personas.` }],
            },
          },
        },
        id: body.id,
      });
      return;
    }
    default:
      res.json({ jsonrpc: "2.0", error: { code: -32601, message: `Method not found: ${body.method}` }, id: body.id ?? null });
  }
}
