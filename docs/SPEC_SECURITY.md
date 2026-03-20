# Security Specification -- kxkm_clown

> Version: 1.0.0
> Date: 2026-03-20
> Scope: `apps/api`, `packages/auth`, `packages/core`

---

## 1. Authentication

### 1.1 Cookie-based sessions

Sessions are managed via an `HttpOnly` cookie named `kxkm_v2_session`.

| Attribute    | Value                                               | Source file                |
| ------------ | --------------------------------------------------- | -------------------------- |
| `HttpOnly`   | Always set                                          | `apps/api/src/app.ts`      |
| `SameSite`   | `Strict`                                            | `apps/api/src/app.ts`      |
| `Secure`     | Set when `NODE_ENV === "production"`                | `apps/api/src/app.ts`      |
| `Path`       | `/`                                                 | `apps/api/src/app.ts`      |
| `Max-Age`    | `3600` (1 hour)                                     | `apps/api/src/app.ts`      |

Cookie creation:

```
Set-Cookie: kxkm_v2_session=<sessionId>; HttpOnly; [Secure; ]SameSite=Strict; Path=/; Max-Age=3600
```

Session extraction order (fallback chain in `packages/auth/src/index.ts`):
1. Parsed `cookies` object (`kxkm_v2_session`)
2. Raw `Cookie` header parsing
3. `x-session-id` header (for non-browser clients)

### 1.2 COOKIE_SECURE environment toggle

The `Secure` flag is toggled automatically based on `NODE_ENV`:
- `NODE_ENV=production` --> `Secure; ` included
- Otherwise --> omitted (allows local HTTP development)

This was the fix for **SEC-01** (see section 4).

### 1.3 ADMIN_TOKEN timing-safe comparison

Admin role escalation requires a server-side `ADMIN_TOKEN` environment variable. The comparison uses `crypto.timingSafeEqual` to prevent timing side-channel attacks.

Implementation (`apps/api/src/routes/session.ts` lines 166-173):
- Default role is always `viewer` regardless of client-supplied `role` field
- `admin`, `editor`, and `operator` roles require matching ADMIN_TOKEN
- Length check is performed before `timingSafeEqual` to avoid buffer length mismatch errors

Password hashing in `packages/auth/src/index.ts` uses `scrypt` (keylen=64) with random 16-byte salt, stored as `salt:hex` format. Verification also uses `timingSafeEqual` with buffer padding to prevent timing leaks on corrupted hashes.

### 1.4 Session token generation

Session tokens are generated via `crypto.randomBytes(32).toString("hex")` (256-bit entropy).

### 1.5 Rate limiting: login

| Parameter      | Value      |
| -------------- | ---------- |
| Max attempts   | 5          |
| Window         | 60 seconds |
| Scope          | Per IP     |
| HTTP status    | `429`      |
| Error code     | `rate_limited` |
| Test bypass    | `NODE_ENV=test` disables rate limiting |

Implementation: in-memory `Map<string, { count, resetAt }>` in `apps/api/src/routes/session.ts`.

---

## 2. Authorization (RBAC)

### 2.1 Roles

Four roles defined in `packages/core/src/index.ts`:

```
admin | editor | operator | viewer
```

### 2.2 Permission model

8 permissions defined in `@kxkm/core`:

| Permission           | admin | editor | operator | viewer |
| -------------------- | ----- | ------ | -------- | ------ |
| `session:manage`     | x     |        |          |        |
| `chat:read`          | x     | x      | x        | x      |
| `chat:write`         | x     | x      | x        |        |
| `persona:read`       | x     | x      | x        | x      |
| `persona:write`      | x     | x      |          |        |
| `node_engine:read`   | x     | x      | x        | x      |
| `node_engine:operate`| x     |        | x        |        |
| `ops:read`           | x     | x      | x        | x      |

Functions:
- `hasPermission(role, permission)` -- boolean check
- `assertPermission(role, permission)` -- throws on denial

### 2.3 Middleware enforcement

Three middleware layers in `apps/api/src/app-middleware.ts`:

1. **`createSessionMiddleware`** -- Extracts session from cookie/header, attaches to `req.session`
2. **`createRequireSession`** -- Returns 401 if no session
3. **`createRequirePermission(permission)`** -- Returns 401 if no session, 403 if permission denied

### 2.4 Subnet restrictions (ADMIN_ALLOWED_SUBNETS)

The `createAdminSubnetMiddleware` function in `apps/api/src/app-middleware.ts` restricts access by source IP:

- Parses CIDR notation (e.g. `192.168.1.0/24`, `::1/128`)
- Supports both IPv4 and IPv6
- Normalizes IPv4-mapped IPv6 addresses (`::ffff:x.x.x.x`)
- Strips zone identifiers (`%eth0`)
- Returns 403 `subnet_denied` on mismatch

---

## 3. Input Validation

### 3.1 Zod schemas

19 schemas defined in `apps/api/src/schemas.ts` and route files, with the `validate()` middleware wrapper:

| # | Schema                      | Route / Context                                         | Key constraints                                   |
|---|-----------------------------|---------------------------------------------------------|---------------------------------------------------|
| 1 | `loginSchema`               | `POST /api/session/login`                               | username: `^[a-zA-Z0-9_]+$`, max 40; token: max 256 |
| 2 | `createPersonaSchema`       | `POST /api/admin/personas`                              | name: max 50; model: max 100; summary: max 2000   |
| 3 | `updatePersonaSchema`       | `PUT /api/admin/personas/:id`                           | All fields optional, same bounds                   |
| 4 | `togglePersonaSchema`       | `POST /api/admin/personas/:id/toggle`                   | enabled: boolean                                   |
| 5 | `updatePersonaSourceSchema` | `PUT /api/admin/personas/:id/source`                    | subjectName: max 200; summary: max 5000; refs: max 100 items x 500 chars |
| 6 | `reinforcePersonaSchema`    | `POST /api/admin/personas/:id/reinforce`                | name: max 50; summary: max 2000                   |
| 7 | `voiceSampleSchema`         | `POST /api/admin/personas/:id/voice-sample`             | audio: base64 string, min 1                        |
| 8 | `createGraphSchema`         | `POST /api/admin/node-engine/graphs`                    | name: max 100; description: max 2000               |
| 9 | `updateGraphSchema`         | `PUT /api/admin/node-engine/graphs/:id`                 | name: max 100; description: max 2000               |
|10 | `runGraphSchema`            | `POST /api/admin/node-engine/graphs/:id/run`            | hold: boolean optional                             |
|11 | `retentionSweepSchema`      | `POST /api/v2/admin/retention-sweep`                    | maxAgeDays: 1-365 int                              |
|12 | `wsMessageSchema` (message) | WebSocket inbound                                       | text: max 8192 chars                               |
|13 | `wsMessageSchema` (command) | WebSocket inbound                                       | text: max 8192 chars                               |
|14 | `wsMessageSchema` (upload)  | WebSocket inbound                                       | filename: max 255; mimeType: max 100; size: max 16 MB |
|15 | `loginSchema.username`      | Login input validation (`@kxkm/auth`)                   | Regex `^[a-zA-Z0-9_]{1,40}$`                      |
|16 | `loginSchema.role`          | Login input validation                                  | Enum: admin, editor, operator, viewer              |
|17 | `loginSchema.password`      | Login input validation                                  | max 256                                            |
|18 | `loginSchema.token`         | Login input validation                                  | max 256                                            |
|19 | `validate()` middleware      | Generic Express middleware wrapper                      | Returns 400 with `validation_error` + Zod issues   |

The `validate()` middleware replaces `req.body` with the parsed/sanitized output, stripping any fields not declared in the schema.

### 3.2 WebSocket message validation

All inbound WS messages are validated against `wsMessageSchema`, a Zod discriminated union on the `type` field:
- `"message"` -- text: 1-8192 chars
- `"command"` -- text: 1-8192 chars
- `"upload"` -- filename max 255, mimeType max 100, size max 16 MB

Max WebSocket frame size: `16 MB` (`MAX_WS_MESSAGE_BYTES` in `ws-chat-helpers.ts`).

### 3.3 File upload MIME magic bytes validation (SEC-03)

File uploads are validated using the `file-type` library for magic bytes detection (`apps/api/src/ws-upload-handler.ts`).

**SAFE_MIMES allowlist** (18 types):

| Category      | MIME types                                                                          |
| ------------- | ----------------------------------------------------------------------------------- |
| Text          | `text/plain`, `text/markdown`, `text/csv`                                           |
| Data          | `application/json`, `application/pdf`                                               |
| Image         | `image/png`, `image/jpeg`, `image/webp`, `image/gif`                                |
| Audio         | `audio/wav`, `audio/mpeg`, `audio/ogg`, `audio/mp4`, `audio/flac`, `audio/x-wav`, `audio/x-flac` |
| Office        | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx), `.spreadsheetml.sheet` (xlsx), `.presentationml.presentation` (pptx) |

Validation logic:
1. If `file-type` detects magic bytes --> use detected MIME, reject if not in SAFE_MIMES
2. If no magic bytes detected --> verify file extension against text-safe set: `txt, md, csv, json, jsonl, xml, html, yml, yaml, toml`
3. Unknown extension without valid signature --> rejected

Additional constraints:
- Max file size: 12 MB per upload
- Empty data rejected

### 3.4 Tool execution whitelist

Three tools defined in `apps/api/src/mcp-tools.ts`:

| Tool              | Description                    | Exposed to              |
| ----------------- | ------------------------------ | ----------------------- |
| `web_search`      | SearXNG / DuckDuckGo search    | sherlock                |
| `image_generate`  | ComfyUI image generation       | picasso                 |
| `rag_search`      | Local knowledge base search    | All personas (default)  |

Per-persona tool permissions (`PERSONA_TOOLS` map):
- `pharmacius` -- no tools (pure router)
- `sherlock` -- `web_search`, `rag_search`
- `picasso` -- `image_generate`, `rag_search`
- Other personas -- `rag_search` only

Tool calls are limited to 1 round (max 1 tool-call cycle) to prevent infinite loops.

### 3.5 Argument sanitization

Tool arguments are coerced to string via `String(args.query || "")` in `executeToolCall()`. Inter-persona context is truncated to 500 characters (`fullText.slice(0, 500)`) in the conversation router to limit injection surface. WebSocket text messages are capped at 8192 characters by the Zod schema.

---

## 4. Security Audit Results

All 5 findings from the 2026-03-19 audit have been resolved.

| ID     | Severity | Original finding                                     | Fix applied                                                            | Lot   |
| ------ | -------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| SEC-01 | CRITICAL | Cookie without `Secure` flag in production           | Conditional `Secure` flag based on `NODE_ENV`                          | lot-12 |
| SEC-02 | HIGH     | Admin token in plaintext env var                      | Timing-safe comparison via `crypto.timingSafeEqual`; token never logged | lot-12 |
| SEC-03 | MEDIUM   | MIME validation based on client header only           | `file-type` magic bytes detection + SAFE_MIMES allowlist               | lot-42 |
| SEC-04 | MEDIUM   | No login rate limiting; client-supplied role trusted  | 5/min rate limit per IP; viewer default role; ADMIN_TOKEN required for escalation | lot-12 |
| SEC-05 | LOW      | Tool execution without whitelist or input bounds      | Per-persona tool whitelist (`PERSONA_TOOLS`); 1-round tool call limit; string coercion on args | lot-12 |

Additional security hardening applied:
- **BUG-06**: Health endpoint was leaking `DATABASE_URL` -- replaced with `storageMode` string
- **BUG-02**: Timeout promise leak in node-engine-runner -- fixed with AbortSignal
- **SEC-01 (path traversal)**: `node-engine-runner.js` -- reject absolute paths + rootDir boundary check

---

## 5. Observability

### 5.1 Pino structured logging

Logger configured in `apps/api/src/logger.ts`:

| Environment   | Output format          | Log level                                |
| ------------- | ---------------------- | ---------------------------------------- |
| Production    | JSON to stdout         | `info` (or `LOG_LEVEL` env)              |
| Development   | `pino-pretty` colored  | `debug` if `DEBUG=1`, else `info`        |

### 5.2 Perf instrumentation

`apps/api/src/perf.ts` provides latency metrics with percentile support.

6 instrumentation labels:

| Label   | Source                          |
| ------- | ------------------------------- |
| `http`  | Express request/response cycle  |
| `ollama`| LLM streaming calls             |
| `tts`   | Text-to-speech synthesis        |
| `upload_audio` | Audio transcription pipeline |
| `upload_pdf`   | PDF extraction pipeline      |
| `upload_document` | Office document extraction |

Metrics per label: `count`, `avgMs`, `p50`, `p95`, `p99`, `maxMs`.

Bucket size capped at 1000 samples with downsampling (every-other eviction).

Perf endpoint: `GET /api/v2/perf` (authenticated, served via `createPerfTracker().route`).

### 5.3 Error telemetry

`apps/api/src/error-tracker.ts` provides in-memory error tracking.

16 error labels used across the codebase:

| Label              | Source module              |
| ------------------ | -------------------------- |
| `ollama`           | ws-ollama.ts               |
| `ollama_connection`| ws-conversation-router.ts  |
| `tts`              | ws-conversation-router.ts  |
| `memory_load`      | ws-conversation-router.ts  |
| `memory_update`    | ws-conversation-router.ts  |
| `inter_persona`    | ws-conversation-router.ts  |
| `upload_audio`     | ws-upload-handler.ts       |
| `upload_pdf`       | ws-upload-handler.ts       |
| `upload_document`  | ws-upload-handler.ts       |
| `web_search`       | web-search.ts              |
| `comfyui`          | comfyui.ts                 |
| `rag`              | rag.ts                     |
| `node_engine`      | node-engine routes         |
| `context_store`    | context-store.ts           |
| `session`          | session routes             |
| `chat_log`         | chat logging               |

Ring buffer: 200 records max (FIFO eviction). Per-label counters (never reset except explicitly).

Telemetry endpoint: `GET /api/v2/errors` (requires `ops:read` permission).

Response format:
```json
{ "ok": true, "data": { "recent": [...], "counts": { "ollama": 3, ... } } }
```

### 5.4 Graceful shutdown

`apps/api/src/server.ts` handles `SIGTERM` and `SIGINT`:

1. Close WebSocket server (`wss.close()`)
2. Close HTTP server (`server.close()`)
3. Exit with code 0 on clean close
4. Force exit after 10-second timeout (`setTimeout(() => process.exit(1), 10000).unref()`)

---

## 6. Rate Limiting

### 6.1 Summary

| Layer     | Scope         | Limit           | Window    | Implementation                          |
| --------- | ------------- | --------------- | --------- | --------------------------------------- |
| HTTP      | Login         | 5 attempts      | 1 minute  | In-memory Map per IP (`routes/session.ts`) |
| WebSocket | Messages      | 15 messages     | 10 seconds| Timestamp array per client (`ws-chat-helpers.ts`) |
| Upload    | File transfer | 50 MB           | 1 minute  | Byte counter per client (`ws-upload-handler.ts`) |

### 6.2 HTTP login rate limiting

- Tracked per `req.ip || req.socket.remoteAddress`
- Window resets after 60 seconds from first attempt
- Returns `429 { ok: false, error: "rate_limited" }` when exceeded
- Bypassed in test environment (`NODE_ENV=test`)

### 6.3 WebSocket message rate limiting

Constants in `apps/api/src/ws-chat-helpers.ts`:
- `RATE_LIMIT_WINDOW_MS = 10_000` (10 seconds)
- `RATE_LIMIT_MAX_MESSAGES = 15`

Implementation: sliding window of timestamps per `ClientInfo`. Old timestamps pruned on each check. When limit reached, the message is dropped and a system warning is sent to the client.

### 6.4 Upload bandwidth rate limiting

- 50 MB per minute per client
- Tracked via `info.uploadBytesWindow` and `info.lastUploadReset`
- Window resets after 60 seconds
- Individual file max: 12 MB
- Returns user-facing message: "Upload rejete -- limite de debit depassee (50 MB/min)"

---

## 7. Security Matrix

| Attack vector                 | Mitigation                                           | Layer       | Status   |
| ----------------------------- | ---------------------------------------------------- | ----------- | -------- |
| Session hijacking (XSS)       | HttpOnly + SameSite=Strict cookies                   | Auth        | Resolved |
| Session hijacking (MITM)      | Secure flag in production                            | Auth        | Resolved (SEC-01) |
| Brute force login              | 5/min rate limit per IP                              | Auth        | Resolved (SEC-04) |
| Timing attack on admin token   | `crypto.timingSafeEqual` + buffer padding            | Auth        | Resolved (SEC-02) |
| Privilege escalation           | Server-side role assignment; viewer default           | RBAC        | Resolved (SEC-04) |
| Unauthorized admin access      | ADMIN_ALLOWED_SUBNETS CIDR filter                    | Network     | Active   |
| Malicious file upload          | MIME magic bytes + SAFE_MIMES allowlist               | Validation  | Resolved (SEC-03) |
| Oversized payload              | Zod schema limits + 16 MB WS frame + 12 MB file cap  | Validation  | Active   |
| WebSocket flood                | 15 msg/10s per client                                | Rate limit  | Active   |
| Upload bandwidth abuse         | 50 MB/min per client                                 | Rate limit  | Active   |
| Tool injection via LLM         | Per-persona tool whitelist; 1-round limit; string coercion | Execution | Resolved (SEC-05) |
| Path traversal (node engine)   | Absolute path rejection + rootDir boundary check      | Execution   | Resolved (SEC-01 path) |
| XSS via persona response       | Response cleaned/stripped; no raw HTML in WS messages  | Output      | Active   |
| Database URL leak              | Health endpoint returns `storageMode` string only      | Info leak   | Resolved (BUG-06) |
| Timing leak on password verify | `timingSafeEqual` with padded buffers (scrypt)         | Auth        | Active   |
| Denial of service (Ollama)     | p-limit concurrency limiter (default 3); 5-min timeout | Execution  | Active   |

---

## 8. Environment Variables (security-relevant)

| Variable               | Purpose                                    | Default               |
| ---------------------- | ------------------------------------------ | --------------------- |
| `ADMIN_TOKEN`          | Token for admin/editor/operator escalation | (none -- no escalation possible) |
| `ADMIN_ALLOWED_SUBNETS`| CIDR subnet restriction for admin routes   | (none -- no restriction) |
| `NODE_ENV`             | Controls Secure cookie flag                | (development)         |
| `LOG_LEVEL`            | Pino log level                             | `info`                |
| `MAX_OLLAMA_CONCURRENT`| Ollama concurrency limiter                 | `3`                   |
