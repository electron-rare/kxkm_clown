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
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  seed?: number;
  checkpoint?: string;
}

export async function generateImage(
  prompt: string,
  opts?: GenerateImageOptions,
): Promise<{ imageBase64: string; seed: number; model?: string; lora?: string } | null> {
  const seed = opts?.seed ?? Math.floor(Math.random() * 2 ** 32);
  const startTime = Date.now();

  // Smart model selection (overridable via opts.checkpoint)
  const models = await getComfyUIModels();
  const selection = opts?.checkpoint
    ? { checkpoint: opts.checkpoint, lora: undefined, loraStrength: 0.7 }
    : models.length > 0
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

  // Aspect ratio support
  const ratioMap: Record<string, [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1216, 688],
    "9:16": [688, 1216],
    "4:3": [1152, 864],
    "3:4": [864, 1152],
  };
  const [imgWidth, imgHeight] = ratioMap[opts?.aspectRatio || "1:1"] || [1024, 1024];

  logger.info({ checkpoint, lora: selection.lora, steps, cfg, sampler, aspectRatio: opts?.aspectRatio }, "[comfyui] Generating with smart selection");

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
    "5": { class_type: "EmptyLatentImage", inputs: { width: imgWidth, height: imgHeight, batch_size: 1 } },
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

// ---------------------------------------------------------------------------
// Upload image to ComfyUI input folder
// ---------------------------------------------------------------------------

async function uploadImageToComfyUI(base64: string, filename: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  const form = new FormData();
  form.append("image", new Blob([buf]), filename);
  const resp = await fetch(`${COMFYUI_URL}/upload/image`, { method: "POST", body: form });
  if (!resp.ok) throw new Error(`ComfyUI upload failed: ${resp.status}`);
  const data = (await resp.json()) as { name: string };
  return data.name;
}

// ---------------------------------------------------------------------------
// Fetch result video from ComfyUI history (VHS_VideoCombine output)
// ---------------------------------------------------------------------------

async function fetchResultVideo(promptId: string): Promise<string | null> {
  try {
    const histRes = await fetch(`${COMFYUI_URL}/history/${promptId}`);
    if (!histRes.ok) return null;
    const history = (await histRes.json()) as Record<string, any>;
    const entry = history[promptId];
    if (!entry?.outputs) return null;

    for (const nodeId of Object.keys(entry.outputs)) {
      const output = entry.outputs[nodeId];
      // VHS_VideoCombine outputs gifs/videos
      if (output.gifs?.length > 0) {
        const vid = output.gifs[0];
        const vidRes = await fetch(
          `${COMFYUI_URL}/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder || "")}&type=${encodeURIComponent(vid.type || "output")}`,
        );
        if (!vidRes.ok) continue;
        return Buffer.from(await vidRes.arrayBuffer()).toString("base64");
      }
      // Fallback: check for video key
      if (output.videos?.length > 0) {
        const vid = output.videos[0];
        const vidRes = await fetch(
          `${COMFYUI_URL}/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder || "")}&type=${encodeURIComponent(vid.type || "output")}`,
        );
        if (!vidRes.ok) continue;
        return Buffer.from(await vidRes.arrayBuffer()).toString("base64");
      }
    }
    return null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Generic workflow runner — queues a workflow and waits for result via WS
// ---------------------------------------------------------------------------

async function runWorkflow<T>(
  workflow: Record<string, any>,
  opts: {
    totalSteps: number;
    timeoutMs?: number;
    decodeNodeId?: string;
    saveNodeId?: string;
    onProgress?: (p: ImageProgress) => void;
    extractResult: (promptId: string) => Promise<T | null>;
    model?: string;
    lora?: string;
  },
): Promise<T | null> {
  const startTime = Date.now();
  const totalSteps = opts.totalSteps;
  const timeoutMs = opts.timeoutMs ?? 300_000;

  const emitProgress = (phase: ImageProgress["phase"], step = 0) => {
    opts.onProgress?.({
      step,
      totalSteps,
      percent: phase === "done" ? 100 : Math.round((step / totalSteps) * 100),
      phase,
      model: opts.model,
      lora: opts.lora,
      elapsed: Date.now() - startTime,
    });
  };

  emitProgress("queued");

  try {
    const queueRes = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!queueRes.ok) return null;
    const queueData = (await queueRes.json()) as { prompt_id?: string };
    const promptId = queueData.prompt_id;
    if (!promptId) return null;

    emitProgress("loading");

    const comfyWsUrl = COMFYUI_URL.replace(/^http/, "ws") + "/ws?clientId=kxkm_" + promptId.slice(0, 8);

    const result = await new Promise<T | null>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; ws.close(); resolve(null); }
      }, timeoutMs);

      const ws = new WebSocket(comfyWsUrl);

      ws.on("message", async (data: WebSocket.Data) => {
        try {
          const buf = Buffer.isBuffer(data) ? data : (typeof data === "string" ? null : Buffer.from(data as ArrayBuffer));
          if (buf && buf.length > 8 && (buf[0] === 1 || buf[0] === 2)) {
            const previewData = buf.subarray(8);
            if (previewData.length > 100) {
              const mime = buf[0] === 2 ? "image/png" : "image/jpeg";
              opts.onProgress?.({
                step: 0, totalSteps,
                percent: -1,
                phase: "sampling",
                model: opts.model, lora: opts.lora,
                elapsed: Date.now() - startTime,
                preview: `data:${mime};base64,${previewData.toString("base64")}`,
              });
            }
            return;
          }

          if (!buf && typeof data !== "string") return;
          const raw = typeof data === "string" ? data : buf!.toString("utf8");
          if (raw.charCodeAt(0) > 127) return;

          const msg = JSON.parse(raw) as Record<string, any>;

          if (msg.type === "progress" && msg.data) {
            emitProgress("sampling", msg.data.value);
          }

          if (msg.type === "executing" && msg.data) {
            const nodeId = msg.data.node;
            if (opts.decodeNodeId && nodeId === opts.decodeNodeId) emitProgress("decoding", totalSteps);
            if (opts.saveNodeId && nodeId === opts.saveNodeId) emitProgress("saving", totalSteps);
            if (nodeId === null && msg.data.prompt_id === promptId) {
              emitProgress("done", totalSteps);
              ws.close();
              clearTimeout(timer);
              if (resolved) return;
              resolved = true;
              await new Promise(r => setTimeout(r, 300));
              resolve(await opts.extractResult(promptId));
            }
          }
        } catch { /* ignore parse errors */ }
      });

      ws.on("error", (err) => {
        logger.warn({ err: err.message }, "[comfyui] WS error in workflow runner");
        ws.close();
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          pollForResult(promptId, totalSteps, emitProgress).then(async () => {
            resolve(await opts.extractResult(promptId));
          });
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          pollForResult(promptId, totalSteps, emitProgress).then(async () => {
            resolve(await opts.extractResult(promptId));
          });
        }
      });
    });

    return result;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[comfyui] Workflow runner error");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Text → Video via CogVideoX
// ---------------------------------------------------------------------------

export async function generateVideo(
  prompt: string,
  opts?: { duration?: number; onProgress?: (p: ImageProgress) => void },
): Promise<{ videoBase64: string; seed: number } | null> {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const duration = opts?.duration ?? 6;
  const numFrames = Math.min(Math.max(Math.round(duration * 8), 16), 96); // CogVideoX ~8fps

  const model = "CogVideoX-5b-I2V";

  const workflow: Record<string, any> = {
    "1": { class_type: "CLIPLoader", inputs: { clip_name: "t5xxl_fp16.safetensors", type: "sd3" } },
    "2": { class_type: "CogVideoTextEncode", inputs: { prompt, clip: ["1", 0] } },
    "3": { class_type: "CogVideoTextEncode", inputs: { prompt: "ugly, blurry, low quality, distorted", clip: ["1", 0] } },
    "4": { class_type: "DownloadAndLoadCogVideoModel", inputs: { model: model, precision: "bf16", fp8_transformer: "disabled", compile: "disabled", enable_sequential_cpu_offload: false } },
    "5": { class_type: "CogVideoSampler", inputs: { seed, steps: 50, cfg: 6, num_frames: numFrames, scheduler: "CogVideoXDDIM", denoise_strength: 1.0, model: ["4", 0], positive: ["2", 0], negative: ["3", 0] } },
    "6": { class_type: "CogVideoDecode", inputs: { vae: ["4", 1], samples: ["5", 0], enable_vae_tiling: true } },
    "7": { class_type: "VHS_VideoCombine", inputs: { frame_rate: 8, loop_count: 0, filename_prefix: "kxkm_video", format: "video/h264-mp4", images: ["6", 0] } },
  };

  logger.info({ model, numFrames, seed }, "[comfyui] Generating video with CogVideoX");

  const result = await runWorkflow<{ videoBase64: string; seed: number }>(workflow, {
    totalSteps: 50,
    timeoutMs: 600_000,
    decodeNodeId: "6",
    saveNodeId: "7",
    onProgress: opts?.onProgress,
    model,
    extractResult: async (promptId) => {
      const video = await fetchResultVideo(promptId);
      return video ? { videoBase64: video, seed } : null;
    },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Style Transfer via IPAdapter
// ---------------------------------------------------------------------------

export async function generateStyleTransfer(
  imageBase64: string,
  style: string,
  prompt: string,
  opts?: { strength?: number; onProgress?: (p: ImageProgress) => void },
): Promise<{ imageBase64: string; seed: number } | null> {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const strength = Math.min(Math.max(opts?.strength ?? 0.65, 0.3), 0.9);
  const checkpoint = "juggernautXL_v9Rundiffusionphoto2.safetensors";

  const stylePromptMap: Record<string, string> = {
    painting: "oil painting, masterful brushwork, rich textures, gallery quality",
    anime: "anime style, cel shading, vibrant colors, studio ghibli quality",
    cyberpunk: "cyberpunk aesthetic, neon lights, dark futuristic, blade runner style",
    surreal: "surrealist art, dreamlike, salvador dali style, impossible geometry",
    impressionist: "impressionist painting, claude monet style, soft light, visible brushstrokes",
  };
  const styleHint = stylePromptMap[style] || style;
  const fullPrompt = `${prompt}, ${styleHint}`;

  // Upload source image
  const uploadedName = await uploadImageToComfyUI(imageBase64, `style_input_${seed}.png`);

  const workflow: Record<string, any> = {
    "1": { class_type: "LoadImage", inputs: { image: uploadedName } },
    "2": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "3": { class_type: "VAEEncode", inputs: { pixels: ["1", 0], vae: ["2", 2] } },
    "4": { class_type: "IPAdapterUnifiedLoader", inputs: { preset: "PLUS (high strength)", model: ["2", 0] } },
    "5": { class_type: "IPAdapterAdvanced", inputs: { weight: strength, weight_type: "linear", combine_embeds: "concat", start_at: 0, end_at: 1, embeds_scaling: "V only", model: ["4", 0], ipadapter: ["4", 1], image: ["1", 0] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: fullPrompt, clip: ["2", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "ugly, blurry, low quality, deformed, watermark", clip: ["2", 1] } },
    "8": { class_type: "KSampler", inputs: { seed, steps: 30, cfg: 7, sampler_name: "euler_ancestral", scheduler: "normal", denoise: strength, model: ["5", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["3", 0] } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["2", 2] } },
    "10": { class_type: "SaveImage", inputs: { filename_prefix: "kxkm_style", images: ["9", 0] } },
  };

  logger.info({ checkpoint, style, strength, seed }, "[comfyui] Generating style transfer");

  return runWorkflow<{ imageBase64: string; seed: number }>(workflow, {
    totalSteps: 30,
    decodeNodeId: "9",
    saveNodeId: "10",
    onProgress: opts?.onProgress,
    model: checkpoint,
    extractResult: async (promptId) => {
      const img = await fetchResultImage(promptId);
      return img ? { imageBase64: img, seed } : null;
    },
  });
}

// ---------------------------------------------------------------------------
// Face Swap via ReActor
// ---------------------------------------------------------------------------

export async function generateFaceSwap(
  sourceImageBase64: string,
  targetImageBase64: string,
  opts?: { onProgress?: (p: ImageProgress) => void },
): Promise<{ imageBase64: string } | null> {
  const ts = Date.now();
  const [sourceName, targetName] = await Promise.all([
    uploadImageToComfyUI(sourceImageBase64, `faceswap_source_${ts}.png`),
    uploadImageToComfyUI(targetImageBase64, `faceswap_target_${ts}.png`),
  ]);

  const workflow: Record<string, any> = {
    "1": { class_type: "LoadImage", inputs: { image: sourceName } },
    "2": { class_type: "LoadImage", inputs: { image: targetName } },
    "3": {
      class_type: "ReActorFaceSwap",
      inputs: {
        input_image: ["2", 0],
        source_image: ["1", 0],
        swap_model: "inswapper_128.onnx",
        facedetection: "retinaface_resnet50",
        face_restore_model: "codeformer-v0.1.0.pth",
        face_restore_visibility: 1,
        codeformer_weight: 0.5,
        detect_gender_input: "no",
        detect_gender_source: "no",
        input_faces_index: "0",
        source_faces_index: "0",
        console_log_level: 1,
      },
    },
    "4": { class_type: "SaveImage", inputs: { filename_prefix: "kxkm_faceswap", images: ["3", 0] } },
  };

  logger.info("[comfyui] Generating face swap");

  return runWorkflow<{ imageBase64: string }>(workflow, {
    totalSteps: 5,
    decodeNodeId: "3",
    saveNodeId: "4",
    onProgress: opts?.onProgress,
    model: "ReActor",
    extractResult: async (promptId) => {
      const img = await fetchResultImage(promptId);
      return img ? { imageBase64: img } : null;
    },
  });
}

// ---------------------------------------------------------------------------
// Image → Image (img2img)
// ---------------------------------------------------------------------------

export async function generateImg2Img(
  imageBase64: string,
  prompt: string,
  opts?: { strength?: number; checkpoint?: string; onProgress?: (p: ImageProgress) => void },
): Promise<{ imageBase64: string; seed: number } | null> {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const strength = Math.min(Math.max(opts?.strength ?? 0.65, 0.1), 1.0);
  const checkpoint = opts?.checkpoint || process.env.COMFYUI_CHECKPOINT || "sdxl_lightning_4step.safetensors";

  const ckLower = checkpoint.toLowerCase();
  const isLightning = ckLower.includes("lightning");
  const isTurbo = ckLower.includes("turbo");
  const isLCM = ckLower.includes("lcm");

  let steps: number, cfg: number, sampler: string, scheduler: string;
  if (isLightning) {
    steps = 4; cfg = 1.5; sampler = "dpmpp_sde"; scheduler = "karras";
  } else if (isLCM) {
    steps = 6; cfg = 1.5; sampler = "lcm"; scheduler = "sgm_uniform";
  } else if (isTurbo) {
    steps = 6; cfg = 1.8; sampler = "dpmpp_sde"; scheduler = "karras";
  } else {
    steps = 25; cfg = 7; sampler = "euler_ancestral"; scheduler = "normal";
  }

  const uploadedName = await uploadImageToComfyUI(imageBase64, `img2img_input_${seed}.png`);

  const workflow: Record<string, any> = {
    "1": { class_type: "LoadImage", inputs: { image: uploadedName } },
    "2": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "3": { class_type: "VAEEncode", inputs: { pixels: ["1", 0], vae: ["2", 2] } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 1] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: "ugly, blurry, low quality, deformed, watermark", clip: ["2", 1] } },
    "6": { class_type: "KSampler", inputs: { seed, steps, cfg, sampler_name: sampler, scheduler, denoise: strength, model: ["2", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["3", 0] } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["2", 2] } },
    "8": { class_type: "SaveImage", inputs: { filename_prefix: "kxkm_img2img", images: ["7", 0] } },
  };

  logger.info({ checkpoint, strength, steps, seed }, "[comfyui] Generating img2img");

  return runWorkflow<{ imageBase64: string; seed: number }>(workflow, {
    totalSteps: steps,
    decodeNodeId: "7",
    saveNodeId: "8",
    onProgress: opts?.onProgress,
    model: checkpoint,
    extractResult: async (promptId) => {
      const img = await fetchResultImage(promptId);
      return img ? { imageBase64: img, seed } : null;
    },
  });
}

// ---------------------------------------------------------------------------
// List available workflow types
// ---------------------------------------------------------------------------

/**
 * Preload a ComfyUI checkpoint into VRAM by queuing a 1-step generation.
 * Call at server startup to avoid the 5-10s model load delay on first /imagine.
 */
export async function preloadComfyUIModel(): Promise<void> {
  const checkpoint = process.env.COMFYUI_CHECKPOINT || "sdxl_lightning_4step.safetensors";
  const workflow: Record<string, any> = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "EmptyLatentImage", inputs: { width: 64, height: 64, batch_size: 1 } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "warmup", clip: ["1", 1] } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
    "5": { class_type: "KSampler", inputs: { seed: 0, steps: 1, cfg: 1, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["2", 0] } },
  };
  try {
    const resp = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(30_000),
    });
    if (resp.ok) logger.info({ checkpoint }, "[comfyui] Model preloaded");
    else logger.warn("[comfyui] Preload failed: " + resp.status);
  } catch {
    logger.warn("[comfyui] Preload failed (ComfyUI unreachable)");
  }
}

export function listWorkflows(): Array<{ id: string; name: string; description: string; inputs: string[] }> {
  return [
    { id: "txt2img", name: "Text \u2192 Image", description: "Generate image from text prompt", inputs: ["prompt"] },
    { id: "img2img", name: "Image \u2192 Image", description: "Transform image with prompt", inputs: ["image", "prompt", "strength"] },
    { id: "style", name: "Style Transfer", description: "Apply artistic style to image", inputs: ["image", "style", "prompt"] },
    { id: "faceswap", name: "Face Swap", description: "Swap faces between two images", inputs: ["source", "target"] },
    { id: "video", name: "Text \u2192 Video", description: "Generate video from text", inputs: ["prompt", "duration"] },
  ];
}
