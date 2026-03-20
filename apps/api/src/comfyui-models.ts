import logger from "./logger.js";

const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";

export interface ComfyModel {
  name: string;
  type: "checkpoint" | "lora" | "vae";
}

let cachedModels: ComfyModel[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function getComfyUIModels(): Promise<ComfyModel[]> {
  if (cachedModels && Date.now() - cacheTime < CACHE_TTL) return cachedModels;

  try {
    const [checkpoints, loras] = await Promise.all([
      fetch(`${COMFYUI_URL}/object_info/CheckpointLoaderSimple`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.json())
        .then(d => (d?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || []) as string[])
        .catch(() => [] as string[]),
      fetch(`${COMFYUI_URL}/object_info/LoraLoader`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.json())
        .then(d => (d?.LoraLoader?.input?.required?.lora_name?.[0] || []) as string[])
        .catch(() => [] as string[]),
    ]);

    cachedModels = [
      ...checkpoints.map(name => ({ name, type: "checkpoint" as const })),
      ...loras.map(name => ({ name, type: "lora" as const })),
    ];
    cacheTime = Date.now();
    logger.info({ checkpoints: checkpoints.length, loras: loras.length }, "[comfyui] Models discovered");
    return cachedModels;
  } catch {
    return cachedModels || [];
  }
}

/** Invalidate cache (e.g. after installing new models) */
export function clearModelCache(): void {
  cachedModels = null;
  cacheTime = 0;
}

// Smart model selection based on prompt keywords
export function selectModel(prompt: string, models: ComfyModel[]): { checkpoint: string; lora?: string; loraStrength?: number } {
  const lower = prompt.toLowerCase();
  const checkpoints = models.filter(m => m.type === "checkpoint").map(m => m.name);
  const loras = models.filter(m => m.type === "lora").map(m => m.name);

  // Default: prefer SDXL Lightning for speed
  let checkpoint = checkpoints.find(c => c.includes("sdxl_lightning_4step")) || checkpoints.find(c => c.includes("sdxl")) || checkpoints[0] || "sdxl_lightning_4step.safetensors";
  let lora: string | undefined;
  let loraStrength = 0.7;

  // Realistic / Photographic
  if (lower.match(/realist|photo|portrait|human|face|person|stock/)) {
    checkpoint = checkpoints.find(c => c.match(/epicrealism|majicmix|cyberrealistic|realisticVision|realisticStock/i)) || checkpoint;
  }
  // Film / Cinematic
  if (lower.match(/film|cinema|movie|grain/)) {
    checkpoint = checkpoints.find(c => c.match(/leosamsFilm|epicrealism/i)) || checkpoint;
  }
  // Anime / Manga / Cartoon
  if (lower.match(/anime|manga|cartoon|illustration|toon/)) {
    checkpoint = checkpoints.find(c => c.match(/toonyou|revAnimated/i)) || checkpoint;
  }
  // Abstract / Art / Painting
  if (lower.match(/abstract|art|paint|surreal|dream|oil|impressionis/)) {
    checkpoint = checkpoints.find(c => c.match(/dream|Deliberate|impressionism/i)) || checkpoint;
    lora = loras.find(l => l.match(/Pixel.Sorting/i));
  }
  // Cyberpunk / SciFi / Neon
  if (lower.match(/cyber|sci.fi|futur|neon|tech|robot/)) {
    checkpoint = checkpoints.find(c => c.match(/cyberrealistic|dream/i)) || checkpoint;
  }
  // Animal / Hybrid
  if (lower.match(/animal|hybrid|creature|beast|chimera/)) {
    checkpoint = checkpoints.find(c => c.match(/animalHuman/i)) || checkpoint;
  }
  // Night / Dark
  if (lower.match(/night|dark|noir|shadow|low.light/)) {
    checkpoint = checkpoints.find(c => c.match(/nightvision/i)) || checkpoint;
  }
  // Eyes emphasis
  if (lower.match(/eyes|regard|yeux|gaze/)) {
    lora = loras.find(l => l.match(/Loraeyes/i)) || lora;
    loraStrength = 0.5;
  }
  // Lips / mouth emphasis
  if (lower.match(/lips|bouche|mouth|kiss/)) {
    lora = loras.find(l => l.match(/lips|megalips/i)) || lora;
    loraStrength = 0.6;
  }
  // Ghost / Ethereal
  if (lower.match(/ghost|fanto|ethereal|spirit|spectr/)) {
    lora = loras.find(l => l.match(/gossghost/i)) || lora;
    loraStrength = 0.8;
  }

  return { checkpoint, lora, loraStrength };
}
