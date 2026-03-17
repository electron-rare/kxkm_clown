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

  router.get("/api/v2/health", (_req, res) => {
    res.json(asApiData({
      app: "@kxkm/api",
      storage: storageMode, // BUG-06 fix: don't leak DATABASE_URL
      roles: ["admin", "editor", "operator", "viewer"] satisfies UserRole[],
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
      const input = validateLoginInput(req.body);

      // SEC-04 fix: Never trust client-supplied role — assign viewer by default.
      // Admin role requires ADMIN_TOKEN env var match.
      let role: UserRole = "viewer";
      const adminToken = process.env.ADMIN_TOKEN;
      const tokenMatches = Boolean(adminToken && req.body?.token === adminToken);
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

  return router;
}
