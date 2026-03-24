# Agents, Sous-agents, Competences

> "L'infrastructure est une decision politique deployee." -- electron rare

## Orchestration

- Agent racine: **Coordinateur** — planifie, arbitre, synchronise PLAN/TODO/docs
- Sous-agents specialises: analyse code, veille OSS, audit securite, optimisation
- Cadence: synchroniser PLAN.md + TODO.md + docs apres chaque lot

## Matrice des agents (lot 17+)

| Agent | Competences | Perimetre | Etat |
|---|---|---|---|
| Coordinateur | planification, arbitrage, docs de pilotage | PLAN.md, TODO.md, AGENTS.md, README.md | actif |
| Securite | validation input, hardening, rate-limit, RBAC | apps/api, ws-chat, packages/auth | veille |
| Backend API | Express, WS, Ollama, RAG, multimodal pipeline | apps/api/src/ | actif |
| Node Engine | DAG, queue, runs, sandbox, training adapters | packages/node-engine, apps/worker | actif |
| Personas | source/feedback/proposals/pharmacius, memoire | packages/persona-domain, ws-chat | actif |
| Frontend | React/Vite, UX Minitel, React Flow, chat, voice | apps/web/src/ | actif |
| Ops/TUI | scripts, logs, rotate/purge, health, audit | ops/v2/, scripts/ | actif |
| Training | DPO, SFT, Unsloth, eval, autoresearch, Ollama import | scripts/, packages/node-engine | actif |
| Multimodal | STT, TTS, vision, PDF, RAG, recherche web | apps/api/src/ws-chat.ts | actif |
| Veille OSS | recherche projets, libs, modeles, benchmarks | docs/OSS_WATCH, docs/HF_MODEL_RESEARCH | periodique |

## Sous-agents et skill routing

```mermaid
flowchart TD
    Coord[Coordinateur]

    Coord --> SecAgent[Securite]
    Coord --> BackAgent[Backend API]
    Coord --> EngAgent[Node Engine]
    Coord --> PersAgent[Personas]
    Coord --> FrontAgent[Frontend]
    Coord --> OpsAgent[Ops/TUI]
    Coord --> TrainAgent[Training]
    Coord --> MultiAgent[Multimodal]
    Coord --> OSSAgent[Veille OSS]

    SecAgent --> |audit| SecScan[Pattern scan P0/P1/P2]
    SecAgent --> |fix| SecFix[Correctifs chirurgicaux]

    BackAgent --> |analyse| APIAudit[Deep analyse app.ts, ws-chat.ts]
    BackAgent --> |refactor| APISplit[Extraction modules]

    EngAgent --> |test| EngTest[Tests unitaires node-engine]
    EngAgent --> |extend| EngNew[Nouveaux node types]

    PersAgent --> |pipeline| PersPipe[Editorial pipeline]
    PersAgent --> |finetune| PersDPO[DPO + PCL methodology]

    FrontAgent --> |ui| FrontUI[Minitel theme CSS]
    FrontAgent --> |perf| FrontPerf[Memoization, lazy load]

    OpsAgent --> |monitor| OpsHealth[health-check, deep-audit]
    OpsAgent --> |deploy| OpsDeploy[Docker, kxkm-ai]

    TrainAgent --> |train| TrainRun[Unsloth/TRL runs]
    TrainAgent --> |eval| TrainEval[Scoring, registry]

    MultiAgent --> |voice| MultiVoice[XTTS-v2, WebRTC]
    MultiAgent --> |search| MultiSearch[SearXNG]

    OSSAgent --> |web| OSSWeb[Recherche web]
    OSSAgent --> |hf| OSSHF[HuggingFace models]
```

## Todo agents (lot 17+ — mis a jour 2026-03-24)

### Coordinateur

- [x] Consolider PLAN.md avec etat reel (lots 0-94 complets)
- [x] Synchroniser FEATURE_MAP.md matrice
- [x] Mettre a jour TODO.md avec backlog Phase session 2026-03-19/20
- [x] Documenter actions dans ops/v2/logs/
- [x] lot-95: Coordonner E2E Playwright test plan
- [x] lot-100: Design public demo mode access control
- [ ] Audit SOTA 2026 intelligence + affectation agents par module

### Backend API

- [x] Extraire app-bootstrap.ts et app-middleware.ts de app.ts
- [x] Extraire ws-conversation-router.ts de ws-chat.ts
- [x] ws-chat.ts modularized (425 to 335 LOC, 3 modules extracted)
- [x] app.ts extraction (540 to 131 LOC, create-repos.ts extracted)
- [x] Zod validation on all 19 API route schemas
- [x] Error telemetry (16 labels)
- [x] Perf instrumentation (6 labels, p50/p95/p99), TTFC 284ms
- [x] Smart routing (5 topic domains)
- [x] Dynamic context window (4k-32k)
- [x] NLP auto-detect generation intent (compose vs imagine)
- [x] /speed command for latency diagnostics
- [ ] lot-192: ws-commands modular extraction phase 1 (`/comp`, `/layer`, `/mix`, `/voice`)
- [ ] lot-178: ACE-Step API direct integration (duration fix)
- [ ] lot-180: Timeline data model
- [x] lot-97: Multi-channel support (create/join channels)
- [x] lot-100: Public demo mode read-only routes

### Node Engine

- [x] Extraire registry.ts du hotspot node-engine
- [ ] Ajouter node type `music_generation` (ACE-Step 1.5)
- [ ] Ajouter node type `voice_clone` (Chatterbox)
- [ ] Ajouter node type `audio_mix` (multi-track composition)
- [ ] Ajouter node type `audio_effects` (FX chain)
- [ ] lot-96: Automated DPO pipeline (feedback → pairs → training trigger)

### Multimodal (composition pipeline)

- [x] 35 music styles ACE-Step
- [x] ComfyUI smart checkpoint selection (32 checkpoints + 24 LoRAs)
- [x] lot-184: Multi-track composition (/layer, composition-store)
- [x] lot-185: Composition UI (track lanes, play/pause/seek)
- [x] lot-186: Arrangement tools (/comp structure, section markers)
- [x] lot-187: Auto-mastering (/mix master, loudness normalization, limiter)
- [x] lot-188: /voice TTS voiceover injected into composition
- [x] lot-189: /noise 5 types (white, pink, brown, rain, wind)
- [x] lot-190: /fx 9 audio effects (reverb, delay, chorus, flanger, distortion, bitcrusher, EQ, compressor, tremolo)
- [x] lot-191: /ambient scene generator (forest, ocean, city, space, cave)
- [ ] lot-194: Waveform visualization (wavesurfer.js)
- [ ] lot-195: /remix re-generate specific track
- [ ] lot-199: Stem separation (Demucs v4 htdemucs, 6-stem, MIT)
- [x] lot-200: Full DAW export (WAV stems + JSON project)

### Personas

- [ ] Evaluer PCL (Persona-Aware Contrastive Learning) pour coherence
- [ ] Evaluer OpenCharacter pour generation profils synthetiques
- [x] Ajouter `/compose` command (generation musicale)

### Frontend

- [x] Implementer lot 16 UI Minitel rose (phosphore, VIDEOTEX)
- [x] VoiceChat push-to-talk + level meter + silence auto
- [x] Player audio + viewer image plein ecran
- [x] Mediatheque gallery/playlist
- [x] Progress bars animees Compose/Imagine
- [x] React.memo + useCallback on ChatSidebar, ChatInput, ChatHistory
- [x] 17 lazy-loaded routes (-53% initial JS)
- [x] CRT CSS-only effect (scanlines, vignette, phosphor glow, boot 0.8s)
- [x] Chat virtualization (react-window, variable row heights)
- [x] Markdown rendering (marked + DOMPurify)
- [x] CRT boot animation (modem dial, scanline reveal)
- [x] 5 CSS themes (minitel, crt, hacker, synthwave, default)
- [x] Mobile responsive pass (touch, bottom nav, viewport units)
- [x] Guest mode read-only UI
- [x] lot-185: Composition timeline UI (waveform view, track lanes)
- [ ] lot-194: Waveform visualization (wavesurfer.js)
- [x] lot-95: E2E Playwright tests (login, chat, upload, admin)
- [x] lot-98: File sharing UI (upload → gallery)

### Ops/TUI

- [x] Deployer deep-audit.js sur kxkm-ai
- [x] Ajouter SearXNG au docker-compose
- [x] TTS sidecar HTTP (tts-server.py :9100, dual Chatterbox/Piper)
- [x] deploy.sh migrated tmux → systemd
- [x] Systemd services (kxkm-tts + kxkm-lightrag, auto-restart)
- [x] health-check.sh TUI (19 checks)
- [x] Docker compose 12 services with health checks
- [ ] Fix Docker transformers (rebuild propre avec torch)

### Training

- [x] Spike BGE-M3 (resultat negatif sur Apple/Metal, baseline maintenue)
- [x] TTS dual backend Chatterbox/Piper valide
- [x] Tool-calling benchmark (llama3.1 vs qwen3 vs mistral)
- [x] Sherlock migrated to llama3.1:8b-instruct-q4_0
- [ ] lot-96: Persona DPO automation pipeline
- [ ] Tester ACE-Step 1.5 sur RTX 4090

### Veille OSS

- [x] Veille mars 2026 complete (40+ projets analyses, top 10 recommandations)
- [ ] Suivre LLMRTC (WebRTC voice TypeScript)
- [ ] Suivre A2A Protocol (interop agents)
- [ ] Suivre MCP SDK updates
- [ ] Evaluer Kokoro TTS (82M params, ultra-leger)

## Pipeline d'intervention

```mermaid
stateDiagram-v2
    [*] --> Analyse: agent lance
    Analyse --> Findings: scan code/docs/web
    Findings --> Triage: P0/P1/P2 classification
    Triage --> Fix_P0: P0 critique
    Triage --> Plan_P1: P1 important
    Triage --> Backlog_P2: P2 mineur
    Fix_P0 --> Test: correction chirurgicale
    Plan_P1 --> Test: correction planifiee
    Test --> Deploy: tests OK
    Deploy --> Log: log + purge
    Log --> [*]: cycle termine
    Backlog_P2 --> [*]: ajoute au TODO
```

## Affectations en cours (2026-03-20)

### Mission globale
- Deep analyse continue du code, optimisation chirurgicale, et synchronisation documentaire apres chaque lot.
- Priorite execution: P1 fiabilite, puis dette perf/complexite, puis features lot 18-19.

### Assignations agents -> sous-agents -> competences

| Agent | Sous-agent | Competences principales | Taches assignees immediates |
|---|---|---|---|
| Coordinateur | Planner/Docs | triage, synchronisation, runbook | Maintenir PLAN/TODO, chainer les lots, tracer actions |
| Backend API | WS/HTTP surgeon | websocket, express, validation input | Extraire `ws-chat.ts` en modules, reduire logs, limiter hot paths |
| Node Engine | DAG runtime | graph validation, queue, state machine | Ajouter nodes `music_generation`, `voice_clone`, `document_extraction` |
| Ops/TUI | Audit operator | TUI scripts, logs, rotation, cron | Rendre `deep-audit` zero faux positif critique, pipeline logs + purge |
| Veille OSS | Scout | benchmark OSS, licences, interop | Evaluer Open WebUI, LibreChat, LangGraph, SearXNG, Docling |

### Workflow d'enchainement
1. Executer audit + tests
2. Corriger de maniere chirurgicale
3. Re-executer audit + tests
4. Mettre a jour docs de pilotage
5. Alimenter TODO suivant avec ordre d'execution

### Regles d'operation
- Interroger le user uniquement en cas de blocage reel (acces, choix irreversibles, secrets).
- Privilegier TUI et scripts avec logs lisibles, puis purge des logs obsoletes.
- Conserver la V1 comme reference comportementale, V2 comme cible active.

### Etat de cycle (2026-03-20 22:00)

- 170+ lots termines (lot-24 a lot-191).
- 425 tests, 0 failures.
- 13 services en production.
- 53 chat commands, 33 personas.
- 35 music styles (ACE-Step), 9 audio effects, 5 CSS themes.
- Composition pipeline: multi-track, voice, noise, ambient, effects, mix.
- 32 ComfyUI checkpoints + 24 LoRAs, smart selection NLP.
- TTFC 284ms.
- Guest mode, mobile responsive.
- Structured logging complet (pino JSON, 0 console.log).
- Systemd services (TTS + LightRAG).
- Frontend: lazy routes (-53%), React.memo, CRT boot, chat virtualization.

### Prochains lots (192-200) — Composition Advanced

1. lot-192: ws-commands modular extraction
2. lot-193: Composition tests (unit tests composition-store, /fx)
3. lot-194: Waveform visualization (wavesurfer.js @wavesurfer/react)
4. lot-195: /remix re-generate specific track
5. lot-196: MIDI export from composition
6. lot-197: Composition templates (preset multi-track arrangements)
7. lot-198: Collaborative composition (multi-user, shared comp)
8. lot-199: Stem separation (Demucs v4 htdemucs, MIT, 6-stem)
9. lot-200: Full DAW export (WAV stems + JSON project file)

## Delta Session 2026-03-24

### Coordinateur
- [x] Audit SOTA 2026 intelligence + affectation agents par module
- [x] lot-552: cloture documentaire lot-192 + sync QA/veille OSS

### Backend API
- [x] lot-192: ws-commands modular extraction phases 1-3 (`/comp`, `/layer`, `/mix`, `/voice`, gestion composition, edition avancee)
- [ ] lot-549: renfort tests composition et export
## Delta Session 2026-03-24 — phase 3

### Backend API
- [x] lot-192: extraction complete du bloc compose avance (`/concat`, `/silence`, `/template`, `/marker`, `/metronome`, `/delete`, `/suggest`, `/snapshot`, `/randomize`)
- [x] lot-552: cloture documentaire et durcissement final lot-192
- [ ] lot-549: renfort tests composition et export
- [ ] lot-548: waveform timeline UI v1
## Affectations Session 2026-03-24 — suite immediate

| Lot | Agent pilote | Sous-agents / competences | Portee immediate |
|---|---|---|---|
| lot-549 | Backend API | Polyglot Test Agent, QA, context-map | Etendre `apps/api/src/ws-commands.test.ts` et `apps/api/src/composition-store.test.ts`, verifier non-regression composition |
| lot-548 | Frontend | Expert React Frontend Engineer, gem-browser-tester, context-map | Remplacer la waveform canvas par une timeline waveform plus lisible sans regression mobile |
| lot-552 | Coordinateur | Planner/Docs, gem-researcher, refactor-plan | Maintenir PLAN/TODO/AGENTS/QA/OSS alignes avec l'etat reel et tracer les prochains deltas |

## Skills privilegies

- context-map: cartographie des fichiers et dependances avant modification.
- refactor-plan: sequencing prudent des changements multi-fichiers.
- polyglot-test-agent: lot-549 pour la recherche, le plan et l'implementation de tests additionnels.
## Delta Session 2026-03-24 — validation compose + waveform

### Backend API
- [x] lot-549: renfort tests composition et export
- Validation ciblee: `tsx --test src/composition-store.test.ts src/ws-commands.test.ts` => 44/44 OK

### Frontend
- [x] lot-548: waveform timeline UI v1
- Implementation: `wavesurfer.js` branche dans `apps/web/src/components/ComposePage.tsx` pour apercu piste + bloc timeline
- Validation: `npm run check` dans `apps/web` OK
## Delta Session 2026-03-24 — cleanup compose

### Frontend
- [x] lot-553: suppression du doublon `apps/web/src/components/ComposePage 2.tsx`
- Validation: `npm run check` dans `apps/web` OK
- Impact: reduction dette technique UI compose et elimination d'un faux point d'entree potentiel
## Delta Session 2026-03-24 — QA visuelle compose

### Frontend
- [x] lot-554: validation Playwright ciblee compose timeline
- Commande: `npx playwright test e2e/visual-qa.spec.ts --project=chromium --grep "ComposePage|composition timeline"`
- Resultat: 2/2 OK