const fs = require("fs");
const path = require("path");
const http = require("http");
const { once } = require("events");
const { spawn } = require("child_process");
const { setTimeout: delay } = require("timers/promises");
const WebSocket = require("ws");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const OVERRIDES_FILE = path.join(DATA_DIR, "personas.overrides.json");
const PERSONA_SOURCES_DIR = path.join(DATA_DIR, "persona-sources");
const PERSONA_FEEDBACK_DIR = path.join(DATA_DIR, "persona-feedback");
const PERSONA_PROPOSALS_DIR = path.join(DATA_DIR, "persona-proposals");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const UPLOADS_META_DIR = path.join(DATA_DIR, "uploads-meta");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const TRAINING_FILE = path.join(DATA_DIR, "training", "conversations.jsonl");
const DPO_FILE = path.join(DATA_DIR, "dpo", "pairs.jsonl");
const NODE_ENGINE_DIR = path.join(DATA_DIR, "node-engine");
const ADMIN_TOKEN = "smoke-admin-token";

const FAKE_MODELS = [
  { name: "qwen2.5:14b", details: { parameter_size: "14B", family: "qwen2.5" } },
  { name: "mistral:7b", details: { parameter_size: "7B", family: "mistral" } },
  { name: "mythalion:latest", details: { parameter_size: "13B", family: "mythalion" } },
  { name: "nollama/mythomax-l2-13b:Q4_K_M", details: { parameter_size: "13B", family: "mythomax" } },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readFileSnapshot(file) {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function restoreFileSnapshot(file, snapshot) {
  if (snapshot === null) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(file, snapshot);
}

function readDirEntries(dir) {
  return fs.existsSync(dir) ? new Set(fs.readdirSync(dir)) : new Set();
}

function snapshotDirFiles(dir) {
  const snapshot = new Map();
  if (!fs.existsSync(dir)) return snapshot;

  for (const entry of fs.readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (fs.statSync(file).isFile()) {
      snapshot.set(entry, fs.readFileSync(file));
    }
  }
  return snapshot;
}

function restoreDirFiles(dir, snapshot) {
  fs.mkdirSync(dir, { recursive: true });

  for (const entry of fs.readdirSync(dir)) {
    if (!snapshot.has(entry)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }

  for (const [entry, content] of snapshot.entries()) {
    fs.writeFileSync(path.join(dir, entry), content);
  }
}

function snapshotDirTree(dir, baseDir = dir, snapshot = new Map()) {
  if (!fs.existsSync(dir)) return snapshot;

  for (const entry of fs.readdirSync(dir)) {
    const file = path.join(dir, entry);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      snapshotDirTree(file, baseDir, snapshot);
      continue;
    }
    snapshot.set(path.relative(baseDir, file), fs.readFileSync(file));
  }

  return snapshot;
}

function restoreDirTree(dir, snapshot) {
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }

  for (const [relativePath, content] of snapshot.entries()) {
    const target = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function removeNewDirEntries(dir, beforeEntries) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (!beforeEntries.has(entry)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }
}

async function getFreePort() {
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function startFakeOllamaServer(port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: FAKE_MODELS }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({
          message: { content: "smoke" },
          done: false,
        }) + "\n");
        res.end(JSON.stringify({
          done: true,
          total_duration: 1000000,
          eval_count: 1,
          eval_duration: 1000000,
        }) + "\n");
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return server;
}

async function stopServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

async function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(150);
  }

  throw new Error(`Timeout en attente de ${url}`);
}

function createMessageCollector(ws) {
  const queue = [];
  const waiters = [];

  ws.on("message", (raw) => {
    try {
      queue.push(JSON.parse(String(raw)));
      flush();
    } catch {}
  });

  function flush() {
    for (let index = 0; index < waiters.length; index++) {
      if (waiters[index]()) {
        waiters.splice(index, 1);
        index--;
      }
    }
  }

  function waitFor(predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const tryMatch = () => {
        const messageIndex = queue.findIndex(predicate);
        if (messageIndex >= 0) {
          const [message] = queue.splice(messageIndex, 1);
          clearTimeout(timeoutId);
          resolve(message);
          return true;
        }
        return false;
      };

      const timeoutId = setTimeout(() => {
        const sample = queue.slice(-8);
        reject(new Error(`Timeout WebSocket. Derniers messages: ${JSON.stringify(sample)}`));
      }, timeoutMs);

      if (!tryMatch()) waiters.push(tryMatch);
    });
  }

  return { waitFor };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGINT");

  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    delay(5000).then(() => false),
  ]);

  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function main() {
  const usersSnapshot = readFileSnapshot(USERS_FILE);
  const overridesSnapshot = readFileSnapshot(OVERRIDES_FILE);
  const sessionEntriesBefore = readDirEntries(SESSIONS_DIR);
  const personaSourcesSnapshot = snapshotDirFiles(PERSONA_SOURCES_DIR);
  const personaFeedbackSnapshot = snapshotDirFiles(PERSONA_FEEDBACK_DIR);
  const personaProposalsSnapshot = snapshotDirFiles(PERSONA_PROPOSALS_DIR);
  const uploadsSnapshot = snapshotDirTree(UPLOADS_DIR);
  const uploadsMetaSnapshot = snapshotDirTree(UPLOADS_META_DIR);
  const logsSnapshot = snapshotDirFiles(LOGS_DIR);
  const trainingSnapshot = readFileSnapshot(TRAINING_FILE);
  const dpoSnapshot = readFileSnapshot(DPO_FILE);
  const nodeEngineSnapshot = snapshotDirTree(NODE_ENGINE_DIR);

  let fakeOllama = null;
  let appProcess = null;
  let ws = null;
  let appStdout = "";
  let appStderr = "";

  try {
    const fakeOllamaPort = await getFreePort();
    const appPort = await getFreePort();
    const fakeOllamaUrl = `http://127.0.0.1:${fakeOllamaPort}`;
    const appUrl = `http://127.0.0.1:${appPort}`;
    const restoreSnapshotId = "smoke_restore_snapshot";
    const staleSessionId = "smoke_stale_snapshot";
    const staleLogName = "smoke_stale.log";
    const staleAge = new Date(Date.now() - (35 * 24 * 60 * 60 * 1000));

    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(TRAINING_FILE), { recursive: true });
    fs.mkdirSync(path.dirname(DPO_FILE), { recursive: true });

    const restoreSnapshotPath = path.join(SESSIONS_DIR, `${restoreSnapshotId}.json`);
    fs.writeFileSync(restoreSnapshotPath, JSON.stringify({
      model: "mistral:7b",
      persona: "batty",
      created: Date.now(),
      messages: [
        { role: "user", content: "snapshot smoke user" },
        { role: "assistant", content: "snapshot smoke assistant" },
      ],
    }, null, 2));

    const staleSessionPath = path.join(SESSIONS_DIR, `${staleSessionId}.json`);
    fs.writeFileSync(staleSessionPath, JSON.stringify({
      model: "qwen2.5:14b",
      persona: "schaeffer",
      created: Date.now() - (35 * 24 * 60 * 60 * 1000),
      messages: [{ role: "user", content: "stale snapshot" }],
    }, null, 2));

    const staleLogPath = path.join(LOGS_DIR, staleLogName);
    fs.writeFileSync(staleLogPath, "[2024-01-01T00:00:00.000Z] <smoke> stale log\n");

    fs.utimesSync(staleSessionPath, staleAge, staleAge);
    fs.utimesSync(staleLogPath, staleAge, staleAge);

    fs.appendFileSync(TRAINING_FILE, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      channel: "#admin",
      nick: "smoke",
      model: "mistral:7b",
      messages: [
        { role: "user", content: "training smoke prompt" },
        { role: "assistant", content: "training smoke answer" },
      ],
    })}\n`);

    fs.appendFileSync(DPO_FILE, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      nick: "smoke",
      prompt: "dpo smoke prompt",
      chosen: { model: "mistral:7b", content: "dpo smoke chosen" },
      rejected: { model: "qwen2.5:14b", content: "dpo smoke rejected" },
    })}\n`);

    async function startAppProcess(envOverrides = {}) {
      appStdout = "";
      appStderr = "";

      appProcess = spawn(process.execPath, ["server.js"], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          PORT: String(appPort),
          HOST: "0.0.0.0",
          OLLAMA_URL: fakeOllamaUrl,
          ADMIN_BOOTSTRAP_TOKEN: ADMIN_TOKEN,
          ...envOverrides,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      appProcess.stdout.on("data", (chunk) => {
        appStdout += chunk.toString();
      });
      appProcess.stderr.on("data", (chunk) => {
        appStderr += chunk.toString();
      });

      await waitForHttp(`${appUrl}/api/status`);
    }

    fakeOllama = await startFakeOllamaServer(fakeOllamaPort);
    await startAppProcess();

    const status = await fetchJson(`${appUrl}/api/status`);
    assert(status.ok, "Le status HTTP doit répondre");
    assert(status.body.models === 4, `Models attendus: 4, reçu: ${status.body.models}`);
    assert(status.body.personas === 15, `Personas actives attendues: 15, reçu: ${status.body.personas}`);
    assert(status.body.accessMode === "lan_controlled", `Le status doit exposer un mode LAN contrôlé, reçu: ${status.body.accessMode}`);
    assert(status.body.host === "0.0.0.0", `Le host attendu est 0.0.0.0, reçu: ${status.body.host}`);

    const adminShell = await fetchText(`${appUrl}/admin/index.html`);
    assert(adminShell.ok, "La page /admin/index.html doit rester lisible sur le LAN");
    assert(adminShell.body.includes("admin-shell"), "Le shell admin doit être servi comme page statique");

    const publicPersonas = await fetchJson(`${appUrl}/api/personas`);
    assert(publicPersonas.ok, "Le endpoint public /api/personas doit répondre");
    const initialPublicPersonaCount = publicPersonas.body.length;
    assert(initialPublicPersonaCount >= 16, `Le registre public doit exposer au moins 16 personas, reçu: ${initialPublicPersonaCount}`);
    const publicPharmacius = publicPersonas.body.find((persona) => persona.id === "pharmacius");
    assert(publicPharmacius, "Pharmacius doit être présent dans /api/personas");
    assert(publicPharmacius.generalEnabled === false, "Pharmacius doit rester hors #general");

    const channels = await fetchJson(`${appUrl}/api/channels`);
    assert(channels.ok, "Le endpoint /api/channels doit répondre");
    assert(channels.body.some((channel) => channel.name === "#admin" && channel.type === "admin"), "#admin doit être exposé");
    assert(channels.body.some((channel) => channel.name === "#qwen25" && channel.type === "dedicated"), "#qwen25 doit être exposé");

    const forbiddenAdmin = await fetchJson(`${appUrl}/api/admin/personas`);
    assert(forbiddenAdmin.status === 403, `Sans token, l'admin doit répondre 403, reçu: ${forbiddenAdmin.status}`);

    const invalidAdmin = await fetchJson(`${appUrl}/api/admin/personas`, {
      headers: { "x-admin-bootstrap-token": "bad-token" },
    });
    assert(invalidAdmin.status === 403, `Avec un mauvais token, l'admin doit répondre 403, reçu: ${invalidAdmin.status}`);

    const adminHeaders = { "x-admin-bootstrap-token": ADMIN_TOKEN };
    const adminPersonas = await fetchJson(`${appUrl}/api/admin/personas`, { headers: adminHeaders });
    assert(adminPersonas.ok, "Le endpoint admin /api/admin/personas doit répondre avec le bon token");

    const adminPharmacius = adminPersonas.body.find((persona) => persona.id === "pharmacius");
    assert(adminPharmacius, "Pharmacius doit être présent dans le registre admin");

    const runtimeStatus = await fetchJson(`${appUrl}/api/admin/runtime`, { headers: adminHeaders });
    assert(runtimeStatus.ok, "Le endpoint admin /api/admin/runtime doit répondre");
    assert(Array.isArray(runtimeStatus.body.channels), "Le runtime admin doit exposer les canaux");
    assert(runtimeStatus.body.network?.host === "0.0.0.0", `Le runtime admin doit exposer le host réseau, reçu: ${runtimeStatus.body.network?.host}`);
    assert(runtimeStatus.body.network?.adminPagesPublic === true, "Le runtime admin doit confirmer que les pages admin restent lisibles");
    assert(Array.isArray(runtimeStatus.body.network?.adminAllowedSubnets), "Le runtime admin doit exposer les subnets admin autorisés");
    assert(runtimeStatus.body.sessions === 0, `Aucune session runtime ne doit être restaurée au boot, reçu: ${runtimeStatus.body.sessions}`);
    assert(
      runtimeStatus.body.savedSessions.some((entry) => entry.id === restoreSnapshotId),
      "Le snapshot frais doit rester listé sans être restauré au démarrage"
    );
    assert(
      !runtimeStatus.body.savedSessions.some((entry) => entry.id === staleSessionId),
      "Le snapshot expiré doit être purgé au démarrage"
    );
    assert(!fs.existsSync(staleSessionPath), "Le snapshot expiré doit être supprimé du disque");
    assert(!fs.existsSync(staleLogPath), "Le log expiré doit être supprimé du disque");

    const nodeEngineOverview = await fetchJson(`${appUrl}/api/admin/node-engine/overview`, { headers: adminHeaders });
    assert(nodeEngineOverview.ok, "Le endpoint admin /api/admin/node-engine/overview doit répondre");
    assert(Array.isArray(nodeEngineOverview.body.families) && nodeEngineOverview.body.families.length >= 6, "Le Node Engine doit exposer ses familles de nodes");
    assert(Array.isArray(nodeEngineOverview.body.graphs) && nodeEngineOverview.body.graphs.length >= 1, "Le Node Engine doit exposer au moins un graphe");
    assert(Array.isArray(nodeEngineOverview.body.nodeTypes) && nodeEngineOverview.body.nodeTypes.length >= 10, "Le Node Engine doit exposer sa palette initiale de nodes");

    const nodeEngineGraphs = await fetchJson(`${appUrl}/api/admin/node-engine/graphs`, { headers: adminHeaders });
    assert(nodeEngineGraphs.ok, "Le endpoint admin /api/admin/node-engine/graphs doit répondre");
    assert(nodeEngineGraphs.body.some((graph) => graph.id === "starter_llm_training"), "Le graphe seed starter_llm_training doit être présent");

    const nodeEngineRun = await fetchJson(`${appUrl}/api/admin/node-engine/graphs/starter_llm_training/run`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ actor: "smoke" }),
    });
    assert(nodeEngineRun.status === 201, `Le POST run node-engine doit répondre 201, reçu: ${nodeEngineRun.status}`);
    assert(nodeEngineRun.body.run.status === "completed", `Le run Node Engine V1 doit être simulé en completed, reçu: ${nodeEngineRun.body.run.status}`);
    assert(nodeEngineRun.body.run.stepCount >= 6, `Le run Node Engine doit exposer ses étapes, reçu: ${nodeEngineRun.body.run.stepCount}`);

    const nodeEngineRuns = await fetchJson(`${appUrl}/api/admin/node-engine/runs`, { headers: adminHeaders });
    assert(nodeEngineRuns.ok, "Le endpoint admin /api/admin/node-engine/runs doit répondre");
    assert(nodeEngineRuns.body.some((run) => run.id === nodeEngineRun.body.run.id), "Le run Node Engine doit être relisible après exécution");

    const adminChannels = await fetchJson(`${appUrl}/api/admin/channels`, { headers: adminHeaders });
    assert(adminChannels.ok, "Le endpoint admin /api/admin/channels doit répondre");
    assert(adminChannels.body.some((channel) => channel.name === "#admin"), "Le registre admin des canaux doit contenir #admin");

    const trainingExport = await fetchJson(`${appUrl}/api/training/export`, { headers: adminHeaders });
    assert(trainingExport.ok, "L'export training doit être accessible avec le token admin");

    const dpoExport = await fetchJson(`${appUrl}/api/dpo/export`, { headers: adminHeaders });
    assert(dpoExport.ok, "L'export DPO doit être accessible avec le token admin");

    const customSourcePayload = {
      id: "deleuze_smoke",
      name: "DeleuzeSmoke",
      model: "mistral:7b",
      query: "Gilles Deleuze bibliography interviews concepts",
      tone: "conceptuel, vif, toujours concret",
      themes: ["différence", "devenir", "rhizome"],
      lexicon: ["agencement", "ligne de fuite"],
      facts: ["philosophe français", "travaille les concepts comme outils"],
      quotes: ["Créer, c'est résister."],
      notes: "persona smoke issue d'un dossier source local",
      sources: [
        {
          title: "Deleuze smoke dossier",
          url: "https://example.invalid/deleuze",
          notes: "fixture locale",
        },
      ],
    };
    const createdPersona = await fetchJson(`${appUrl}/api/admin/personas/from-source`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(customSourcePayload),
    });
    assert(createdPersona.status === 201, `La création de persona sourcée doit répondre 201, reçu: ${createdPersona.status}`);
    assert(createdPersona.body.persona.id === "deleuze_smoke", `L'id persona custom attendu est deleuze_smoke, reçu: ${createdPersona.body.persona.id}`);
    assert(createdPersona.body.persona.model === "mistral:7b", `Le modèle custom attendu est mistral:7b, reçu: ${createdPersona.body.persona.model}`);

    const publicPersonasAfterCreate = await fetchJson(`${appUrl}/api/personas`);
    assert(publicPersonasAfterCreate.ok, "Le registre public doit rester disponible après création custom");
    assert(
      publicPersonasAfterCreate.body.length === initialPublicPersonaCount + 1,
      `Le registre public doit gagner une persona après création custom, reçu: ${publicPersonasAfterCreate.body.length} au lieu de ${initialPublicPersonaCount + 1}`
    );
    assert(publicPersonasAfterCreate.body.some((persona) => persona.id === "deleuze_smoke"), "La persona custom doit apparaître dans /api/personas");

    const disabledBatty = await fetchJson(`${appUrl}/api/admin/personas/batty/disable`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert(disabledBatty.ok, "La désactivation runtime d'une persona doit réussir");

    const adminPersonasAfterDisable = await fetchJson(`${appUrl}/api/admin/personas`, { headers: adminHeaders });
    assert(adminPersonasAfterDisable.body.find((persona) => persona.id === "batty")?.disabled === true, "Batty doit apparaître comme désactivée côté admin");

    const enabledBatty = await fetchJson(`${appUrl}/api/admin/personas/batty/enable`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert(enabledBatty.ok, "La réactivation runtime d'une persona doit réussir");

    const updatedTopic = await fetchJson(`${appUrl}/api/admin/channels/general/topic`, {
      method: "PUT",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "Smoke topic admin global",
        updatedBy: "smoke",
      }),
    });
    assert(updatedTopic.ok, "Le topic admin doit être éditable");

    const searchedHistory = await fetchJson(`${appUrl}/api/admin/history/search?q=Blade%20Runner&limit=5`, {
      headers: adminHeaders,
    });
    assert(searchedHistory.ok, "La recherche historique admin doit répondre");

    const logsSummary = await fetchJson(`${appUrl}/api/admin/logs/summary`, {
      headers: adminHeaders,
    });
    assert(logsSummary.ok, "Le résumé logs admin doit répondre");

    const customSourceAfterCreate = await fetchJson(`${appUrl}/api/admin/personas/deleuze_smoke/source`, {
      headers: adminHeaders,
    });
    assert(customSourceAfterCreate.ok, "Le GET source de la persona custom doit répondre");
    assert(customSourceAfterCreate.body.preferredName === "DeleuzeSmoke", `Le preferredName custom attendu est DeleuzeSmoke, reçu: ${customSourceAfterCreate.body.preferredName}`);

    const marker = `[smoke:${Date.now()}]`;
    const updatedStyle = `${adminPharmacius.style}\n${marker}`;
    const updatedPersona = await fetchJson(`${appUrl}/api/admin/personas/pharmacius`, {
      method: "PUT",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: adminPharmacius.name,
        model: adminPharmacius.model,
        style: updatedStyle,
      }),
    });
    assert(updatedPersona.ok, "Le PUT admin Pharmacius doit réussir");

    const adminPersonasAfterPut = await fetchJson(`${appUrl}/api/admin/personas`, { headers: adminHeaders });
    const updatedPharmacius = adminPersonasAfterPut.body.find((persona) => persona.id === "pharmacius");
    assert(updatedPharmacius.style.includes(marker), "Le PUT admin doit persister la personnalité mise à jour");

    const sourceBefore = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/source`, {
      headers: adminHeaders,
    });
    assert(sourceBefore.ok, "Le GET source persona doit répondre");
    assert(sourceBefore.body.id === "pharmacius", "La source Pharmacius doit être identifiée");

    const sourcePayload = {
      subjectName: "Pharmacius",
      query: "persona smoke pharmacius",
      preferredName: "PharmaciusSmoke",
      preferredModel: "mistral:7b",
      tone: "orchestrateur synthétique, précis et concret",
      facts: ["coordonne les autres personas", "ne touche jamais au code source des personas"],
      themes: ["édition", "orchestration", "traçabilité"],
      lexicon: ["cohérence", "signal", "override"],
      quotes: ["ajuste sans effacer la trace"],
      notes: "source smoke",
      sources: [
        {
          url: "https://example.invalid/pharmacius",
          title: "Pharmacius smoke dossier",
          notes: "fixture locale",
        },
      ],
    };
    const updatedSource = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/source`, {
      method: "PUT",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(sourcePayload),
    });
    assert(updatedSource.ok, "Le PUT source persona doit réussir");
    assert(updatedSource.body.source.preferredName === "PharmaciusSmoke", "Le preferredName doit être persisté");
    assert(updatedSource.body.source.preferredModel === "mistral:7b", "Le preferredModel doit être persisté");

    const feedbackAfterManualEdit = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/feedback`, {
      headers: adminHeaders,
    });
    assert(feedbackAfterManualEdit.ok, "Le GET feedback persona doit répondre");
    assert(feedbackAfterManualEdit.body.some((entry) => entry.kind === "admin_edit"), "Le feedback admin_edit doit être journalisé après PUT persona");

    const manualFeedbackResult = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/feedback`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "drift_report",
        actor: "admin",
        channel: "#admin",
        note: "réduire les formules trop sentencieuses",
      }),
    });
    assert(manualFeedbackResult.status === 201, `Le POST feedback persona doit répondre 201, reçu: ${manualFeedbackResult.status}`);

    const proposalsAfterManualEdit = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/proposals`, {
      headers: adminHeaders,
    });
    assert(proposalsAfterManualEdit.ok, "Le GET proposals persona doit répondre");
    assert(proposalsAfterManualEdit.body.some((entry) => entry.mode === "manual_edit"), "La proposal manual_edit doit être journalisée après PUT persona");

    const reinforceResult = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/reinforce`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ autoApply: true }),
    });
    assert(reinforceResult.ok, "Le POST reinforce doit réussir");
    assert(reinforceResult.body.proposal.mode === "auto_applied", `Le reinforce doit auto-appliquer une proposal, reçu: ${reinforceResult.body.proposal.mode}`);
    assert(reinforceResult.body.persona.name === "PharmaciusSmoke", `Le reinforce doit reprendre le preferredName source, reçu: ${reinforceResult.body.persona.name}`);
    assert(reinforceResult.body.persona.model === "mistral:7b", `Le reinforce doit reprendre le preferredModel source, reçu: ${reinforceResult.body.persona.model}`);
    assert(reinforceResult.body.persona.style.includes("source smoke"), "Le reinforce doit intégrer les notes source dans la personnalité");
    assert(reinforceResult.body.proposal.metadata?.trainingSignals >= 1, "Le reinforce doit exposer au moins un signal training borné");
    assert(reinforceResult.body.proposal.metadata?.dpoSignals >= 1, "Le reinforce doit exposer au moins un signal DPO borné");
    assert(
      Array.isArray(reinforceResult.body.proposal.metadata?.relevantModels)
      && reinforceResult.body.proposal.metadata.relevantModels.includes("mistral:7b"),
      "Le reinforce doit exposer les modèles pertinents dans la proposal"
    );

    const proposalsAfterReinforce = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/proposals`, {
      headers: adminHeaders,
    });
    assert(proposalsAfterReinforce.body.some((entry) => entry.mode === "auto_applied"), "Une proposal auto_applied doit être visible après reinforce");

    const feedbackAfterReinforce = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/feedback`, {
      headers: adminHeaders,
    });
    assert(feedbackAfterReinforce.body.some((entry) => entry.kind === "auto_apply"), "Le reinforce doit journaliser un feedback auto_apply");
    assert(feedbackAfterReinforce.body.some((entry) => entry.kind === "drift_report"), "Le feedback manuel doit rester visible après reinforce");

    const revertResult = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/revert`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert(revertResult.ok, "Le POST revert doit réussir");
    assert(revertResult.body.persona.name === updatedPharmacius.name, `Le revert doit restaurer le nom pré-reinforce, reçu: ${revertResult.body.persona.name}`);
    assert(revertResult.body.persona.model === updatedPharmacius.model, `Le revert doit restaurer le modèle pré-reinforce, reçu: ${revertResult.body.persona.model}`);
    assert(revertResult.body.persona.style.includes(marker), "Le revert doit restaurer la personnalité pré-reinforce");

    await stopChild(appProcess);
    appProcess = null;
    await startAppProcess();

    const sourceAfterRestart = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/source`, {
      headers: adminHeaders,
    });
    assert(sourceAfterRestart.ok, "Le GET source après redémarrage doit répondre");
    assert(sourceAfterRestart.body.preferredName === "PharmaciusSmoke", "La source persona doit survivre au redémarrage");

    const proposalsAfterRestart = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/proposals`, {
      headers: adminHeaders,
    });
    assert(proposalsAfterRestart.ok, "Le GET proposals après redémarrage doit répondre");
    assert(proposalsAfterRestart.body.length >= proposalsAfterReinforce.body.length, "Les proposals doivent survivre au redémarrage");

    const feedbackAfterRestart = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/feedback`, {
      headers: adminHeaders,
    });
    assert(feedbackAfterRestart.ok, "Le GET feedback après redémarrage doit répondre");
    assert(feedbackAfterRestart.body.length >= feedbackAfterReinforce.body.length, "Le feedback doit survivre au redémarrage");

    const customSourceAfterRestart = await fetchJson(`${appUrl}/api/admin/personas/deleuze_smoke/source`, {
      headers: adminHeaders,
    });
    assert(customSourceAfterRestart.ok, "La source de la persona custom doit survivre au redémarrage");
    assert(customSourceAfterRestart.body.subjectName === "DeleuzeSmoke", `Le sujet source custom attendu est DeleuzeSmoke, reçu: ${customSourceAfterRestart.body.subjectName}`);

    const adminPersonasAfterRestart = await fetchJson(`${appUrl}/api/admin/personas`, { headers: adminHeaders });
    const pharmaciusAfterRestart = adminPersonasAfterRestart.body.find((persona) => persona.id === "pharmacius");
    assert(pharmaciusAfterRestart.name === updatedPharmacius.name, "Le revert doit rester effectif après redémarrage");
    assert(pharmaciusAfterRestart.model === updatedPharmacius.model, "Le modèle reverté doit rester effectif après redémarrage");
    assert(adminPersonasAfterRestart.body.some((persona) => persona.id === "deleuze_smoke"), "La persona custom doit rester visible après redémarrage");

    ws = new WebSocket(`ws://127.0.0.1:${appPort}`);
    const collector = createMessageCollector(ws);
    await once(ws, "open");

    await collector.waitFor((message) => message.type === "channel_info" && message.channel === "#general");

    ws.send(JSON.stringify({ type: "command", text: "/join #admin" }));
    await collector.waitFor((message) => message.type === "channel_info" && message.channel === "#admin" && message.channelType === "admin");

    ws.send(JSON.stringify({ type: "command", text: `/sessions restore ${restoreSnapshotId}` }));
    const restoredInfo = await collector.waitFor(
      (message) => message.type === "channel_info" && message.channel === "#admin" && message.model === "mistral:7b" && message.personaId === "batty"
    );
    const restoredNotice = await collector.waitFor(
      (message) => message.type === "system" && String(message.text || "").includes(`Snapshot restauré: ${restoreSnapshotId}`)
    );
    assert(restoredInfo.persona === "Batty", `Le restore manuel doit rétablir Batty, reçu: ${restoredInfo.persona}`);
    assert(
      String(restoredNotice.text || "").includes("messages=2"),
      `Le restore manuel doit annoncer le nombre de messages restaurés, reçu: ${restoredNotice.text}`
    );

    ws.send(JSON.stringify({ type: "command", text: "/model qwen2.5:14b" }));
    const adminModelInfo = await collector.waitFor(
      (message) => message.type === "channel_info" && message.channel === "#admin" && message.model === "qwen2.5:14b"
    );
    assert(adminModelInfo.personaId === "schaeffer", `Le fallback modèle sur #admin doit pointer sur Schaeffer, reçu: ${adminModelInfo.personaId}`);

    ws.send(JSON.stringify({ type: "command", text: "/model mistral:7b" }));
    const mistralModelInfo = await collector.waitFor(
      (message) => message.type === "channel_info" && message.channel === "#admin" && message.model === "mistral:7b"
    );
    assert(mistralModelInfo.personaId === "batty", `Le fallback mistral sur #admin doit pointer sur Batty, reçu: ${mistralModelInfo.personaId}`);

    ws.send(JSON.stringify({ type: "command", text: "/persona deleuze_smoke" }));
    const customPersonaInfo = await collector.waitFor(
      (message) => message.type === "channel_info" && message.channel === "#admin" && message.personaId === "deleuze_smoke"
    );
    assert(customPersonaInfo.persona === "DeleuzeSmoke", `La persona custom admin attendue est DeleuzeSmoke, reçu: ${customPersonaInfo.persona}`);

    ws.send(JSON.stringify({ type: "command", text: "/model qwen2.5:14b" }));
    await collector.waitFor(
      (message) => message.type === "channel_info" && message.channel === "#admin" && message.model === "qwen2.5:14b"
    );

    ws.send(JSON.stringify({ type: "command", text: "/persona pharmacius" }));
    const adminPersonaInfo = await collector.waitFor(
      (message) => message.type === "channel_info" && message.channel === "#admin" && message.personaId === "pharmacius"
    );
    assert(adminPersonaInfo.persona === "Pharmacius", `La persona admin explicite attendue est Pharmacius, reçu: ${adminPersonaInfo.persona}`);

    const adminUploadCapability = await collector.waitFor(
      (message) => message.type === "upload_capability" && message.channel === "#admin"
    );
    assert(adminUploadCapability.sessionId, "La capacité d'upload doit exposer un sessionId");
    assert(adminUploadCapability.uploadToken, "La capacité d'upload doit exposer un uploadToken");
    assert(Array.isArray(adminUploadCapability.acceptedKinds) && adminUploadCapability.acceptedKinds.includes("image"), "La capacité d'upload doit exposer les types supportés");

    const deniedUpload = await fetchJson(`${appUrl}/api/chat/attachments`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-chat-session-id": adminUploadCapability.sessionId,
        "x-chat-upload-token": "bad-upload-token",
        "x-file-name": encodeURIComponent("denied.txt"),
        "x-file-mime": "text/plain",
      },
      body: "denied upload",
    });
    assert(deniedUpload.status === 403, `Un upload avec mauvais token doit être refusé, reçu: ${deniedUpload.status}`);

    const textUpload = await fetchJson(`${appUrl}/api/chat/attachments`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-chat-session-id": adminUploadCapability.sessionId,
        "x-chat-upload-token": adminUploadCapability.uploadToken,
        "x-file-name": encodeURIComponent("brief-smoke.txt"),
        "x-file-mime": "text/plain",
      },
      body: "Corps de texte smoke.\nLes personas doivent analyser ce fichier local.",
    });
    assert(textUpload.status === 201, `L'upload texte doit répondre 201, reçu: ${textUpload.status}`);

    const wsTextUpload = await collector.waitFor(
      (message) => message.type === "attachment_uploaded" && message.attachment?.id === textUpload.body.attachment.id
    );
    assert(wsTextUpload.attachment.originalName === "brief-smoke.txt", "Le WS doit relayer la pièce jointe texte");

    const wsTextAnalysis = await collector.waitFor(
      (message) => message.type === "attachment_analysis" && message.attachment?.id === textUpload.body.attachment.id
    );
    assert(wsTextAnalysis.attachment.analysis?.kind === "text", `L'analyse texte attendue doit rester de type text, reçu: ${wsTextAnalysis.attachment.analysis?.kind}`);
    assert(wsTextAnalysis.summary, "L'analyse texte doit exposer un résumé Pharmacius");

    const textAttachmentMeta = await fetchJson(`${appUrl}/api/chat/attachments/${encodeURIComponent(textUpload.body.attachment.id)}`);
    assert(textAttachmentMeta.ok, "Le GET metadata d'une pièce jointe texte doit répondre");
    assert(textAttachmentMeta.body.analysis?.extractedText?.includes("Corps de texte smoke"), "Les métadonnées doivent conserver le texte extrait");

    const textAttachmentBlob = await fetchText(`${appUrl}/api/chat/attachments/${encodeURIComponent(textUpload.body.attachment.id)}/blob`);
    assert(textAttachmentBlob.ok, "Le GET blob d'une pièce jointe texte doit répondre");
    assert(textAttachmentBlob.body.includes("Corps de texte smoke"), "Le blob texte doit restituer le contenu uploadé");

    await collector.waitFor(
      (message) => message.type === "stream_end" && message.nick === "Pharmacius"
    );

    const imageUpload = await fetchJson(`${appUrl}/api/chat/attachments`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-chat-session-id": adminUploadCapability.sessionId,
        "x-chat-upload-token": adminUploadCapability.uploadToken,
        "x-file-name": encodeURIComponent("smoke.png"),
        "x-file-mime": "image/png",
      },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    assert(imageUpload.status === 201, `L'upload image doit répondre 201, reçu: ${imageUpload.status}`);

    await collector.waitFor(
      (message) => message.type === "attachment_uploaded" && message.attachment?.id === imageUpload.body.attachment.id
    );
    const wsImageAnalysis = await collector.waitFor(
      (message) => message.type === "attachment_analysis" && message.attachment?.id === imageUpload.body.attachment.id
    );
    assert(wsImageAnalysis.attachment.analysis?.kind === "image", `L'analyse image attendue doit rester de type image, reçu: ${wsImageAnalysis.attachment.analysis?.kind}`);
    assert(
      wsImageAnalysis.warnings?.includes("Aucun adaptateur vision configuré."),
      "Le fallback image doit signaler l'absence d'adaptateur vision"
    );

    await collector.waitFor(
      (message) => message.type === "stream_end" && message.nick === "Pharmacius"
    );

    ws.send(JSON.stringify({ type: "message", text: "recadre la cohérence de la troupe et réponds en une image nette" }));
    await collector.waitFor(
      (message) => message.type === "stream_end" && message.nick === "Pharmacius"
    );

    const feedbackAfterChat = await fetchJson(`${appUrl}/api/admin/personas/pharmacius/feedback`, {
      headers: adminHeaders,
    });
    assert(feedbackAfterChat.ok, "Le GET feedback après interaction chat doit répondre");
    assert(
      feedbackAfterChat.body.some((entry) => entry.kind === "chat_signal"),
      "Le feedback Pharmacius doit contenir un chat_signal après interaction WebSocket"
    );

    ws.send(JSON.stringify({ type: "command", text: "/join #qwen25" }));
    const dedicatedInfo = await collector.waitFor(
      (message) => message.type === "channel_info" && message.channel === "#qwen25" && message.channelType === "dedicated"
    );
    assert(dedicatedInfo.personaId === "schaeffer", `Le canal dédié qwen doit retomber sur Schaeffer, reçu: ${dedicatedInfo.personaId}`);

    ws.close();
    ws = null;

    await stopChild(appProcess);
    appProcess = null;
    await startAppProcess({ ADMIN_ALLOWED_SUBNETS: "10.123.0.0/16" });

    const adminShellRestricted = await fetchText(`${appUrl}/admin/index.html`);
    assert(adminShellRestricted.ok, "La page admin doit rester lisible même hors allowlist admin");

    const deniedAdminRuntime = await fetchJson(`${appUrl}/api/admin/runtime`, { headers: adminHeaders });
    assert(deniedAdminRuntime.status === 403, `L'API admin doit refuser hors allowlist réseau, reçu: ${deniedAdminRuntime.status}`);
    assert(
      deniedAdminRuntime.body?.error === "admin network not allowed",
      `Le refus admin attendu est "admin network not allowed", reçu: ${deniedAdminRuntime.body?.error}`
    );

    ws = new WebSocket(`ws://127.0.0.1:${appPort}`);
    const restrictedCollector = createMessageCollector(ws);
    await once(ws, "open");
    await restrictedCollector.waitFor((message) => message.type === "channel_info" && message.channel === "#general");
    ws.send(JSON.stringify({ type: "command", text: `/saisail ${ADMIN_TOKEN}` }));
    const refusedBootstrap = await restrictedCollector.waitFor(
      (message) => message.type === "system" && String(message.text || "").includes("Bootstrap admin refuse depuis ce reseau")
    );
    assert(refusedBootstrap.text.includes("refuse"), "Le bootstrap admin doit être refusé hors allowlist réseau");

    ws.close();
    ws = null;

    console.log(JSON.stringify({
      ok: true,
      appUrl,
      fakeOllamaUrl,
      status: {
        models: status.body.models,
        activePersonas: status.body.personas,
      },
      publicPersonaCount: publicPersonasAfterCreate.body.length,
      adminPersonaCount: adminPersonasAfterRestart.body.length,
      personaPipeline: {
        sourcePreferredName: sourceAfterRestart.body.preferredName,
        proposals: proposalsAfterRestart.body.length,
        feedback: feedbackAfterChat.body.length,
        revertedName: pharmaciusAfterRestart.name,
        revertedModel: pharmaciusAfterRestart.model,
        customPersonaId: createdPersona.body.persona.id,
        trainingSignals: reinforceResult.body.proposal.metadata?.trainingSignals || 0,
        dpoSignals: reinforceResult.body.proposal.metadata?.dpoSignals || 0,
      },
      websocketChecks: {
        restoredPersonaId: restoredInfo.personaId,
        adminModelPersonaId: adminModelInfo.personaId,
        adminCustomPersonaId: customPersonaInfo.personaId,
        adminExplicitPersonaId: adminPersonaInfo.personaId,
        dedicatedPersonaId: dedicatedInfo.personaId,
      },
      network: {
        host: status.body.host,
        accessMode: status.body.accessMode,
        adminAllowedSubnets: runtimeStatus.body.network?.adminAllowedSubnets?.length || 0,
      },
    }));
  } catch (error) {
    console.error(`[smoke] ${error.message}`);
    if (appStdout.trim()) console.error(`[smoke] server stdout\n${appStdout.trim()}`);
    if (appStderr.trim()) console.error(`[smoke] server stderr\n${appStderr.trim()}`);
    process.exitCode = 1;
  } finally {
    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close();
    }
    await stopChild(appProcess);
    await stopServer(fakeOllama);
    restoreFileSnapshot(USERS_FILE, usersSnapshot);
    restoreFileSnapshot(OVERRIDES_FILE, overridesSnapshot);
    restoreDirFiles(PERSONA_SOURCES_DIR, personaSourcesSnapshot);
    restoreDirFiles(PERSONA_FEEDBACK_DIR, personaFeedbackSnapshot);
    restoreDirFiles(PERSONA_PROPOSALS_DIR, personaProposalsSnapshot);
    restoreDirTree(UPLOADS_DIR, uploadsSnapshot);
    restoreDirTree(UPLOADS_META_DIR, uploadsMetaSnapshot);
    restoreDirTree(NODE_ENGINE_DIR, nodeEngineSnapshot);
    restoreDirFiles(LOGS_DIR, logsSnapshot);
    restoreFileSnapshot(TRAINING_FILE, trainingSnapshot);
    restoreFileSnapshot(DPO_FILE, dpoSnapshot);
    removeNewDirEntries(SESSIONS_DIR, sessionEntriesBefore);
  }
}

main();
