#!/usr/bin/env node

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer } = require("ws");

const args = process.argv.slice(2);

function readArg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

const host = readArg("host", "127.0.0.1");
const port = Number(readArg("port", "4180"));
const logPath = readArg("log", "");
const webOrigin = readArg("web-origin", "http://127.0.0.1:4173");

if (logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
}

function log(message) {
  const line = `[playwright-backend] ${new Date().toISOString()} ${message}`;
  process.stdout.write(`${line}\n`);
  if (logPath) {
    fs.appendFileSync(logPath, `${line}\n`);
  }
}

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = req.headers.origin || webOrigin;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Vary", "Origin");
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  return raw.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sessionCookie(sessionId) {
  return `kxkm_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return "kxkm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function createSession(username, role) {
  const id = crypto.randomUUID();
  const now = new Date();
  return {
    id,
    username,
    role,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  };
}

const sessions = new Map();
const personas = [
  {
    id: "pharmacius",
    name: "Pharmacius",
    model: "qwen2.5",
    summary: "Persona sante deterministe pour les tests E2E.",
    editable: true,
    enabled: true,
    color: "#7aff7a",
  },
  {
    id: "kafka",
    name: "Kafka",
    model: "llama3",
    summary: "Persona litteraire deterministe pour les tests E2E.",
    editable: true,
    enabled: true,
    color: "#7ad7ff",
  },
];

const graphs = [
  {
    id: "graph-demo",
    name: "Graphe demo",
    description: "Pipeline deterministe pour Playwright",
  },
  {
    id: "graph-audit",
    name: "Audit docs",
    description: "Validation documentaire et resume",
  },
];

function sendWs(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${host}:${port}`);
  const cookies = parseCookies(req);
  const session = cookies.kxkm_session ? sessions.get(cookies.kxkm_session) || null : null;

  try {
    if (req.method === "GET" && url.pathname === "/api/v2/health") {
      json(res, 200, { ok: true, data: { ok: true } });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/session/login") {
      const body = await readJson(req);
      const username = typeof body.username === "string" && body.username.trim()
        ? body.username.trim()
        : "visiteur";
      const role = body.role === "admin" ? "admin" : body.role === "operator" ? "operator" : "viewer";
      const created = createSession(username, role);
      sessions.set(created.id, created);
      json(
        res,
        200,
        { data: created },
        { "Set-Cookie": sessionCookie(created.id) },
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      if (!session) {
        json(res, 401, { error: "not_authenticated" });
        return;
      }
      json(res, 200, { data: session });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/session/logout") {
      if (cookies.kxkm_session) sessions.delete(cookies.kxkm_session);
      json(res, 200, { data: { ok: true } }, { "Set-Cookie": clearSessionCookie() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/personas") {
      json(res, 200, { data: personas });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/node-engine/overview") {
      json(res, 200, {
        data: {
          queue: {
            desiredWorkers: 2,
            activeWorkers: 1,
            queuedRuns: 1,
            runningRuns: 1,
          },
          registry: {
            graphs: graphs.length,
            models: 3,
          },
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/node-engine/graphs") {
      json(res, 200, { data: graphs });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/node-engine/graphs") {
      const body = await readJson(req);
      const created = {
        id: `graph-${graphs.length + 1}`,
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : `Graphe ${graphs.length + 1}`,
        description: typeof body.description === "string" ? body.description : "",
      };
      graphs.push(created);
      json(res, 200, { data: created });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v2/analytics") {
      json(res, 200, {
        data: {
          totalMessages: 12,
          totalDays: 3,
          personaMessages: { Pharmacius: 5, Kafka: 2 },
          userMessages: 4,
          systemMessages: 1,
          uploadsCount: 1,
          messagesPerDay: [
            { date: "2026-03-18", count: 2 },
            { date: "2026-03-19", count: 4 },
            { date: "2026-03-20", count: 6 },
          ],
          topPersonas: [
            { nick: "Pharmacius", count: 5 },
            { nick: "Kafka", count: 2 },
          ],
        },
      });
      return;
    }

    json(res, 404, { error: "not_found", path: url.pathname });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/ws", `http://${host}:${port}`);
  const nick = url.searchParams.get("nick") || "user_playwright";
  const users = [nick, ...personas.map((persona) => persona.name)];

  sendWs(ws, {
    type: "system",
    text: "***\n*** KXKM_Clown V2 - Backend Playwright\n*** Tape /help pour les commandes.\n***",
  });
  for (const persona of personas) {
    sendWs(ws, { type: "persona", nick: persona.name, color: persona.color });
  }
  sendWs(ws, { type: "channelInfo", channel: "#general" });
  sendWs(ws, { type: "userlist", users });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!message || typeof message !== "object") return;

    if (message.type === "command") {
      sendWs(ws, {
        type: "system",
        text: `Commande recue: ${message.text || ""}\nCommandes disponibles: /help /clear /personas`,
      });
      return;
    }

    if (message.type === "upload") {
      const filename = typeof message.filename === "string" ? message.filename : "fichier.bin";
      const size = typeof message.size === "number" ? message.size : 0;
      sendWs(ws, {
        type: "system",
        text: `${nick} a envoye: ${filename} (${(size / 1024).toFixed(1)} KB)`,
      });
      setTimeout(() => {
        sendWs(ws, {
          type: "message",
          nick: "Pharmacius",
          text: `Fichier recu: ${filename}. Analyse prete.`,
          color: "#7aff7a",
        });
      }, 120);
      return;
    }

    if (message.type === "message") {
      const text = typeof message.text === "string" ? message.text : "";
      sendWs(ws, { type: "message", nick, text, color: "#e0e0e0" });
      sendWs(ws, { type: "system", text: "Pharmacius est en train d'ecrire..." });
      setTimeout(() => {
        sendWs(ws, {
          type: "message",
          nick: "Pharmacius",
          text: `Reponse deterministe: ${text || "message vide"}`,
          color: "#7aff7a",
        });
      }, 160);
    }
  });
});

server.listen(port, host, () => {
  log(`listening on http://${host}:${port}`);
});

function shutdown(signal) {
  log(`shutdown (${signal})`);
  wss.close(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 2_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
