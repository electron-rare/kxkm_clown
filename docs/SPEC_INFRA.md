# SPEC_INFRA -- Infrastructure Specification

> **Project:** 3615-KXKM (kxkm_clown)
> **Last updated:** 2026-03-20
> **Target:** Single GPU host (RTX 4090, Ubuntu 24.04)

---

## Table of Contents

1. [Docker Compose Services](#1-docker-compose-services)
2. [Systemd User Units](#2-systemd-user-units)
3. [Deployment Flow](#3-deployment-flow)
4. [VRAM Management](#4-vram-management)
5. [Monitoring](#5-monitoring)
6. [Environment Variables](#6-environment-variables)
7. [Backup & Retention](#7-backup--retention)
8. [Deployment Diagram](#8-deployment-diagram)

---

## 1. Docker Compose Services

The `docker-compose.yml` defines **12 services** across 5 profiles. Default (no profile) starts only PostgreSQL. Profiles control which services are brought up.

### Profiles

| Profile | Services activated |
|---|---|
| *(none)* | `postgres` |
| `v1` | `app` |
| `v2` | `api`, `worker`, `searxng`, `chatterbox`, `tts-sidecar`, `docling`, `lightrag` |
| `ollama` | `ollama` |
| `discord` | `discord-bot` |
| `discord-voice` | `discord-voice` |

### Service Table

| # | Service | Image / Build | Port(s) | Profile | Network | Healthcheck | Volumes | Key Env |
|---|---------|--------------|---------|---------|---------|-------------|---------|---------|
| 1 | **postgres** | `postgres:16-alpine` | `${PG_PORT:-5432}:5432` | *(always)* | bridge | `pg_isready -U kxkm -d kxkm_clown` (5s/3s/5r) | `pg-data:/var/lib/postgresql/data` | `POSTGRES_USER=kxkm`, `POSTGRES_DB=kxkm_clown` |
| 2 | **app** (V1) | Dockerfile (local build) | `${APP_PORT:-3333}:3333` | `v1` | bridge | `fetch('/api/ping')` (15s/5s/3r) | `app-data:/app/data` | `common-env`, `PORT=3333`, `MAX_GENERAL_RESPONDERS` |
| 3 | **api** (V2) | Dockerfile (local build) | 3333 (via host) | `v2` | **host** | `fetch('/api/v2/health')` (15s/5s/3r) | `./data:/app/data`, `./scripts:/app/scripts:ro` | `V2_API_PORT`, `TTS_ENABLED=0`, `VISION_MODEL`, `LIGHTRAG_URL`, `TTS_URL`, `DOCLING_URL`, `RERANKER_URL`, RAG params |
| 4 | **worker** | Dockerfile (local build) | *(none)* | `v2` | **host** | *(none)* | `/home/kxkm/venv:ro` | `PYTHON_BIN`, `TRAINING_TIMEOUT_MS`, `SCRIPTS_DIR` |
| 5 | **ollama** | `ollama/ollama:latest` | `${OLLAMA_PORT:-11434}:11434` | `ollama` | bridge | *(none)* | `ollama-data:/root/.ollama` | *(none)* |
| 6 | **searxng** | `searxng/searxng:latest` | `${SEARXNG_PORT:-8080}:8080` | `v2` | bridge | `wget --spider localhost:8080` (30s/5s/3r) | `./ops/v2/searxng:/etc/searxng:ro` | `SEARXNG_BASE_URL` |
| 7 | **discord-bot** | Dockerfile (local build) | *(none)* | `discord` | **host** | *(none)* | *(none)* | `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `KXKM_WS_URL` |
| 8 | **discord-voice** | Dockerfile (local build) | *(none)* | `discord-voice` | **host** | *(none)* | `/home/kxkm/venv:ro` | `DISCORD_BOT_TOKEN`, `DISCORD_VOICE_CHANNEL`, `PYTHON_BIN` |
| 9 | **chatterbox** | `ghcr.io/devnen/chatterbox-tts-server:latest` | `${CHATTERBOX_PORT:-9200}:8004` | `v2` | bridge | `urlopen('localhost:8004/get_predefined_voices')` (30s/10s/3r, start 60s) | `./data/voice-samples:/app/voices:ro` | *(none)* |
| 10 | **tts-sidecar** | Dockerfile (local build) | 9100 (via host) | `v2` | **host** | *(none)* | `./data:/app/data`, `./scripts:/app/scripts:ro` | `CHATTERBOX_URL`, `PIPER_VOICE_DIR`, `KXKM_VOICE_SAMPLES_DIR` |
| 11 | **docling** | `ghcr.io/docling-project/docling-serve:latest` | `9400:5001` | `v2` | bridge | `urlopen('localhost:5001/health')` (30s/10s/3r, start 120s) | *(none)* | `DOCLING_SERVE_ENABLE_UI=1` |
| 12 | **lightrag** | Inline Dockerfile (`python:3.12-slim` + `lightrag-hku[api]`) | 9621 (via host) | `v2` | **host** | `urlopen('localhost:9621/health')` (30s/10s/3r, start 30s) | `./data/lightrag:/data/lightrag` | `LLM_MODEL=qwen3:8b`, `EMBEDDING_MODEL=nomic-embed-text`, `EMBEDDING_DIM=768`, `LLM_BINDING=ollama` |

### Network Mode Details

Services using `network_mode: host` bypass Docker networking entirely and bind directly to the host network stack. This is used for:

- **api** -- needs direct access to Ollama (localhost:11434), LightRAG (localhost:9621), Reranker (localhost:9500), TTS (localhost:9100)
- **worker** -- needs Ollama and PostgreSQL on localhost
- **tts-sidecar** -- proxies to Chatterbox on localhost:9200
- **lightrag** -- needs Ollama on localhost:11434
- **discord-bot** / **discord-voice** -- connect to API WS on localhost:3333

Services on bridge network use the `x-extra-hosts` anchor (`host.docker.internal:host-gateway`) to reach host services.

### GPU Passthrough

- **worker**: `deploy.resources.reservations.devices` with `driver: nvidia, count: all` -- used for ML training (Unsloth, TRL)
- **chatterbox**: `driver: nvidia, count: 1` -- used for Chatterbox TTS GPU inference

### Named Volumes

| Volume | Purpose |
|---|---|
| `pg-data` | PostgreSQL data directory |
| `app-data` | V1 app persistent data |
| `ollama-data` | Ollama model cache (only with `--profile ollama`) |

---

## 2. Systemd User Units

Four services and two timers run as **systemd user units** under the `kxkm` user (outside Docker). These are native processes that need direct GPU/venv access.

### Services

| Unit | Purpose | Port | Restart | Notes |
|---|---|---|---|---|
| `kxkm-tts.service` | TTS sidecar (Piper fallback, native) | 9100 | on-failure | Uses host Python venv, Piper voices in `data/piper-voices` |
| `kxkm-lightrag.service` | LightRAG graph RAG server | 9621 | on-failure | Python 3.12, `lightrag-hku[api]`, Ollama backend |
| `kxkm-reranker.service` | Cross-encoder reranker for RAG | 9500 | on-failure | Sentence-transformers model |
| `kxkm-qwen3-tts.service` | Qwen3-TTS expressive voice synthesis | 9300 | no | **On-demand only** -- started/stopped by API, 5min idle timeout, GPU-heavy |

### Timers

| Unit | Schedule | Script | Purpose |
|---|---|---|---|
| `kxkm-ollama-warmup.timer` | Every **25 minutes** | `scripts/ollama-warmup.sh` | Preload 3 models into VRAM with `keep_alive=30m`; the 25min interval ensures models never evict (30min TTL) |
| `kxkm-cleanup.timer` | **Daily** | `scripts/cleanup-logs.sh` | Delete chat logs older than 30 days; trim persona memory files exceeding 100KB |

### Log Rate Limiting

Systemd user journal is configured with rate limiting to prevent log flooding from high-throughput services:

```ini
# ~/.config/systemd/user.conf.d/ or per-unit override
[Journal]
RateLimitIntervalSec=30s
RateLimitBurst=1000
```

The `deploy.sh` script monitors journal disk usage after each deploy (`journalctl --user --disk-usage`).

---

## 3. Deployment Flow

Deployment is orchestrated by `scripts/deploy.sh`, which builds locally, syncs to the remote host, rebuilds on remote, and hot-deploys into the running Docker container.

### Invocation

```bash
bash scripts/deploy.sh [--full|--web|--api|--tts]
```

| Mode | Scope |
|---|---|
| `--full` (default) | Web + API + scripts + infra + TTS + LightRAG + Reranker + Qwen3-TTS |
| `--web` | Web frontend only |
| `--api` | API backend only |
| `--tts` | TTS service restart only |

### Step-by-Step Flow

1. **Local type-check** -- `npx tsc --noEmit` for both `apps/api` and `apps/web`
2. **Local build** -- `npm run -w @kxkm/web build` and `npm run -w @kxkm/api build`
3. **Rsync to remote** -- Syncs `apps/web/src/`, `apps/api/src/`, `scripts/`, `Dockerfile`, `docker-compose.yml` to `/home/kxkm/KXKM_Clown` on `kxkm@kxkm-ai`
4. **Remote build** -- `npx tsc -b tsconfig.v2.json`, workspace builds for web and API
5. **Docker hot-deploy** -- `docker cp` of `apps/web/dist/` and `apps/api/dist/` into the running `kxkm_clown-api-1` container, then `docker restart`
6. **Systemd restarts** (conditional by mode):
   - `kxkm-tts.service` (with health check at `:9100/health`)
   - `kxkm-lightrag.service` (with health check at `:9621/health`)
   - `kxkm-reranker.service` (with health check at `:9500/health`)
   - `kxkm-qwen3-tts.service` (only if already active -- on-demand)
7. **Health check** -- `curl localhost:3333/api/v2/health`
8. **Status report** -- `docker compose --profile v2 ps` + journal disk usage

### Docker Image Build Strategy

The `Dockerfile` uses a **pre-built artifacts** strategy:

- **No `npm run build` inside Docker** -- all `dist/` directories are built on the host before `COPY`
- Base image: `node:22-bookworm-slim`
- System deps installed: `python3`, `python3-pip`, `ffmpeg`, `tini`, `ca-certificates`
- Python packages: `piper-tts`, `pathvalidate`, `torch` (CPU-only via `--index-url cpu`), `transformers`, `accelerate`, `scipy`
- Node deps: `npm ci --omit=dev --ignore-scripts`
- Entrypoint: `tini --` (PID 1 signal handling)
- Default CMD: `node server.js` (V1); overridden by compose for V2 (`node apps/api/dist/server.js`)

The hot-deploy path (`docker cp` + `docker restart`) avoids full image rebuilds for code-only changes, keeping deploy time under 30 seconds.

---

## 4. VRAM Management

### Hardware

- **GPU:** NVIDIA RTX 4090 (24 GB GDDR6X)
- **Host:** Ubuntu 24.04, Docker with NVIDIA Container Toolkit

### VRAM Budget Allocation

| Component | Model | VRAM | Residency |
|---|---|---|---|
| Ollama: qwen3:8b | Qwen3 8B (Q4_K_M) | ~6 GB | **Permanent** (keep_alive=30m, warmup every 25min) |
| Ollama: mistral:7b | Mistral 7B (Q4_K_M) | ~6 GB | **Permanent** (keep_alive=30m, warmup every 25min) |
| Ollama: nomic-embed-text | Nomic Embed v1.5 | ~0.8 GB | **Permanent** (keep_alive=30m, warmup every 25min) |
| Chatterbox TTS | Chatterbox v1 | ~4 GB | **Stopped** (TTS_ENABLED=0) |
| Qwen3-TTS | Qwen3-TTS (systemd) | ~8 GB | **On-demand** (start/stop, 5min idle auto-shutdown) |
| **Total (steady state)** | | **~12.8 GB** | 3 resident models |
| **Total (peak with Qwen3-TTS)** | | **~20.8 GB** | 4 models active |

### Warmup Strategy

The `kxkm-ollama-warmup.timer` fires every **25 minutes** and sends a minimal inference request to each of the 3 resident models with `keep_alive: "30m"`. Since the timer fires 5 minutes before the 30-minute Ollama eviction window, models are never unloaded from VRAM during normal operation.

```
Ollama keep_alive=30m  |<─────── 30 min ──────────>|
Warmup timer (25min)   |<──── 25 min ────>| fire
                                            ↑ resets keep_alive
```

### Chatterbox (Disabled)

Chatterbox is included in the `v2` profile but effectively disabled:
- `TTS_ENABLED=0` in the `api` environment prevents the API from calling TTS
- The container still starts (profile v2) but receives no traffic
- To reclaim ~4 GB VRAM: stop the container manually or remove from profile

### Qwen3-TTS (On-Demand)

- Managed by `kxkm-qwen3-tts.service` (systemd, not Docker)
- Started on-demand when expressive TTS is requested via `/compose` or voice commands
- Auto-stops after 5 minutes of idle (no requests)
- API endpoint: `http://localhost:9300/synthesize`
- Restart policy: none (intentional -- on-demand only)

---

## 5. Monitoring

### 5.1 health-check.sh (19 Checks)

`scripts/health-check.sh` is a TUI-based health checker with color output. It can run locally or remotely (`--remote kxkm@kxkm-ai`).

**Services (7 checks):**

| Check | Endpoint | Level |
|---|---|---|
| API V2 | `localhost:3333/api/v2/health` | Required |
| PostgreSQL | `docker exec pg_isready` | Required |
| Ollama | `localhost:11434/api/tags` | Required |
| SearXNG | `localhost:8080/search?q=test&format=json` | Warning |
| TTS Sidecar | `localhost:9100/health` | Warning |
| Chatterbox | `localhost:9200/health` | Warning |
| LightRAG | `localhost:9621/health` | Warning |

**Docker (1 check):**
- Container count (running)

**Data (5 checks):**
- Chat log file count (`data/chat-logs/v2-*.jsonl`)
- Context store channels (`data/context/*.jsonl`)
- Media images (`data/media/images/*.png`)
- Media audio (`data/media/audio/*.wav`)
- Persona memory files (`data/v2-local/persona-memory/*.json`, mirror legacy optionnel `data/persona-memory/*.json`)

**API Endpoints (4 checks):**
- Session login (`POST /api/session/login`)
- Personas list (`GET /api/personas`)
- Media images API (`GET /api/v2/media/images`)
- Node Engine overview (`GET /api/admin/node-engine/overview`)

**System (2 checks):**
- NVIDIA GPU (via `nvidia-smi` -- warning level)
- Disk usage (`df -h /` + `du -sh data/`)

Exit code: `0` if all required checks pass, `1` if any fail.

### 5.2 service-status.sh

`scripts/service-status.sh` provides a quick overview combining:

1. **Docker status** -- `docker compose --profile v2 ps` (name, status, ports)
2. **Systemd user units** -- status of `kxkm-tts`, `kxkm-lightrag`, `kxkm-reranker`, `kxkm-qwen3-tts`
3. **Journal disk usage** -- `journalctl --user --disk-usage`
4. **Health probes** -- curl checks for API, TTS, LightRAG, Reranker, Qwen3-TTS, SearXNG, Ollama

### 5.3 API Observability Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/v2/health` | Public | Enriched health: app name, storage mode, roles, uptime (seconds + human), Ollama status (model count), DB status (persona count), check latency in ms |
| `GET /api/v2/status` | Public | Operational status: persona count, active personas, graph count, running/queued runs |
| `GET /api/v2/perf` | Public | Latency percentiles per route: count, avgMs, **p50**, **p95**, **p99**, maxMs |
| `GET /api/v2/errors` | `ops:read` | Error telemetry: recent error list + aggregated error counts |

### 5.4 Health Response Schema

```json
{
  "ok": true,
  "data": {
    "app": "@kxkm/api",
    "storage": "postgres",
    "roles": ["admin", "editor", "operator", "viewer"],
    "uptime_sec": 86400,
    "uptime_human": "24h0m0s",
    "ollama": { "status": "ok", "models_loaded": 12 },
    "database": { "status": "ok", "personas": 15 },
    "health_check_ms": 42
  }
}
```

---

## 6. Environment Variables

Complete table of all environment variables used across docker-compose.yml, Dockerfile, and application code.

### Core Application

| Variable | Default | Set In | Description |
|---|---|---|---|
| `NODE_ENV` | `production` | compose, Dockerfile | Runtime environment |
| `PORT` | `3333` | Dockerfile | V1 app listening port |
| `V2_API_PORT` | `4180` (.env) / `3333` (compose) | compose | V2 API listening port |
| `HOST` | `0.0.0.0` | Dockerfile | Bind address |
| `WEB_DIST_PATH` | `/app/apps/web/dist` | compose (api) | Path to built React frontend |
| `DEBUG` | *(unset)* | manual | Set to `1` for verbose logging |
| `LOG_LEVEL` | `info` | manual | Pino log level (`debug`, `info`, `warn`, `error`) |
| `KXKM_LOCAL_DATA_DIR` | `data` / `data/v2-local` | code | Override data directory path |
| `DATA_DIR` | `./data` | code (media-store) | Media storage root |

### Database

| Variable | Default | Set In | Description |
|---|---|---|---|
| `DATABASE_URL` | `postgres://kxkm:kxkm@localhost:5432/kxkm_clown` | compose | PostgreSQL connection string |
| `POSTGRES_USER` | `kxkm` | compose (postgres) | PG superuser |
| `POSTGRES_PASSWORD` | `kxkm` | compose (postgres) | PG password |
| `POSTGRES_DB` | `kxkm_clown` | compose (postgres) | PG database name |

### Ollama / LLM

| Variable | Default | Set In | Description |
|---|---|---|---|
| `OLLAMA_URL` | `http://host.docker.internal:11434` (bridge) / `http://localhost:11434` (host) | compose | Ollama API base URL |
| `VISION_MODEL` | `qwen3-vl:8b` | compose (api) | Ollama model for image analysis |
| `MAX_GENERAL_RESPONDERS` | `4` | compose (app/api) | Max personas responding in #general channel |

### RAG

| Variable | Default | Set In | Description |
|---|---|---|---|
| `LIGHTRAG_URL` | `http://localhost:9621` | compose (api) | LightRAG server URL |
| `RERANKER_URL` | `http://localhost:9500` | compose (api) | Cross-encoder reranker URL |
| `RAG_CHUNK_SIZE` | `500` | compose (api) | Text chunk size for RAG indexing (chars) |
| `RAG_MIN_SIMILARITY` | `0.3` | compose (api) | Minimum cosine similarity threshold |
| `RAG_MAX_RESULTS` | `3` | compose (api) | Maximum RAG results returned |
| `RAG_EMBEDDING_MODEL` | `nomic-embed-text` | compose (api) | Ollama embedding model name |

### LightRAG Server

| Variable | Default | Set In | Description |
|---|---|---|---|
| `LLM_MODEL` | `qwen3:8b` | compose (lightrag) | LLM for graph construction |
| `EMBEDDING_MODEL` | `nomic-embed-text` | compose (lightrag) | Embedding model |
| `EMBEDDING_DIM` | `768` | compose (lightrag) | Embedding vector dimension |
| `OLLAMA_HOST` | `http://localhost:11434` | compose (lightrag) | Ollama endpoint for LightRAG |
| `LLM_BINDING` | `ollama` | compose (lightrag) | LLM provider binding |
| `EMBEDDING_BINDING` | `ollama` | compose (lightrag) | Embedding provider binding |
| `RAG_DIR` | `/data/lightrag` | compose (lightrag) | LightRAG working directory |

### TTS / Voice

| Variable | Default | Set In | Description |
|---|---|---|---|
| `TTS_ENABLED` | `0` | compose (api) | Enable TTS pipeline (`0` = disabled, `1` = enabled) |
| `TTS_URL` | `http://localhost:9100` | compose (api) | TTS sidecar endpoint |
| `QWEN3_TTS_URL` | `http://127.0.0.1:9300` | code | Qwen3-TTS endpoint (on-demand) |
| `CHATTERBOX_URL` | `http://127.0.0.1:9200` | compose (tts-sidecar) | Chatterbox GPU TTS backend |
| `PIPER_VOICE_DIR` | `/app/data/piper-voices` | compose (api, tts-sidecar) | Directory for Piper voice models |
| `KXKM_VOICE_SAMPLES_DIR` | `/app/data/voice-samples` | compose (tts-sidecar) | Voice cloning reference samples |
| `COQUI_TOS_AGREED` | `1` | compose (api) | Accept Coqui TOS for voice cloning |

### ML / Training

| Variable | Default | Set In | Description |
|---|---|---|---|
| `PYTHON_BIN` | `/home/kxkm/venv/bin/python3` | compose (worker) | Python binary with ML stack (PyTorch, Unsloth, TRL) |
| `SCRIPTS_DIR` | `/app/scripts` | compose (api, worker) | Path to Python scripts directory |
| `TRAINING_TIMEOUT_MS` | `3600000` (1 hour) | compose (worker) | Maximum training job duration |

### Document Processing

| Variable | Default | Set In | Description |
|---|---|---|---|
| `DOCLING_URL` | `http://localhost:9400` | compose (api) | Docling document parsing endpoint |
| `DOCLING_SERVE_ENABLE_UI` | `1` | compose (docling) | Enable Docling web UI |

### Image Generation

| Variable | Default | Set In | Description |
|---|---|---|---|
| `COMFYUI_URL` | `https://stable2.kxkm.net` | code | ComfyUI API endpoint for `/imagine` |
| `COMFYUI_CHECKPOINT` | `sdxl_lightning_4step.safetensors` | code | Stable Diffusion checkpoint model |

### Admin / Auth

| Variable | Default | Set In | Description |
|---|---|---|---|
| `ADMIN_BOOTSTRAP_TOKEN` | *(empty)* | compose (app, api) | Initial admin authentication token |
| `ADMIN_TOKEN` | *(empty)* | code | Runtime admin token for privileged operations |
| `ADMIN_ALLOWED_SUBNETS` | *(empty)* | compose (app, api) | CIDR subnets for admin access restriction |
| `OWNER_NICK` | *(empty)* | compose (app) | Owner nickname displayed in chat |

### Discord

| Variable | Default | Set In | Description |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | *(empty)* | compose (discord-bot, discord-voice) | Discord bot authentication token |
| `DISCORD_CHANNEL_ID` | *(empty)* | compose (discord-bot) | Text channel to bridge with KXKM chat |
| `DISCORD_VOICE_CHANNEL_ID_2` | *(empty)* | compose (discord-voice) | Voice channel for STT/TTS bridge |
| `KXKM_WS_URL` | `ws://localhost:3333/ws` | compose (discord-bot, discord-voice) | KXKM WebSocket endpoint |

### Ports (Host Mapping)

| Variable | Default | Set In | Description |
|---|---|---|---|
| `APP_PORT` | `3333` | compose | V1 app host port |
| `API_PORT` | `3333` (compose) / `4180` (.env) | compose | V2 API host port |
| `PG_PORT` | `5432` | compose | PostgreSQL host port |
| `OLLAMA_PORT` | `11434` | compose | Ollama host port (profile ollama only) |
| `SEARXNG_PORT` | `8080` | compose | SearXNG host port |
| `CHATTERBOX_PORT` | `9200` | compose | Chatterbox host port |

### SearXNG

| Variable | Default | Set In | Description |
|---|---|---|---|
| `SEARXNG_BASE_URL` | `http://localhost:8080/` | compose (searxng) | SearXNG public base URL |
| `WEB_SEARCH_API_BASE` | *(empty)* | compose (app) | Web search API base (set to SearXNG URL) |
| `SEARXNG_URL` | `http://localhost:8080` | code | SearXNG URL used in web-search module |

---

## 7. Backup & Retention

### Chat Logs (30-day Retention)

- **Format:** JSONL files at `data/chat-logs/v2-*.jsonl`
- **Retention:** Files older than 30 days are deleted by `scripts/cleanup-logs.sh`
- **Schedule:** Daily via `kxkm-cleanup.timer` (systemd user timer)
- **Mechanism:** `find data/chat-logs -name "*.jsonl" -mtime +30 -delete`

### Persona Memory (100 KB Trim)

- **Format:** JSON files at `data/v2-local/persona-memory/*.json` with optional legacy mirror `data/persona-memory/*.json`
- **Threshold:** Files exceeding 100 KB (102,400 bytes) are trimmed
- **Strategy:** Keep runtime caps only (`workingMemory.facts[-20:]`, `workingMemory.lastSourceMessages[-10:]`, `archivalMemory.facts[-100:]`, `archivalMemory.summaries[-50:]`, `compat.facts[-20:]`) unless overridden by `KXKM_PERSONA_MEMORY_*`
- **Schedule:** Same daily timer as chat log cleanup

### Context Store (Auto-Compaction)

- **Format:** JSONL files at `data/context/*.jsonl`
- **Compaction:** Triggered automatically via LLM summarization when context grows too large
- **No external timer** -- managed internally by the context-store module

### PostgreSQL

- **Volume:** `pg-data` Docker named volume
- **No automated backup** in current infra -- manual `pg_dump` recommended
- **Data:** Personas, sessions, node-engine graphs/runs

### LightRAG Knowledge Graph

- **Location:** `data/lightrag/` (bind mount)
- **Persistence:** Survives container restarts via bind mount
- **No automated backup** -- knowledge is rebuilt from documents if lost

---

## 8. Deployment Diagram

```mermaid
graph TB
    subgraph DEV["Developer Machine"]
        SRC[Source Code]
        BUILD["`npm build
        tsc --noEmit`"]
        SRC --> BUILD
    end

    BUILD -->|"rsync (src, scripts, infra)"| REMOTE

    subgraph REMOTE["kxkm-ai (RTX 4090, Ubuntu 24.04)"]

        subgraph DOCKER["Docker Compose (profile v2)"]
            API["api (V2)<br/>:3333<br/>network: host"]
            WORKER["worker<br/>network: host<br/>GPU: all"]
            PG["postgres:16<br/>:5432"]
            SEARX["searxng<br/>:8080"]
            CHATTER["chatterbox<br/>:9200<br/>GPU: 1<br/>(disabled)"]
            TTSSIDECAR["tts-sidecar<br/>:9100<br/>network: host"]
            DOCLING["docling<br/>:9400"]
            LIGHTRAG_D["lightrag<br/>:9621<br/>network: host"]
        end

        subgraph SYSTEMD["Systemd User Units"]
            TTS_S["kxkm-tts<br/>:9100"]
            LRAG_S["kxkm-lightrag<br/>:9621"]
            RERANK["kxkm-reranker<br/>:9500"]
            QWEN3["kxkm-qwen3-tts<br/>:9300<br/>(on-demand)"]
            WARMUP["kxkm-ollama-warmup<br/>.timer (25min)"]
            CLEANUP["kxkm-cleanup<br/>.timer (daily)"]
        end

        subgraph NATIVE["Native Services"]
            OLLAMA["Ollama<br/>:11434<br/>(native, not Docker)"]
            GPU["RTX 4090<br/>24 GB VRAM"]
        end

        subgraph DATA["Persistent Data"]
            PGVOL["pg-data (volume)"]
            APPDATA["./data (bind mount)"]
        end

        API -->|localhost| OLLAMA
        API -->|localhost| PG
        API -->|localhost:9100| TTS_S
        API -->|localhost:9621| LRAG_S
        API -->|localhost:9500| RERANK
        API -->|localhost:9300| QWEN3
        WORKER -->|GPU training| GPU
        WARMUP -->|"keep_alive=30m"| OLLAMA
        OLLAMA --> GPU
        QWEN3 --> GPU
        PG --> PGVOL
        API --> APPDATA
        CLEANUP -->|"prune >30d"| APPDATA
    end

    subgraph CLIENTS["Clients"]
        WEB["Web Browser<br/>React SPA"]
        DISCORD_C["Discord"]
    end

    WEB -->|"HTTP/WS :3333"| API
    DISCORD_C -->|"Discord API"| REMOTE
```

### Port Map Summary

```
:3333   API V2 (HTTP + WebSocket + static React SPA)
:5432   PostgreSQL
:8080   SearXNG (web search)
:9100   TTS Sidecar (Piper + Chatterbox proxy)
:9200   Chatterbox GPU TTS (disabled)
:9300   Qwen3-TTS (on-demand, systemd)
:9400   Docling (document parsing)
:9500   Reranker (cross-encoder, systemd)
:9621   LightRAG (graph RAG, systemd)
:11434  Ollama (native, LLM inference)
```
