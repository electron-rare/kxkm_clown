import logger from "./logger.js";
import { getComfyUIModels, selectModel } from "./comfyui-models.js";

// ---------------------------------------------------------------------------
// ComfyUI image generation with smart model/LoRA selection
// ---------------------------------------------------------------------------

export const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";

export async function generateImage(prompt: string): Promise<{ imageBase64: string; seed: number; model?: string; lora?: string } | null> {
  const seed = Math.floor(Math.random() * 2 ** 32);

  // Smart model selection: discover available models and pick best match
  const models = await getComfyUIModels();
  const selection = models.length > 0
    ? selectModel(prompt, models)
    : { checkpoint: process.env.COMFYUI_CHECKPOINT || "sdxl_lightning_4step.safetensors", lora: undefined, loraStrength: 0.7 };

  const checkpoint = selection.checkpoint;
  const isFlux = checkpoint.toLowerCase().includes("flux");
  const isLightning = checkpoint.toLowerCase().includes("lightning");
  const isTurbo = checkpoint.toLowerCase().includes("turbo");

  // Adapt workflow parameters based on model type
  let steps: number, cfg: number, sampler: string, scheduler: string;
  if (isFlux) {
    steps = 20; cfg = 3.5; sampler = "euler"; scheduler = "normal";
  } else if (isLightning) {
    steps = 4; cfg = 1.5; sampler = "dpmpp_sde"; scheduler = "karras";
  } else if (isTurbo) {
    steps = 6; cfg = 1.8; sampler = "dpmpp_sde"; scheduler = "karras";
  } else {
    // Standard SD 1.5 / SDXL models need more steps
    steps = 25; cfg = 7; sampler = "euler_ancestral"; scheduler = "normal";
  }

  logger.info({ checkpoint, lora: selection.lora, steps, cfg, sampler }, "[comfyui] Generating with smart selection");

  // Build workflow — model output is node "4", slot 0=model, 1=clip, 2=vae
  let modelOutput: [string, number] = ["4", 0];
  let clipOutput: [string, number] = ["4", 1];

  const workflow: Record<string, any> = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpoint },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "kxkm", images: ["8", 0] },
    },
  };

  // Insert LoRA node if selected
  if (selection.lora) {
    workflow["10"] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: selection.lora,
        strength_model: selection.loraStrength ?? 0.7,
        strength_clip: selection.loraStrength ?? 0.7,
        model: ["4", 0],
        clip: ["4", 1],
      },
    };
    modelOutput = ["10", 0];
    clipOutput = ["10", 1];
  }

  // CLIP encode nodes use the (possibly LoRA-modified) clip output
  workflow["6"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: prompt, clip: clipOutput },
  };
  workflow["7"] = {
    class_type: "CLIPTextEncode",
    inputs: { text: "ugly, blurry, low quality, deformed", clip: clipOutput },
  };

  // KSampler uses the (possibly LoRA-modified) model output
  workflow["3"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps,
      cfg,
      sampler_name: sampler,
      scheduler,
      denoise: 1,
      model: modelOutput,
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: ["5", 0],
    },
  };

  try {
    // Queue the prompt
    const queueRes = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!queueRes.ok) return null;
    const queueData = (await queueRes.json()) as { prompt_id?: string };
    const promptId = queueData.prompt_id;
    if (!promptId) return null;

    // Poll for completion (up to 120 s)
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const histRes = await fetch(`${COMFYUI_URL}/history/${promptId}`);
      if (!histRes.ok) continue;

      const history = (await histRes.json()) as Record<string, any>;
      const entry = history[promptId];
      if (!entry?.outputs) continue;

      // Find the SaveImage output
      for (const nodeId of Object.keys(entry.outputs)) {
        const output = entry.outputs[nodeId];
        if (output.images && output.images.length > 0) {
          const img = output.images[0];
          const imgRes = await fetch(
            `${COMFYUI_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`,
          );
          if (!imgRes.ok) continue;

          const buffer = Buffer.from(await imgRes.arrayBuffer());
          return { imageBase64: buffer.toString("base64"), seed, model: checkpoint, lora: selection.lora };
        }
      }
    }

    return null;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[comfyui] Error");
    return null;
  }
}
