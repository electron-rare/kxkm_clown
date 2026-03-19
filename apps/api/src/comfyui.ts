import logger from "./logger.js";

// ---------------------------------------------------------------------------
// ComfyUI image generation
// ---------------------------------------------------------------------------

export const COMFYUI_URL = process.env.COMFYUI_URL || "https://stable2.kxkm.net";

export async function generateImage(prompt: string): Promise<{ imageBase64: string; seed: number } | null> {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const checkpoint = process.env.COMFYUI_CHECKPOINT || "sdxl_lightning_4step.safetensors";
  const isFlux = checkpoint.toLowerCase().includes("flux");

  // Adapt workflow for SDXL vs Flux 2
  const steps = isFlux ? 20 : 4;
  const cfg = isFlux ? 3.5 : 1.5;
  const sampler = isFlux ? "euler" : "dpmpp_sde";
  const scheduler = isFlux ? "normal" : "karras";

  const workflow = {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpoint },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: "ugly, blurry, low quality, deformed", clip: ["4", 1] },
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
          return { imageBase64: buffer.toString("base64"), seed };
        }
      }
    }

    return null;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[comfyui] Error");
    return null;
  }
}
