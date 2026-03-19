import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response, type NextFunction } from "express";
import {
  asApiData,
  type AuthSession,
  type Permission,
} from "@kxkm/core";
import {
  extractDPOPairs,
  type PersonaFeedbackRecord,
  type PersonaRecord,
  type PersonaSourceRecord,
} from "@kxkm/persona-domain";
import { validate, retentionSweepSchema } from "../schemas.js";

interface SessionRequest extends Request {
  session?: AuthSession;
}

type PersonaRepo = {
  list(): Promise<PersonaRecord[]>;
};

type FeedbackRepo = {
  listByPersonaId(personaId: string): Promise<PersonaFeedbackRecord[]>;
};

type RunRepo = {
  deleteOlderThan(date: string): Promise<number>;
};

interface ChatHistoryRouteDeps {
  personaRepo: PersonaRepo;
  feedbackRepo: FeedbackRepo;
  runRepo: RunRepo;
  storageMode: "postgres" | "memory";
  requireSession: (req: SessionRequest, res: Response, next: NextFunction) => void;
  requirePermission: (permission: Permission) => (req: SessionRequest, res: Response, next: NextFunction) => void;
  readRouteParam: (value: string | string[] | undefined) => string;
  escapeForHtml: (text: string) => string;
}

export function createChatHistoryRoutes(deps: ChatHistoryRouteDeps): Router {
  const {
    personaRepo,
    feedbackRepo,
    runRepo,
    storageMode,
    requireSession,
    requirePermission,
    readRouteParam,
    escapeForHtml,
  } = deps;

  const router = Router();

  // -----------------------------------------------------------------------
  // Retention sweep — delete old completed/failed/cancelled runs
  // -----------------------------------------------------------------------

  router.post("/api/v2/admin/retention-sweep", requirePermission("node_engine:operate"), validate(retentionSweepSchema), async (req, res) => {
    const body = req.body as { maxAgeDays?: number };
    const maxAgeDays = body.maxAgeDays || 30;
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const deleted = await runRepo.deleteOlderThan(cutoff);
    res.json({ ok: true, deleted });
  });

  // -----------------------------------------------------------------------
  // Export conversation as HTML
  // -----------------------------------------------------------------------

  router.get("/api/v2/export/html", requireSession, async (req: SessionRequest, res) => {
    try {
      const channel = readRouteParam(req.query?.channel as string || "general");
      const personas = await personaRepo.list();
      const personaMap = new Map(personas.map((p) => {
        const rec = p as unknown as { id: string; nick?: string; name?: string };
        return [rec.id, rec.nick || rec.name || rec.id] as const;
      }));

      // Build simple HTML export (session data placeholder — real impl would read from storage)
      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>KXKM_Clown — Export #${escapeForHtml(channel)}</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
    .msg { margin: 4px 0; } .nick { font-weight: bold; } .ts { color: #666; font-size: 0.85em; }
    h1 { color: #16213e; background: #0f3460; padding: 8px 16px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>#${escapeForHtml(channel)} — exported ${new Date().toISOString()}</h1>
  <p>Channel: <strong>#${escapeForHtml(channel)}</strong> | Personas: ${personas.length} | Storage: ${storageMode}</p>
  <p><em>Full message history requires session storage integration.</em></p>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="kxkm-export-${channel}.html"`);
      res.send(html);
    } catch {
      res.status(500).json({ ok: false, error: "export_error" });
    }
  });

  // -----------------------------------------------------------------------
  // Export DPO training pairs as JSONL
  // -----------------------------------------------------------------------

  router.get("/api/v2/export/dpo", requirePermission("persona:read"), async (req: SessionRequest, res) => {
    try {
      const filterPersonaId = req.query?.persona_id ? readRouteParam(req.query.persona_id as string) : null;

      let personas = await personaRepo.list();
      if (filterPersonaId) {
        personas = personas.filter((p) => p.id === filterPersonaId);
        if (personas.length === 0) {
          res.status(404).json({ ok: false, error: "persona_not_found" });
          return;
        }
      }

      const allPairs: Array<{ prompt: string; chosen: string; rejected: string; persona_id: string }> = [];

      for (const persona of personas) {
        const feedback = await feedbackRepo.listByPersonaId(persona.id);
        const pairs = extractDPOPairs(feedback, persona);
        for (const pair of pairs) {
          allPairs.push({
            prompt: pair.prompt,
            chosen: pair.chosen,
            rejected: pair.rejected,
            persona_id: pair.personaId,
          });
        }
      }

      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Content-Disposition", `attachment; filename="dpo-pairs-${new Date().toISOString().slice(0, 10)}.jsonl"`);
      const lines = allPairs.map((pair) => JSON.stringify(pair));
      res.send(lines.join("\n") + (lines.length ? "\n" : ""));
    } catch {
      res.status(500).json({ ok: false, error: "dpo_export_error" });
    }
  });

  // -----------------------------------------------------------------------
  // Chat history — browse past chat log files
  // -----------------------------------------------------------------------

  const chatLogDir = path.resolve(process.cwd(), process.env.KXKM_LOCAL_DATA_DIR || "data", "chat-logs");

  router.get("/api/v2/chat/history", requireSession, async (_req, res) => {
    try {
      await mkdir(chatLogDir, { recursive: true });
      const entries = await readdir(chatLogDir);
      const jsonlFiles = entries.filter((f) => f.startsWith("v2-") && f.endsWith(".jsonl"));

      const files: Array<{ date: string; lines: number; size: number }> = [];

      for (const filename of jsonlFiles) {
        const dateMatch = filename.match(/^v2-(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!dateMatch) continue;
        const filePath = path.join(chatLogDir, filename);
        const fileStat = await stat(filePath);
        const content = await readFile(filePath, "utf8");
        const lineCount = content.trim() ? content.trim().split("\n").length : 0;
        files.push({ date: dateMatch[1], lines: lineCount, size: fileStat.size });
      }

      files.sort((a, b) => b.date.localeCompare(a.date));
      res.json(asApiData({ files }));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        res.json(asApiData({ files: [] }));
        return;
      }
      res.status(500).json({ ok: false, error: "chat_history_error" });
    }
  });

  router.get("/api/v2/chat/search", requireSession, async (req, res) => {
    const query = String(req.query.q || "").toLowerCase();
    if (!query || query.length < 2) {
      return res.json({ results: [], query: "" });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const results: Array<{ date: string; ts: string; nick: string; text: string; type: string }> = [];

    try {
      await mkdir(chatLogDir, { recursive: true });
      const files = await readdir(chatLogDir);
      // Sort files descending (newest first)
      files.sort().reverse();

      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        if (results.length >= limit) break;

        const dateMatch = file.match(/^v2-(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!dateMatch) continue;
        const date = dateMatch[1];
        const content = await readFile(path.join(chatLogDir, file), "utf-8");

        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            const text = String(entry.text || "").toLowerCase();
            const nick = String(entry.nick || "").toLowerCase();
            if (text.includes(query) || nick.includes(query)) {
              results.push({
                date,
                ts: entry.ts || "",
                nick: entry.nick || "",
                text: entry.text || "",
                type: entry.type || "message",
              });
              if (results.length >= limit) break;
            }
          } catch {}
        }
      }
    } catch {}

    res.json({ results, query, total: results.length });
  });

  router.get("/api/v2/chat/history/:date", requireSession, async (req, res) => {
    try {
      const date = readRouteParam(req.params.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ ok: false, error: "invalid_date_format" });
        return;
      }

      const filePath = path.join(chatLogDir, `v2-${date}.jsonl`);
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") {
          res.status(404).json({ ok: false, error: "log_not_found" });
          return;
        }
        throw err;
      }

      const allLines = content.trim().split("\n").filter(Boolean);
      const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 1000);
      const offset = Math.max(Number(req.query?.offset) || 0, 0);

      const sliced = allLines.slice(offset, offset + limit);
      const messages = sliced.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { text: line, type: "raw" };
        }
      });

      res.json(asApiData({ messages, total: allLines.length, limit, offset }));
    } catch {
      res.status(500).json({ ok: false, error: "chat_history_error" });
    }
  });

  return router;
}
