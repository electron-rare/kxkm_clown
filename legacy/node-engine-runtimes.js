const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function summarizeText(value, maxLength = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

const ALLOWED_RUNTIME_IDS = new Set(["local_cpu", "local_gpu", "remote_gpu", "cluster", "cloud_api"]);
const ALLOWED_NODE_TYPES = new Set(["lora_training", "qlora_training"]);
const COMMAND_TIMEOUT_MS = 30 * 60 * 1000; // 30 min max per training command

async function runCommand(command, env = {}, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 5000);
    }, COMMAND_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: !killed && code === 0,
        code: killed ? null : code,
        stdout: stdout.trim(),
        stderr: killed ? "Command timed out" : stderr.trim(),
        timedOut: killed,
      });
    });
  });
}

function createNodeEngineRuntimes({
  rootDir,
  ollamaChat,
} = {}) {
  const commandMap = {
    local_gpu: {
      lora_training: process.env.NODE_ENGINE_LORA_COMMAND || "",
      qlora_training: process.env.NODE_ENGINE_QLORA_COMMAND || "",
    },
    remote_gpu: {
      lora_training: process.env.NODE_ENGINE_REMOTE_LORA_COMMAND || "",
      qlora_training: process.env.NODE_ENGINE_REMOTE_QLORA_COMMAND || "",
    },
    cluster: {
      lora_training: process.env.NODE_ENGINE_CLUSTER_LORA_COMMAND || "",
      qlora_training: process.env.NODE_ENGINE_CLUSTER_QLORA_COMMAND || "",
    },
    cloud_api: {
      lora_training: process.env.NODE_ENGINE_CLOUD_LORA_COMMAND || "",
      qlora_training: process.env.NODE_ENGINE_CLOUD_QLORA_COMMAND || "",
    },
  };

  function listRuntimes() {
    return [
      { id: "local_cpu", mode: "direct", configured: true, description: "Exécution locale CPU intégrée au serveur." },
      { id: "local_gpu", mode: "mixed", configured: true, description: "Exécution locale GPU avec adaptateurs training optionnels." },
      { id: "remote_gpu", mode: "adapter", configured: Boolean(commandMap.remote_gpu.lora_training || commandMap.remote_gpu.qlora_training), description: "GPU distant via commande/adaptateur externe." },
      { id: "cluster", mode: "adapter", configured: Boolean(commandMap.cluster.lora_training || commandMap.cluster.qlora_training), description: "Cluster via adaptateur externe." },
      { id: "cloud_api", mode: "adapter", configured: Boolean(commandMap.cloud_api.lora_training || commandMap.cloud_api.qlora_training), description: "Cloud API via adaptateur externe." },
    ];
  }

  function getRuntime(id) {
    return listRuntimes().find((runtime) => runtime.id === id) || null;
  }

  function getTrainingCommand(runtimeId, nodeType) {
    return commandMap[runtimeId]?.[nodeType] || "";
  }

  async function runTrainingAdapter({
    runtimeId,
    nodeType,
    jobSpec,
    jobDir,
  }) {
    if (!ALLOWED_RUNTIME_IDS.has(runtimeId)) {
      return { status: "error", reason: `Runtime inconnu: ${String(runtimeId).slice(0, 40)}` };
    }
    if (!ALLOWED_NODE_TYPES.has(nodeType)) {
      return { status: "error", reason: `Type de noeud non supporté: ${String(nodeType).slice(0, 40)}` };
    }
    const command = getTrainingCommand(runtimeId, nodeType);
    if (!command) {
      return {
        status: "not_configured",
        reason: `Aucun adaptateur configuré pour ${runtimeId}:${nodeType}`,
      };
    }

    const specPath = path.join(jobDir, "job-spec.json");
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(specPath, JSON.stringify(jobSpec, null, 2) + "\n");

    const result = await runCommand(command, {
      NODE_ENGINE_JOB_SPEC: specPath,
      NODE_ENGINE_JOB_DIR: jobDir,
      NODE_ENGINE_JOB_TYPE: nodeType,
      NODE_ENGINE_RUNTIME: runtimeId,
    }, rootDir);

    if (!result.ok) {
      return {
        status: "failed",
        reason: summarizeText(result.stderr || result.stdout || `Commande training en erreur (${result.code})`, 400),
        command,
      };
    }

    const resultPath = path.join(jobDir, "result.json");
    let payload = null;
    if (fs.existsSync(resultPath)) {
      try {
        payload = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      } catch {}
    }

    return {
      status: "completed",
      payload,
      command,
      stdout: summarizeText(result.stdout, 400),
    };
  }

  async function invokeModel({
    model,
    prompt,
    messages,
    runtimeId = "local_cpu",
    tokenLimit = 120,
  }) {
    if (!ollamaChat) {
      throw new Error("Ollama runtime not configured");
    }

    if (runtimeId !== "local_cpu" && runtimeId !== "local_gpu") {
      return {
        status: "not_configured",
        reason: `Le runtime ${runtimeId} n'est pas encore branché pour l'inférence locale`,
      };
    }

    const safeMessages = Array.isArray(messages) && messages.length
      ? messages
      : [{ role: "user", content: String(prompt || "Prompt test vide") }];
    const response = await ollamaChat(model, safeMessages, () => {}, null, tokenLimit);
    return {
      status: "completed",
      output: String(response || "").trim(),
    };
  }

  function summarizeRuntime(runtimeId) {
    const runtime = getRuntime(runtimeId);
    if (!runtime) {
      return {
        id: runtimeId,
        configured: false,
        mode: "unknown",
        description: "Runtime inconnu",
      };
    }
    return runtime;
  }

  function previewNode(nodeType, runtimeId = "local_cpu") {
    const runtime = summarizeRuntime(runtimeId);
    const isTraining = nodeType === "lora_training" || nodeType === "qlora_training";
    const trainingCommand = isTraining ? getTrainingCommand(runtimeId, nodeType) : "";
    return {
      runtime,
      isTraining,
      configured: isTraining ? Boolean(trainingCommand) : runtime.configured,
      commandConfigured: Boolean(trainingCommand),
      commandHint: trainingCommand ? summarizeText(trainingCommand, 200) : "",
    };
  }

  return {
    listRuntimes,
    getRuntime,
    previewNode,
    invokeModel,
    runTrainingAdapter,
  };
}

module.exports = {
  createNodeEngineRuntimes,
};
