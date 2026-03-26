# Deep Security / Performance / Quality Audit — 2026-03-26

Scope: `apps/api/src/` — focused on recently modified files and composition-store.

---

## FINDING-1 [P0] Blocking synchronous I/O in hot write path (`composition-store.ts`)

- **File:** `apps/api/src/composition-store.ts:248`
- **Issue:** `saveComposition()` calls `fs.mkdirSync` + `fs.writeFileSync` synchronously. This function is called from `createComposition`, `addTrack`, `updateTimelineSettings`, `addTimelineMarker`, and `setActiveComposition` — all triggered by WebSocket command handlers. A slow disk stalls the entire Node.js event loop, blocking all in-flight requests and WebSocket messages for every connected client.
- **Fix:** Replace with async equivalents (`fs.promises.mkdir` + `fs.promises.writeFile`). Make `saveComposition` return `Promise<void>` and await it in callers, or fire-and-forget with `.catch(logger.error)` for non-critical paths.

---

## FINDING-2 [P0] Unbounded in-memory `compositions` Map — no eviction, no size limit

- **File:** `apps/api/src/composition-store.ts:60`
- **Issue:** The module-level `compositions` Map grows indefinitely. Every `createComposition` call adds an entry that is never removed. A bot or abusive client can exhaust heap by issuing repeated `/compose` commands. There is no per-nick, per-channel, or global cap.
- **Fix:** (a) Add a `MAX_COMPOSITIONS` constant (e.g. 500) checked at creation time, returning an error if exceeded. (b) Add a `deleteComposition(id)` export so callers can clean up stale entries. (c) Optionally implement an LRU eviction strategy keyed by `updatedAt`.

---

## FINDING-3 [P1] Unbounded `ttsQueues` Map — completed promises are never deleted

- **File:** `apps/api/src/ws-conversation-router.ts:258,291-297`
- **Issue:** `enqueueTTS` chains new promises onto `ttsQueues.get(nick)` but never removes a nick's entry after the chain drains. Over a long-lived server run with many distinct nicks (or persona reloads), the map accumulates stale resolved promises indefinitely. The value itself is a `Promise<void>` that holds a closure reference, preventing GC of the persona context.
- **Fix:** After the final `.finally()` in the promise chain, delete the key: `ttsQueues.set(nick, next.finally(() => { if (ttsQueues.get(nick) === next) ttsQueues.delete(nick); }))`.

---

## FINDING-4 [P1] Unbounded `personaMemoryLocks` Map — stale promise chains accumulate

- **File:** `apps/api/src/ws-conversation-router.ts:257,330-341`
- **Issue:** `scheduleMemoryUpdate` chains onto `personaMemoryLocks.get(persona.nick)` but never clears the entry after the promise resolves. After N memory-update cycles for a given persona, the map slot holds a long resolved-promise chain whose tail is already settled. The `prunePersonaState` call (every 50 messages) does delete entries for inactive personas, but active personas accumulate without bound between prunes.
- **Fix:** After the catch in `scheduleMemoryUpdate`, reset the lock slot to a settled promise: chain `.finally(() => { if (personaMemoryLocks.get(persona.nick) === next) personaMemoryLocks.set(persona.nick, Promise.resolve()); })`. This prevents the chain from growing unboundedly.

---

## FINDING-5 [P1] No file-size limit on persisted composition JSON

- **File:** `apps/api/src/composition-store.ts:245-249`
- **Issue:** `saveComposition` serializes the full `Composition` object (including all tracks, clips, markers) with no size check before writing. A composition with hundreds of tracks (each with a `filePath` or large `prompt`) could produce a multi-megabyte JSON file. No limit on number of tracks, clips, or marker label length exists.
- **Fix:** (a) Add `MAX_TRACKS_PER_COMPOSITION = 100` enforced in `addTrack`. (b) In `saveComposition`, compute `JSON.stringify` length and reject (log + return early) if it exceeds a configured threshold (e.g. `KXKM_MAX_COMPOSITION_BYTES`, default 512 KB).

---

## FINDING-6 [P1] `readV2Record` does a full directory scan on cache miss when `personaId` is absent

- **File:** `apps/api/src/persona-memory-store.ts:217-242`
- **Issue:** When `identity.personaId` is undefined (e.g. when called with a raw string subject or a legacy nick), the function calls `readdir(v2Dir)` and then reads every `.json` file sequentially in a loop until a nick match is found. With many personas or a large v2 directory, this is O(n) disk I/O on every cold-cache load. Since the function is called from `loadPersonaMemory`, which is called for every responder on every incoming message when the TTL has expired, this compounds under load.
- **Fix:** Maintain a `nick → personaId` index file (or a small in-memory Map populated at startup) so that nick-based lookups are O(1). Alternatively, always require a `personaId` in `loadPersonaMemory` and enforce it at the persona config level.

---

## FINDING-7 [P2] Module-level `fs.mkdirSync` and `fs.readdirSync`/`fs.readFileSync` at import time

- **File:** `apps/api/src/composition-store.ts:7,253-261`
- **Issue:** `fs.mkdirSync(COMP_DIR, { recursive: true })` executes at module import. The startup `for` loop uses `fs.readdirSync` + `fs.existsSync` + `fs.readFileSync` synchronously, blocking the event loop during server boot. While this is a one-time cost, if `COMP_DIR` contains many entries or a large composition file fails to parse, the top-level `try/catch` swallows the error silently with a comment `/* no compositions yet */`, hiding real I/O or parse errors.
- **Fix:** Move startup loading into an explicit `async function loadCompositionsFromDisk()` called during app initialization. Log individual file parse failures rather than suppressing all errors.

---

## FINDING-8 [P2] No input size validation on `recentMessages` passed to `updatePersonaMemory`

- **File:** `apps/api/src/ws-persona-router.ts:26-85` / `apps/api/src/ws-conversation-router.ts:482-488`
- **Issue:** `trackPersonaMessage` appends the full `sourceLabel + text + fullText` string to `personaRecentMessages`. The array is bounded by `workingSourceMessagesLimit` (default 10), but individual message strings are unbounded. A user who sends a 100 KB message (WebSocket has no enforced payload limit visible here) will cause every memory extraction prompt to include a 100 KB string, inflating the Ollama request body and potentially triggering a 30-second timeout on every extraction cycle.
- **Fix:** Truncate individual message strings in `trackPersonaMessage` to a configurable maximum (e.g. `KXKM_MAX_MESSAGE_CHARS`, default 2000 chars) before appending. The policy's `recentMessagesWindow` already slices the window, but does not truncate individual items.

---

## FINDING-9 [P2] `perf.ts` — `counters` Map has no upper bound on distinct label names

- **File:** `apps/api/src/perf.ts:66-70`
- **Issue:** `incrementCounter(name)` accepts any string as `name`. If callers pass user-controlled or dynamically generated strings (e.g. persona nick concatenated with an event type), the `counters` Map and the `metrics` Map in the same file grow without bound. Currently callers appear controlled, but there is no guard.
- **Fix:** Validate `name` against an allowlist or a regex in `incrementCounter` and `recordLatency`, or document that only static string literals should be passed.

---

## FINDING-10 [P2] `persona-memory-policy.ts` — individual fact/summary strings have no size cap

- **File:** `apps/api/src/persona-memory-policy.ts:62-87,226-238`
- **Issue:** `trimUniqueStrings` and `upsertArchivalSummaries` do not limit the length of individual string values. An LLM-generated fact of 10 KB will be stored verbatim in the archival store, bloating the JSON file. The `archivalFactsLimit` caps count (max 2000 facts) but not per-fact byte size. At 2000 facts × 10 KB = 20 MB per persona file.
- **Fix:** In `trimUniqueStrings`, truncate each string to a max length (e.g. 500 chars) before storing. In `upsertArchivalSummaries`, truncate the `summary` argument. Add `maxFactLengthChars` and `maxSummaryLengthChars` to `PersonaMemoryPolicy`.

---

## Summary Table

| # | Severity | File | Area |
|---|----------|------|------|
| 1 | P0 | composition-store.ts:248 | Blocking sync I/O on hot write path |
| 2 | P0 | composition-store.ts:60 | Unbounded compositions Map |
| 3 | P1 | ws-conversation-router.ts:258 | Unbounded ttsQueues Map |
| 4 | P1 | ws-conversation-router.ts:257 | Unbounded personaMemoryLocks chain |
| 5 | P1 | composition-store.ts:245 | No file-size limit on composition JSON |
| 6 | P1 | persona-memory-store.ts:217 | O(n) full dir scan on nick-only load |
| 7 | P2 | composition-store.ts:7,253 | Sync I/O at module import, errors silenced |
| 8 | P2 | ws-conversation-router.ts:482 | No per-message size limit |
| 9 | P2 | perf.ts:66 | Unbounded counter/metric label map |
| 10 | P2 | persona-memory-policy.ts:62 | No per-fact/summary string size cap |

---

## Fixes Implemented

The following fixes were applied directly to source files and verified with `npm run build && node --test`:

### FINDING-1 (P0) — `composition-store.ts`
- `saveComposition` rewritten as `async function saveComposition(): Promise<void>` using `fs/promises.mkdir` + `fs/promises.writeFile`.
- All callers now fire-and-forget with `.catch(logger.error)`.
- Startup `readdirSync` loop now logs individual parse errors instead of swallowing all errors.
- `fs.mkdirSync` at module level removed; moved into the startup try/catch block.

### FINDING-2 (P0) — `composition-store.ts`
- Added `MAX_COMPOSITIONS = process.env.KXKM_MAX_COMPOSITIONS || 500` constant.
- `createComposition` returns `Composition | undefined` and short-circuits when `compositions.size >= MAX_COMPOSITIONS`.
- All callers in `ws-commands-compose.ts` and `ws-commands-generate.ts` updated with explicit null guards.

### FINDING-5 (P1, bundled with FINDING-2) — `composition-store.ts`
- Added `MAX_COMPOSITION_BYTES = process.env.KXKM_MAX_COMPOSITION_BYTES || 524288` (512 KB).
- `saveComposition` now checks serialized length before writing and logs a warning + returns early if exceeded.
- Added `MAX_TRACKS_PER_COMPOSITION = process.env.KXKM_MAX_TRACKS || 100`.
- `addTrack` enforces the per-composition track limit.

### FINDING-3 (P1) — `ws-conversation-router.ts`
- `enqueueTTS`: promise chain now self-cleans via `.finally(() => { if (ttsQueues.get(nick) === cleanup) ttsQueues.delete(nick); })`.

### FINDING-4 (P1) — `ws-conversation-router.ts`
- `scheduleMemoryUpdate`: added `.finally()` that resets the map slot to `Promise.resolve()` once settled, preventing unbounded promise chain growth.

### Test impact
- `composition-store.test.ts`: added `assert.ok(comp)` guards after each `createComposition` call; added 50-100ms waits in tests that read back from disk (needed because `saveComposition` is now async).
- Build: clean (0 TS errors).
- Tests: **278 pass, 0 fail**.
