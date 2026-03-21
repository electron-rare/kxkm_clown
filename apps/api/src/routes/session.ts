import crypto from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response, type NextFunction } from "express";
import {
  asApiData,
  type AuthSession,
  type Permission,
  type UserRole,
} from "@kxkm/core";
import { validateLoginInput } from "@kxkm/auth";
import { buildChatChannels } from "@kxkm/chat-domain";
import { getRecentErrors, getErrorCounts } from "../error-tracker.js";
import { scheduler, getGPUUtilization } from "../inference-scheduler.js";
import type { PersonaRecord } from "@kxkm/persona-domain";
import type { ModelRegistryRecord, NodeGraphRecord, NodeRunRecord } from "@kxkm/node-engine";

interface SessionRequest extends Request {
  session?: AuthSession;
}

type SessionRepo = {
  create(input: { username: string; role: UserRole; expiresAt?: string }): Promise<AuthSession>;
  findById(id: string): Promise<AuthSession | null>;
  deleteById(id: string): Promise<void>;
  deleteExpired(): Promise<number>;
};

type PersonaRepo = {
  list(): Promise<PersonaRecord[]>;
};

type GraphRepo = {
  list(): Promise<NodeGraphRecord[]>;
};

type RunRepo = {
  list(): Promise<NodeRunRecord[]>;
};

interface SessionRouteDeps {
  sessionRepo: SessionRepo;
  personaRepo: PersonaRepo;
  graphRepo: GraphRepo;
  runRepo: RunRepo;
  modelRegistry: ModelRegistryRecord[];
  storageMode: "postgres" | "memory";
  requireSession: (req: SessionRequest, res: Response, next: NextFunction) => void;
  requirePermission: (permission: Permission) => (req: SessionRequest, res: Response, next: NextFunction) => void;
  setSessionCookie: (res: Response, sessionId: string) => void;
  clearSessionCookie: (res: Response) => void;
}

// Simple in-memory rate limiter for login attempts
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_LIMIT = 5; // max attempts
const LOGIN_RATE_WINDOW_MS = 60_000; // per minute

function checkLoginRateLimit(ip: string): boolean {
  if (process.env.NODE_ENV === "test") return true;
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= LOGIN_RATE_LIMIT;
}

export function createSessionRoutes(deps: SessionRouteDeps): Router {
  const {
    sessionRepo,
    personaRepo,
    graphRepo,
    runRepo,
    modelRegistry,
    storageMode,
    requireSession,
    requirePermission,
    setSessionCookie,
    clearSessionCookie,
  } = deps;

  const router = Router();

  router.get("/api/v2/health", async (_req, res) => {
    const startMs = Date.now();
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";

    const timeout = <T>(p: Promise<T>, ms = 2000): Promise<T> =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

    const [ollamaResult, dbResult] = await Promise.allSettled([
      timeout(fetch(`${ollamaUrl}/api/tags`).then(async (r) => {
        const body = await r.json() as { models?: unknown[] };
        return { ok: r.ok, models: Array.isArray(body.models) ? body.models.length : 0 };
      })),
      timeout(personaRepo.list().then((list) => ({ ok: true, count: list.length }))),
    ]);

    const ollama = ollamaResult.status === "fulfilled"
      ? { status: "ok" as const, models_loaded: ollamaResult.value.models }
      : { status: "error" as const, error: (ollamaResult.reason as Error).message };

    const db = dbResult.status === "fulfilled"
      ? { status: "ok" as const, personas: dbResult.value.count }
      : { status: "error" as const, error: (dbResult.reason as Error).message };

    const uptimeSec = Math.floor(process.uptime());
    const uptimeHuman = `${Math.floor(uptimeSec / 3600)}h${Math.floor((uptimeSec % 3600) / 60)}m${uptimeSec % 60}s`;

    res.json(asApiData({
      app: "@kxkm/api",
      storage: storageMode,
      roles: ["admin", "editor", "operator", "viewer"] satisfies UserRole[],
      uptime_sec: uptimeSec,
      uptime_human: uptimeHuman,
      ollama,
      database: db,
      health_check_ms: Date.now() - startMs,
    }));
  });

  // Scheduler metrics — GPU/CPU task management
  router.get("/api/v2/scheduler", (_req, res) => {
    const metrics = scheduler.getMetrics();
    const gpuUtil = getGPUUtilization();
    res.json(asApiData({
      ...metrics,
      gpuUtilization: gpuUtil,
    }));
  });

  // Public status strip — no auth required
  router.get("/api/v2/status", async (_req, res) => {
    try {
      const [personas, graphs, runs] = await Promise.all([
        personaRepo.list(),
        graphRepo.list(),
        runRepo.list(),
      ]);
      const activePersonas = personas.filter((p) => (p as unknown as { enabled?: boolean }).enabled !== false);
      const runningRuns = runs.filter((r) => r.status === "running");
      const queuedRuns = runs.filter((r) => r.status === "queued");

      res.json(asApiData({
        name: "KXKM_Clown",
        version: "2.0.0",
        storage: storageMode,
        personas: { total: personas.length, active: activePersonas.length },
        nodeEngine: {
          graphs: graphs.length,
          runs: runs.length,
          running: runningRuns.length,
          queued: queuedRuns.length,
        },
      }));
    } catch (err) {
      res.status(500).json({ ok: false, error: "status_error" });
    }
  });

  router.post("/api/session/login", async (req, res) => {
    try {
      const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
      if (!checkLoginRateLimit(clientIp)) {
        res.status(429).json({ ok: false, error: "rate_limited" });
        return;
      }

      const input = validateLoginInput(req.body);

      // SEC-04 fix: Never trust client-supplied role — assign viewer by default.
      // Admin role requires ADMIN_TOKEN env var match.
      let role: UserRole = "viewer";
      const adminToken = process.env.ADMIN_TOKEN;
      const supplied = String(req.body?.token ?? "");
      const tokenMatches = Boolean(
        adminToken &&
        supplied.length > 0 &&
        adminToken.length === supplied.length &&
        crypto.timingSafeEqual(Buffer.from(adminToken), Buffer.from(supplied)),
      );
      if (input.role === "admin" && tokenMatches) {
        role = "admin";
      } else if (input.role === "operator" || input.role === "editor") {
        // Allow non-admin elevated roles only if admin token is provided
        if (tokenMatches) {
          role = input.role as UserRole;
        }
      }

      const session = await sessionRepo.create({ username: input.username, role });
      setSessionCookie(res, session.id);
      res.json(asApiData(session));
    } catch {
      res.status(400).json({ ok: false, error: "invalid_login_payload" });
    }
  });

  router.get("/api/session", (req: SessionRequest, res) => {
    if (!req.session) {
      res.status(401).json({ ok: false, error: "session_required" });
      return;
    }
    res.json(asApiData(req.session));
  });

  router.post("/api/session/logout", async (req: SessionRequest, res) => {
    if (req.session) {
      await sessionRepo.deleteById(req.session.id);
    }
    clearSessionCookie(res);
    res.json(asApiData({ loggedOut: true }));
  });

  router.get("/api/chat/channels", requireSession, (_req, res) => {
    res.json(asApiData(buildChatChannels(modelRegistry.map((model) => model.id))));
  });

  // -----------------------------------------------------------------------
  // Analytics — aggregate chat log stats
  // -----------------------------------------------------------------------

  router.get("/api/v2/analytics", requirePermission("ops:read"), async (_req: SessionRequest, res) => {
    const logDir = path.join(process.cwd(), process.env.KXKM_LOCAL_DATA_DIR || "data", "chat-logs");
    const stats = {
      totalMessages: 0,
      totalDays: 0,
      personaMessages: {} as Record<string, number>,
      userMessages: 0,
      systemMessages: 0,
      uploadsCount: 0,
      messagesPerDay: [] as Array<{ date: string; count: number }>,
      topPersonas: [] as Array<{ nick: string; count: number }>,
    };

    try {
      await mkdir(logDir, { recursive: true });
      const files = await readdir(logDir);
      stats.totalDays = files.filter((f) => f.endsWith(".jsonl")).length;

      for (const file of files.sort().reverse().slice(0, 30)) {
        if (!file.endsWith(".jsonl")) continue;
        const date = file.replace("v2-", "").replace(".jsonl", "");
        const content = await readFile(path.join(logDir, file), "utf-8");
        let dayCount = 0;

        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            stats.totalMessages++;
            dayCount++;

            if (entry.type === "message" && entry.nick) {
              if (entry.nick.startsWith("user_")) {
                stats.userMessages++;
              } else {
                stats.personaMessages[entry.nick] = (stats.personaMessages[entry.nick] || 0) + 1;
              }
            }
            if (entry.type === "upload") stats.uploadsCount++;
          } catch {}
        }
        stats.messagesPerDay.push({ date, count: dayCount });
      }

      stats.topPersonas = Object.entries(stats.personaMessages)
        .map(([nick, count]) => ({ nick, count }))
        .sort((a, b) => b.count - a.count);
    } catch {}

    res.json({ ok: true, data: stats });
  });

  // -----------------------------------------------------------------------
  // AI prompt suggestion for Compose DAW
  // -----------------------------------------------------------------------

  router.post("/api/v2/ai/suggest-prompt", async (req, res) => {
    const { type, style: compStyle, existing, context } = req.body || {};
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";

    const typeHints: Record<string, string> = {
      music: "une description musicale pour générer de la musique",
      voice: "un texte poétique ou narratif à dire par une voix synthétique",
      noise: "un type de bruit ou texture sonore (drone, pink, white, brown, sine)",
      fx: "un effet sonore ou une texture de fond",
    };

    try {
      const resp = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3:8b",
          messages: [{ role: "user", content: `Tu es un compositeur sonore. Génère ${typeHints[type as string] || "un prompt audio"} pour une composition de style "${compStyle || "experimental"}". ${existing ? `Le prompt actuel est: "${existing}". Améliore-le.` : ""} ${context ? `Contexte des autres pistes: ${context}` : ""} Réponds UNIQUEMENT le prompt (1-2 phrases max, pas d'explication).` }],
          stream: false,
          options: { num_predict: 80 },
          keep_alive: "30m",
          think: false,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await resp.json() as { message?: { content?: string } };
      res.json({ ok: true, prompt: data.message?.content?.trim() || "" });
    } catch {
      res.json({ ok: false, prompt: "" });
    }
  });

  // -----------------------------------------------------------------------
  // Error telemetry — recent tracked errors
  // -----------------------------------------------------------------------

  router.get("/api/v2/errors", requirePermission("ops:read"), (_req: SessionRequest, res) => {
    res.json({ ok: true, data: { recent: getRecentErrors(), counts: getErrorCounts() } });
  });

  return router;
}
