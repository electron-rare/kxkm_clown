import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import supertest from "supertest";
import { createApp } from "./app.js";

// Ensure no Postgres connection is attempted
delete process.env.DATABASE_URL;
process.env.ADMIN_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
const TEST_LOCAL_DIR = path.join(process.cwd(), ".tmp-test-v2-local");
process.env.KXKM_LOCAL_DATA_DIR = TEST_LOCAL_DIR;

describe("V2 API", () => {
  let request: ReturnType<typeof supertest>;

  before(async () => {
    await rm(TEST_LOCAL_DIR, { recursive: true, force: true });
    const { app } = await createApp();
    request = supertest(app);
  });

  after(async () => {
    await rm(TEST_LOCAL_DIR, { recursive: true, force: true });
    delete process.env.KXKM_LOCAL_DATA_DIR;
    delete process.env.ADMIN_TOKEN;
  });

  // ---------------------------------------------------------------------------
  // Helper: login and return session cookie string
  // ---------------------------------------------------------------------------
  async function loginAs(role: string, username = `test_${role}`): Promise<string> {
    const payload: Record<string, string> = { username, role };
    if (["admin", "operator", "editor"].includes(role) && process.env.ADMIN_TOKEN) {
      payload.token = process.env.ADMIN_TOKEN;
    }
    const res = await request
      .post("/api/session/login")
      .send(payload)
      .expect(200);

    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(raw, "expected Set-Cookie header after login");
    // Return just the cookie key=value portion
    return raw.split(";")[0];
  }

  // ---------------------------------------------------------------------------
  // Storage contract
  // ---------------------------------------------------------------------------
  describe("Storage contract", () => {
    it("throws in production without DATABASE_URL", async () => {
      const savedEnv = process.env.NODE_ENV;
      const savedDb = process.env.DATABASE_URL;
      try {
        delete process.env.DATABASE_URL;
        process.env.NODE_ENV = "production";
        await assert.rejects(
          createApp(),
          /DATABASE_URL is required when NODE_ENV=production/,
        );
      } finally {
        if (savedEnv !== undefined) { process.env.NODE_ENV = savedEnv; } else { delete process.env.NODE_ENV; }
        if (savedDb !== undefined) { process.env.DATABASE_URL = savedDb; } else { delete process.env.DATABASE_URL; }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------
  describe("Health", () => {
    it("GET /api/v2/health returns 200", async () => {
      const res = await request.get("/api/v2/health").expect(200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.app, "@kxkm/api");
      assert.equal(res.body.data.storage, "local");
    });
  });

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------
  describe("Session", () => {
    let sessionCookie: string;

    it("POST /api/session/login creates session", async () => {
      const res = await request
        .post("/api/session/login")
        .send({ username: "admin_user", role: "admin", token: process.env.ADMIN_TOKEN })
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.role, "admin");
      assert.equal(res.body.data.username, "admin_user");
      assert.ok(res.body.data.id, "session should have an id");

      const setCookie = res.headers["set-cookie"];
      const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      assert.ok(raw, "expected Set-Cookie header");
      sessionCookie = raw.split(";")[0];
    });

    it("GET /api/session returns current session", async () => {
      const res = await request
        .get("/api/session")
        .set("Cookie", sessionCookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.username, "admin_user");
      assert.equal(res.body.data.role, "admin");
    });

    it("POST /api/session/logout destroys session", async () => {
      const res = await request
        .post("/api/session/logout")
        .set("Cookie", sessionCookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.loggedOut, true);
    });

    it("GET /api/session returns 401 after logout", async () => {
      const res = await request
        .get("/api/session")
        .set("Cookie", sessionCookie)
        .expect(401);

      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, "session_required");
    });

    it("POST /api/session/login rejects invalid payload", async () => {
      await request
        .post("/api/session/login")
        .send({ username: "", role: "admin", token: process.env.ADMIN_TOKEN })
        .expect(400);
    });

    it("POST /api/session/login rejects invalid role", async () => {
      await request
        .post("/api/session/login")
        .send({ username: "tester", role: "superadmin", token: process.env.ADMIN_TOKEN })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Personas
  // ---------------------------------------------------------------------------
  describe("Personas", () => {
    let cookie: string;

    before(async () => {
      cookie = await loginAs("admin");
    });

    it("GET /api/personas lists seeded personas", async () => {
      const res = await request
        .get("/api/personas")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 5, `expected >= 5 personas, got ${res.body.data.length}`);
    });

    it("GET /api/personas/:id returns persona", async () => {
      const res = await request
        .get("/api/personas/schaeffer")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.id, "schaeffer");
      assert.equal(res.body.data.name, "Schaeffer");
    });

    it("GET /api/personas/:id returns 404 for unknown id", async () => {
      await request
        .get("/api/personas/nonexistent")
        .set("Cookie", cookie)
        .expect(404);
    });

    it("PUT /api/admin/personas/:id updates persona", async () => {
      const res = await request
        .put("/api/admin/personas/batty")
        .set("Cookie", cookie)
        .send({ name: "Batty Updated", summary: "Updated summary" })
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.name, "Batty Updated");
      assert.equal(res.body.data.summary, "Updated summary");
    });

    it("GET /api/admin/personas/:id/source returns source", async () => {
      const res = await request
        .get("/api/admin/personas/schaeffer/source")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.personaId, "schaeffer");
    });

    it("GET /api/admin/personas/:id/feedback returns array", async () => {
      const res = await request
        .get("/api/admin/personas/batty/feedback")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.data));
      // After the PUT above, there should be at least 1 feedback entry
      assert.ok(res.body.data.length >= 1, "expected feedback after admin edit");
    });

    it("GET /api/admin/personas/:id/proposals returns array", async () => {
      const res = await request
        .get("/api/admin/personas/schaeffer/proposals")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.data));
    });

    it("stores repo-backed votes/signals and exports DPO pairs from persona feedback", async () => {
      const prompt = `Prompt DPO ${Date.now()}`;
      const chosen = `Chosen response ${Date.now()}`;
      const rejected = `Rejected response ${Date.now()}`;

      const upRes = await request
        .post("/api/v2/feedback")
        .set("Cookie", cookie)
        .send({
          messageId: "vote-up-1",
          personaNick: "Schaeffer",
          prompt,
          response: chosen,
          vote: "up",
          channel: "#general",
        })
        .expect(200);

      assert.equal(upRes.body.ok, true);
      assert.equal(upRes.body.data.saved, true);
      assert.equal(upRes.body.data.personaId, "schaeffer");
      assert.equal(upRes.body.data.kind, "vote");

      const downRes = await request
        .post("/api/v2/feedback")
        .set("Cookie", cookie)
        .send({
          messageId: "vote-down-1",
          personaNick: "Schaeffer",
          prompt,
          response: rejected,
          vote: "down",
          channel: "#general",
        })
        .expect(200);

      assert.equal(downRes.body.ok, true);
      assert.equal(downRes.body.data.kind, "vote");

      const pinRes = await request
        .post("/api/v2/feedback")
        .set("Cookie", cookie)
        .send({
          messageId: "pin-1",
          personaNick: "Schaeffer",
          response: chosen,
          signal: "pin",
          channel: "#general",
        })
        .expect(200);

      assert.equal(pinRes.body.ok, true);
      assert.equal(pinRes.body.data.kind, "chat_signal");

      const feedbackRes = await request
        .get("/api/admin/personas/schaeffer/feedback")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(feedbackRes.body.ok, true);
      assert.ok(Array.isArray(feedbackRes.body.data));
      assert.ok(
        feedbackRes.body.data.some((item: { kind: string; message: string }) => {
          return item.kind === "vote" && item.message.includes(chosen) && item.message.includes(prompt);
        }),
        "expected structured upvote feedback in repo-backed admin feed",
      );
      assert.ok(
        feedbackRes.body.data.some((item: { kind: string; message: string }) => {
          return item.kind === "chat_signal" && item.message.includes("\"signal\":\"pin\"") && item.message.includes(chosen);
        }),
        "expected pin chat signal in repo-backed admin feed",
      );

      const exportRes = await request
        .get("/api/v2/export/dpo")
        .query({ persona_id: "schaeffer" })
        .set("Cookie", cookie)
        .expect(200);

      assert.match(String(exportRes.headers["content-type"] || ""), /application\/x-ndjson/);
      const lines = String(exportRes.text || "").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      assert.ok(
        lines.some((line: { prompt: string; chosen: string; rejected: string; persona_id: string }) => {
          return line.prompt === prompt && line.chosen === chosen && line.rejected === rejected && line.persona_id === "schaeffer";
        }),
        "expected exported DPO pair from repo-backed votes",
      );
    });

    it("uploads, reports and deletes a voice sample using the local data dir", async () => {
      const audio = Buffer.from("RIFF-test-voice-sample").toString("base64");

      const uploadRes = await request
        .post("/api/admin/personas/schaeffer/voice-sample")
        .set("Cookie", cookie)
        .send({ audio })
        .expect(200);

      assert.equal(uploadRes.body.ok, true);
      assert.equal(uploadRes.body.data.samplePath, path.join(".tmp-test-v2-local", "voice-samples", "schaeffer.wav"));

      const persisted = await readFile(path.join(TEST_LOCAL_DIR, "voice-samples", "schaeffer.wav"));
      assert.equal(persisted.toString("utf8"), "RIFF-test-voice-sample");

      const statusRes = await request
        .get("/api/admin/personas/schaeffer/voice-sample")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(statusRes.body.ok, true);
      assert.equal(statusRes.body.data.hasVoiceSample, true);
      assert.equal(statusRes.body.data.samplePath, path.join(".tmp-test-v2-local", "voice-samples", "schaeffer.wav"));

      const deleteRes = await request
        .delete("/api/admin/personas/schaeffer/voice-sample")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(deleteRes.body.ok, true);
      assert.equal(deleteRes.body.data.deleted, true);

      const missingStatusRes = await request
        .get("/api/admin/personas/schaeffer/voice-sample")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(missingStatusRes.body.ok, true);
      assert.equal(missingStatusRes.body.data.hasVoiceSample, false);
    });

    it("persists local persona updates across app recreation", async () => {
      const { app: app2 } = await createApp();
      const request2 = supertest(app2);
      const login2 = await request2
        .post("/api/session/login")
        .send({ username: "reload_admin", role: "admin", token: process.env.ADMIN_TOKEN })
        .expect(200);

      const setCookie = login2.headers["set-cookie"];
      const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      assert.ok(raw, "expected Set-Cookie header after app recreation login");
      const cookie2 = raw.split(";")[0];

      const res = await request2
        .get("/api/personas/batty")
        .set("Cookie", cookie2)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.summary, "Updated summary");
    });
  });

  // ---------------------------------------------------------------------------
  // Node Engine
  // ---------------------------------------------------------------------------
  describe("Node Engine", () => {
    let cookie: string;
    let createdGraphId: string;
    let createdRunId: string;

    before(async () => {
      // operator has node_engine:read and node_engine:operate
      cookie = await loginAs("operator");
    });

    it("GET /api/admin/node-engine/overview returns overview", async () => {
      const res = await request
        .get("/api/admin/node-engine/overview")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.ok(res.body.data !== undefined);
    });

    it("POST /api/admin/node-engine/graphs creates graph", async () => {
      const res = await request
        .post("/api/admin/node-engine/graphs")
        .set("Cookie", cookie)
        .send({ name: "test_graph", description: "Integration test graph" })
        .expect(201);

      assert.equal(res.body.ok, true);
      assert.ok(res.body.data.id);
      assert.equal(res.body.data.name, "test_graph");
      createdGraphId = res.body.data.id;
    });

    it("GET /api/admin/node-engine/graphs lists graphs", async () => {
      const res = await request
        .get("/api/admin/node-engine/graphs")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.data));
      // At least the starter graph + the one we just created
      assert.ok(res.body.data.length >= 2, `expected >= 2 graphs, got ${res.body.data.length}`);
    });

    it("PUT /api/admin/node-engine/graphs/:id updates graph", async () => {
      const res = await request
        .put(`/api/admin/node-engine/graphs/${createdGraphId}`)
        .set("Cookie", cookie)
        .send({ name: "test_graph_updated", description: "Updated description" })
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.name, "test_graph_updated");
    });

    it("POST /api/admin/node-engine/graphs/:id/run starts run", async () => {
      const res = await request
        .post(`/api/admin/node-engine/graphs/${createdGraphId}/run`)
        .set("Cookie", cookie)
        .send({ hold: true }) // prevent auto-transition timers in tests
        .expect(201);

      assert.equal(res.body.ok, true);
      assert.ok(res.body.data.id);
      assert.equal(res.body.data.graphId, createdGraphId);
      assert.equal(res.body.data.status, "queued");
      createdRunId = res.body.data.id;
    });

    it("GET /api/admin/node-engine/runs/:id returns run", async () => {
      const res = await request
        .get(`/api/admin/node-engine/runs/${createdRunId}`)
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.id, createdRunId);
    });

    it("POST /api/admin/node-engine/runs/:id/cancel cancels run", async () => {
      const res = await request
        .post(`/api/admin/node-engine/runs/${createdRunId}/cancel`)
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.status, "cancelled");
    });

    it("GET /api/admin/node-engine/models returns models", async () => {
      const res = await request
        .get("/api/admin/node-engine/models")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 1, "expected at least 1 model");
    });

    it("PUT /api/admin/node-engine/graphs/:id returns 404 for unknown graph", async () => {
      await request
        .put("/api/admin/node-engine/graphs/nonexistent")
        .set("Cookie", cookie)
        .send({ name: "nope" })
        .expect(404);
    });

    it("GET /api/admin/node-engine/runs/:id returns 404 for unknown run", async () => {
      await request
        .get("/api/admin/node-engine/runs/nonexistent")
        .set("Cookie", cookie)
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------
  describe("Chat", () => {
    let cookie: string;

    before(async () => {
      cookie = await loginAs("viewer");
    });

    it("GET /api/chat/channels returns channels", async () => {
      const res = await request
        .get("/api/chat/channels")
        .set("Cookie", cookie)
        .expect(200);

      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.data));
      // DEFAULT_CHANNELS (2) + 3 model-dedicated channels = 5
      assert.ok(res.body.data.length >= 2, `expected >= 2 channels, got ${res.body.data.length}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Auth enforcement
  // ---------------------------------------------------------------------------
  describe("Auth enforcement", () => {
    it("admin routes return 401 without session", async () => {
      const res = await request
        .get("/api/admin/node-engine/overview")
        .expect(401);

      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, "session_required");
    });

    it("session-required routes return 401 without session", async () => {
      await request.get("/api/personas").expect(401);
      await request.get("/api/chat/channels").expect(401);
      await request.post("/api/v2/feedback").send({
        personaNick: "Schaeffer",
        response: "test",
        vote: "up",
      }).expect(401);
    });

    it("admin routes return 403 for viewer role", async () => {
      const viewerCookie = await loginAs("viewer", "viewer_authtest");

      // viewer has persona:read but NOT persona:write
      const res = await request
        .put("/api/admin/personas/schaeffer")
        .set("Cookie", viewerCookie)
        .send({ name: "Should Fail" })
        .expect(403);

      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, "permission_denied");
    });

    it("operator cannot write personas (no persona:write)", async () => {
      const opCookie = await loginAs("operator", "op_authtest");

      await request
        .put("/api/admin/personas/schaeffer")
        .set("Cookie", opCookie)
        .send({ name: "Should Fail" })
        .expect(403);
    });

    it("editor cannot operate node-engine (no node_engine:operate)", async () => {
      const editorCookie = await loginAs("editor", "ed_authtest");

      await request
        .post("/api/admin/node-engine/graphs")
        .set("Cookie", editorCookie)
        .send({ name: "nope" })
        .expect(403);
    });
  });
});
