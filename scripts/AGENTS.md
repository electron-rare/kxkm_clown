# AGENTS.md — scripts/

<!-- Parent: ../AGENTS.md -->

42 files (20 Python + 22 Shell) organized by domain: ops, training, ingestion, voice, image, deployment.

## Ops & Monitoring (8 files)

| File | Type | Purpose |
|------|------|---------|
| `health-check.sh` | Shell | 19 checks (API, DB, Ollama, TTS, LightRAG, docker) with color output |
| `deep-audit.js` | Node | Comprehensive audit: hot spots, error rates, perf p50/p95/p99, GPU VRAM, memory leaks |
| `ops-tui.sh` | Shell | Interactive ops menu (deploy, restart services, logs, cleanup) |
| `service-status.sh` | Shell | systemd service status (kxkm-tts, kxkm-lightrag, kxkm-api) |
| `health-doc-search.sh` | Shell | LightRAG embedding health check |
| `health-embeddings.sh` | Shell | Ollama embedding model health |
| `health-voice-clone.sh` | Shell | TTS voice clone model check |
| `journald-monitor.sh` | Shell | Tail systemd logs with filtering (error, warning) |

## Deployment (5 files)

| File | Type | Purpose |
|------|------|---------|
| `deploy.sh` | Shell | Systemd service deployment (kxkm-api, kxkm-tts, kxkm-lightrag), auto-restart on fail |
| `rollback-v2.js` | Node | Rollback to previous version (git revert + service restart) |
| `setup-voice-clone.sh` | Shell | Download XTTS-v2 model, configure TTS |
| `qwen3-tts-ondemand.sh` | Shell | Start on-demand TTS server (not systemd) |
| `ollama-import-adapter.sh` | Shell | Import fine-tuned models into Ollama, register in registry.json |

## Training (7 files)

| File | Type | Purpose |
|------|------|---------|
| `train_unsloth.py` | Python | Unsloth fine-tuning pipeline: SFT or DPO, load persona-specific dataset, save to models/finetuned/ |
| `eval_model.py` | Python | Evaluate model: perplexity, BLEU, custom benchmarks, compare against baseline |
| `dpo-pipeline.js` | Node | DPO pair collection automation: fetch feedback from DB, format pairs, trigger training |
| `dpo-export.sh` | Shell | Export DPO pairs to JSONL for analysis |
| `orchestrate_batches.py` | Python | Batch orchestration: schedule training jobs across GPU, queue management |
| `migrate-persona-store-v2.js` | Node | Data migration: v1 persona memory → v2 nick-isolated structure |
| `parity-check.js` | Node | V1 ↔ V2 behavior parity validation |

## Ingestion & RAG (5 files)

| File | Type | Purpose |
|------|------|---------|
| `ingest_spectacle_corpus.py` | Python | LightRAG corpus ingestion: seed URLs + SearXNG discovery + sherlock-discovered-urls.jsonl, Camoufox for bot-protected sites |
| `extract_pdf_docling.py` | Python | Extract text/tables from PDFs via Docling, chunk for embedding |
| `reranker-server.py` | Python | BGE-M3 reranker service (listen :8090) for LightRAG results |
| `generate_image.py` | Python | ComfyUI image generation wrapper (checkpoint + LoRA selection, queue submission) |
| `generate-persona-dialogues.js` | Node | Generate synthetic persona dialogues for DPO training |

## Voice & Audio (5 files)

| File | Type | Purpose |
|------|------|---------|
| `tts-server.py` | Python | Dual TTS backend (Piper + Chatterbox) on :9100, HTTP API |
| `qwen3-tts-server.py` | Python | Qwen3 TTS server alternative (on-demand) |
| `tts_synthesize.py` | Python | Batch TTS synthesis: text → WAV, save to media-store |
| `tts_clone_voice.py` | Python | Voice cloning: sample ingestion, XTTS-v2 fine-tune, register voice |
| `generate-voice-samples.js` | Node | Generate persona voice samples (read persona bio via TTS) |

## Testing & Validation (5 files)

| File | Type | Purpose |
|------|------|---------|
| `run-playwright-e2e.sh` | Shell | Run Playwright E2E tests (login, chat, upload, admin) |
| `test-e2e.js` | Node | E2E test runner (WebDriver + assertions) |
| `test-v2.js` | Node | V2 integration tests (API + WS) |
| `smoke-test.sh` | Shell | Quick smoke: API health, DB connect, Ollama respond |
| `smoke-v2.js` | Node | V2 smoke: WS chat, inference, persona memory |

## Utilities (5 files)

| File | Type | Purpose |
|------|------|---------|
| `chat-pause.sh` | Shell | Pause chat (set CHAT_PAUSED env var or create data/chat-paused file) |
| `cleanup-logs.sh` | Shell | Rotate + compress logs older than 7 days, purge after 30 days |
| `cleanup-test-compositions.js` | Node | Delete test composition artifacts |
| `ollama-warmup.sh` | Shell | Pre-load LLM models into Ollama memory (avoid cold start) |
| `sudo-optimize.sh` | Shell | System optimization (disable swap, tune kernel params) |

## Specialized (2 files)

| File | Type | Purpose |
|------|------|---------|
| `transcribe_audio.py` | Python | Batch audio → text via OpenAI Whisper or ElevenLabs Scribe |
| `xtts_clone.py` | Python | XTTS-v2 voice cloning (wrapper) |

## Integration & Agent Scripts (4 files)

| File | Type | Purpose |
|------|------|---------|
| `v2-agent-task.js` | Node | Execute agent task from PLAN.md (sync, run, log) |
| `v2-autoresearch-loop.js` | Node | Continuous autoresearch: fetch OSS projects, benchmark, report |
| `v2-dpo-pipeline.js` | Node | Automated DPO: feedback → pairs → training trigger → registry update |
| `discord-pharmacius.js` | Node | Discord bot integration (Pharmacius agent) |

## Data Scripts (1 file)

| File | Type | Purpose |
|------|------|---------|
| `patch-plan.py` | Python | Update PLAN.md lot state (experimental, use git instead) |

## Pattern: npm run scripts

All scripts in `package.json`:

```json
{
  "scripts": {
    "health:v2": "bash scripts/health-check.sh",
    "audit:deep": "node scripts/deep-audit.js",
    "deploy": "bash scripts/deploy.sh",
    "train": "python scripts/train_unsloth.py",
    "test:e2e": "bash scripts/run-playwright-e2e.sh"
  }
}
```

## Run Examples

```bash
npm run health:v2              # Run health checks
node scripts/deep-audit.js     # Deep system audit
bash scripts/deploy.sh         # Deploy systemd services
python scripts/train_unsloth.py --dpo --model qwen-14b  # Train
bash scripts/run-playwright-e2e.sh                       # E2E tests
bash scripts/health-check.sh   # 19-point health check
```

## Environment Variables (scripts expect)

```bash
LLM_URL=http://localhost:11434
DATABASE_URL=postgres://kxkm:kxkm@localhost:5432/kxkm_clown
SEARXNG_URL=http://localhost:8080
LIGHTRAG_URL=http://localhost:9621
TTS_URL=http://localhost:9100
CAMOUFOX_URL=http://localhost:8091
DISCORD_TOKEN=xxx  # For discord-pharmacius.js
```

## Conventions

- **Exit codes**: 0 = success, 1 = error, 2 = skipped
- **Output**: JSON for machine parsing (health-check.sh, deep-audit.js), human-readable tables for TUI
- **Logging**: scripts/logs/*.log (rotated daily by cleanup-logs.sh)
- **Data**: ephemeral files in data/ (sherlock-discovered-urls.jsonl, chat-logs/, etc.)
