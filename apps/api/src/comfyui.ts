import WebSocket from "ws";
import logger from "./logger.js";
import { getComfyUIModels, selectModel } from "./comfyui-models.js";

// ---------------------------------------------------------------------------
// ComfyUI image generation with smart model/LoRA selection + real progress
// ---------------------------------------------------------------------------

export const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";

export interface ImageProgress {
  step: number;
  totalSteps: number;
  percent: number;
  phase: "queued" | "loading" | "sampling" | "decoding" | "saving" | "done";
  model?: string;
  lora?: string;
  elapsed: number; // ms since start
  preview?: string; // data:image/* base64 preview frame
}

export interface GenerateImageOptions {
  onProgress?: (p: ImageProgress) => void;
}

export async function generateImage(
  prompt: string,
  opts?: GenerateImageOptions,
): Promise<{ imageBase64: string; seed: number; model?: string; lora?: string } | null> {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const startTime = Date.now();

  // Smart model selection
  const models = await getComfyUIModels();
  const selection = models.length > 0
    ? selectModel(prompt, models)
    : { checkpoint: process.env.COMFYUI_CHECKPOINT || "sdxl_lightning_4step.safetensors", lora: undefined, loraStrength: 0.7 };

  const checkpoint = selection.checkpoint;
  const ckLower = checkpoint.toLowerCase();
  const isFlux = ckLower.includes("flux");
  const isLightning = ckLower.includes("lightning");
  const isTurbo = ckLower.includes("turbo");
  const isLCM = ckLower.includes("lcm");

  let steps: number, cfg: number, sampler: string, scheduler: string;
  if (isFlux) {
    steps = 20; cfg = 3.5; sampler = "euler"; scheduler = "normal";
  } else if (isLightning) {
    steps = 4; cfg = 1.5; sampler = "dpmpp_sde"; scheduler = "karras";
  } else if (isLCM) {
    steps = 6; cfg = 1.5; sampler = "lcm"; scheduler = "sgm_uniform";
  } else if (isTurbo) {
    steps = 6; cfg = 1.8; sampler = "dpmpp_sde"; scheduler = "karras";
  } else {
    steps = 25; cfg = 7; sampler = "euler_ancestral"; scheduler = "normal";
  }

  logger.info({ checkpoint, lora: selection.lora, steps, cfg, sampler }, "[comfyui] Generating with smart selection");

  const emitProgress = (phase: ImageProgress["phase"], step = 0) => {
    opts?.onProgress?.({
      step,
      totalSteps: steps,
      percent: phase === "done" ? 100 : Math.round((step / steps) * 100),
      phase,
      model: checkpoint,
      lora: selection.lora,
      elapsed: Date.now() - startTime,
    });
  };

  emitProgress("queued");

  // Build workflow
  let modelOutput: [string, number] = ["4", 0];
  let clipOutput: [string, number] = ["4", 1];

  const workflow: Record<string, any> = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "kxkm", images: ["8", 0] } },
  };

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

  workflow["6"] = { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: clipOutput } };
  workflow["7"] = { class_type: "CLIPTextEncode", inputs: { text: "ugly, blurry, low quality, deformed", clip: clipOutput } };
  workflow["3"] = {
    class_type: "KSampler",
    inputs: { seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1, model: modelOutput, positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] },
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

    emitProgress("loading");

    // Use ComfyUI WebSocket for real-time progress
    const comfyWsUrl = COMFYUI_URL.replace(/^http/, "ws") + "/ws?clientId=kxkm_" + promptId.slice(0, 8);

    const result = await new Promise<{ imageBase64: string; seed: number; model?: string; lora?: string } | null>((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; ws.close(); resolve(null); }
      }, 120_000);

      const ws = new WebSocket(comfyWsUrl);

      ws.on("message", async (data: WebSocket.Data) => {
        try {
          // ComfyUI sends binary preview frames (type 1 = JPEG preview, type 2 = PNG)
          // Extract and forward as preview image
          const buf = Buffer.isBuffer(data) ? data : (typeof data === "string" ? null : Buffer.from(data as ArrayBuffer));
          if (buf && buf.length > 8 && (buf[0] === 1 || buf[0] === 2)) {
            // Binary preview: first 4 bytes = type+format, rest = image data
            const previewData = buf.subarray(8); // skip header
            if (previewData.length > 100) {
              const mime = buf[0] === 2 ? "image/png" : "image/jpeg";
              opts?.onProgress?.({
                step: 0, totalSteps: steps,
                percent: -1, // signal: this is a preview frame, not a step
                phase: "sampling",
                model: checkpoint, lora: selection.lora,
                elapsed: Date.now() - startTime,
                preview: `data:${mime};base64,${previewData.toString("base64")}`,
              } as ImageProgress & { preview: string });
            }
            return;
          }

          // JSON messages
          if (!buf && typeof data !== "string") return;
          const raw = typeof data === "string" ? data : buf!.toString("utf8");
          if (raw.charCodeAt(0) > 127) return;

          const msg = JSON.parse(raw) as Record<string, any>;

          if (msg.type === "progress" && msg.data) {
            const { value, max } = msg.data;
            emitProgress("sampling", value);
          }

          if (msg.type === "executing" && msg.data) {
            const nodeId = msg.data.node;
            if (nodeId === "8") emitProgress("decoding", steps);
            if (nodeId === "9") emitProgress("saving", steps);
            // null node = execution done
            if (nodeId === null && msg.data.prompt_id === promptId) {
              emitProgress("done", steps);
              // Fetch the result image from history
              ws.close();
              clearTimeout(timeout);
              if (resolved) return;
              resolved = true;

              // Small delay to let ComfyUI write the output
              await new Promise(r => setTimeout(r, 300));
              const img = await fetchResultImage(promptId);
              if (img) {
                resolve({ imageBase64: img, seed, model: checkpoint, lora: selection.lora });
              } else {
                resolve(null);
              }
            }
          }
        } catch { /* ignore parse errors on binary frames */ }
      });

      ws.on("error", (err) => {
        logger.warn({ err: err.message }, "[comfyui] WS error, falling back to polling");
        ws.close();
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          // Fallback: poll for result
          pollForResult(promptId, steps, emitProgress).then(img => {
            resolve(img ? { imageBase64: img, seed, model: checkpoint, lora: selection.lora } : null);
          });
        }
      });

      ws.on("close", () => {
        // If closed before resolving, fall back to polling
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          pollForResult(promptId, steps, emitProgress).then(img => {
            resolve(img ? { imageBase64: img, seed, model: checkpoint, lora: selection.lora } : null);
          });
        }
      });
    });

    return result;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[comfyui] Error");
    return null;
  }
}

// Fetch result image from ComfyUI history
async function fetchResultImage(promptId: string): Promise<string | null> {
  try {
    const histRes = await fetch(`${COMFYUI_URL}/history/${promptId}`);
    if (!histRes.ok) return null;
    const history = (await histRes.json()) as Record<string, any>;
    const entry = history[promptId];
    if (!entry?.outputs) return null;

    for (const nodeId of Object.keys(entry.outputs)) {
      const output = entry.outputs[nodeId];
      if (output.images?.length > 0) {
        const img = output.images[0];
        const imgRes = await fetch(
          `${COMFYUI_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`,
        );
        if (!imgRes.ok) continue;
        return Buffer.from(await imgRes.arrayBuffer()).toString("base64");
      }
    }
    return null;
  } catch { return null; }
}

// Fallback polling (if WS connection fails)
async function pollForResult(
  promptId: string,
  totalSteps: number,
  emitProgress: (phase: ImageProgress["phase"], step?: number) => void,
): Promise<string | null> {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000));
    // Simulate progress in polling mode
    if (i < totalSteps) emitProgress("sampling", i + 1);
    const img = await fetchResultImage(promptId);
    if (img) {
      emitProgress("done", totalSteps);
      return img;
    }
  }
  return null;
}
