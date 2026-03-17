# PLAN

## Direction active

Refonte `V2` en parallèle de la `V1`, avec bascule finale.

Choix verrouillés:
- backend `Node.js`
- frontend `React/Vite`
- monorepo `apps/` + `packages/`
- cible produit `privé multi-utilisateur`
- `Node Engine` comme cœur d'orchestration de la V2

## V1 conservée

La V1 reste la base exploitable et la référence de comportement pour:
- chat multi-personas
- session admin cookie
- pipeline éditorial personas
- Node Engine local/async
- uploads multimodaux
- scripts `check`, `smoke`, `build`

## Lot 0 — Cadrage et gel V1 `[complété]`

Livré:
- architecture cible validée
- invariants V1/V2 explicités
- mémoire, spec, feature map, agents et README alignés
- orchestration batch/logs V2 ajoutée sous `ops/v2`
- squelette monorepo initial posé

## Lot 1 — Socle V2 `[complété]`

Livré:
- workspace TypeScript réel (`apps/web`, `apps/api`, `apps/worker`)
- packages TypeScript (`core`, `chat-domain`, `persona-domain`, `node-engine`, `auth`, `storage`, `ui`, `tui`)
- `check:v2` et `build:v2` intégrés aux scripts racine
- premier shell React/Vite
- premier backend V2
- premier worker V2

## Lot 2 — Code Quality V1 `[complété]`

Objectif: corriger les problèmes critiques identifiés lors de l'analyse de la base V1.

Livré:
- `escapeHtml` dédupliqué vers `utils.js`
- `normalizeAuth` consolidé dans `admin-api.js`
- `ensureSeedGraphs` guard flag ajouté (évite les réexécutions)
- `finishRun` comptage d'artifacts sans JSON parse
- `recoverRunnableRuns` double-read corrigé
- Bash injection fixé dans `node-engine-runtimes.js` (whitelist + timeout 30min)
- Timeout Ollama ajouté (15s metadata, 5min chat streaming)
- Validation WebSocket (64KB frame max, 8192 chars text, type checks)
- Rate limiting par IP (30 msg/min, `rate-limit.js`)
- Timeout par nœud Node Engine (10min default, configurable)
- Stubs analyse image/audio dans `attachment-pipeline.js` (en cours agent P1)
- Audit logging admin actions (en cours agent P1)

## Lot 3 — Domaines V2 `[complété]`

Objectif: contrats partagés, schémas métiers, auth réelle, persistance Postgres.

Livré:
- contrats TypeScript `core`, `auth`, `chat-domain`, `persona-domain`, `node-engine`, `storage`
- rôles `admin/editor/operator/viewer`
- session cookie V2 de dev
- endpoints V2 minimaux pour session, personas et Node Engine
- contrat Postgres côté configuration et schémas SQL initiaux
- repos Postgres typés (session, persona, graph, run) + `runMigrations()`
- auth réelle: crypto.scrypt hashing, token gen, extractSessionId, validateLoginInput
- chat domain: ChatMessage, ChatSession, compactHistory, channel validation
- persona domain: validatePersonaUpdate, aggregateFeedback, computePersonaDiff, createPersonaSource

Reste à faire:
- brancher les repos Postgres dans `apps/api` (remplacer les Maps in-memory)

## Lot 4 — Node Engine V2 `[complété]`

Objectif: porter store/runner/queue dans le package dédié, séparer les runtimes.

Livré:
- overview V2 minimale + graphes/runs/models de dev côté API + worker bootstrap
- registry TypeScript complet (15 node types, 7 familles, params typés)
- graph ops pures (topologicalSort, validateEdgeContracts, collectNodeInputs)
- run state machine (createRun, RunStep, resolveFinalStatus)
- queue logic pure (createQueueState, enqueue, dequeue, canDequeue, markComplete)
- runtime definitions (5 runtimes: local_cpu, local_gpu, remote_gpu, cluster, cloud_api)

## Lot 5 — Personas V2 `[complété]`

Objectif: `Pharmacius` opéré comme sous-système Node Engine, pipeline éditorial complet.

Livré:
- seed personas V2 + source/feedback/proposals/reinforce/revert côté API
- registry state machine pure (CRUD, enable/disable, getByNick/Model)
- Pharmacius prompt builder + response parser (pure, pas d'appels LLM)
- editorial pipeline state machine (idle → collecting → generating → review → applied/reverted)
- DPO training pair extraction (extractDPOPairs)
- patch apply/revert logic (applyPatches, reversePatches)

## Lot 6 — Frontend V2 `[complété]`

Objectif: shell React/Vite complet avec toutes les surfaces.

Livré:
- API client centralisé (`api.ts`) couvrant session, personas, node engine, chat
- 9 composants React (Header, Login, Nav, PersonaList, PersonaDetail, NodeEngineOverview, GraphDetail, RunStatus, ChannelList)
- routing hash-based sans react-router (#/dashboard, #/personas, #/node-engine, etc.)
- CSS IRC theme avec custom properties (SHELL_THEME + STATUS_COLORS)
- responsive breakpoints (sidebar → tabs à 720px)

## Lot 7 — TUI et opérabilité `[complété]`

Livré:
- `ops/v2/health-check.js` — probes V1+V2+Ollama+disk+memory, --watch/--json
- `ops/v2/queue-viewer.js` — TUI queue/runs Node Engine, --watch/--json
- `ops/v2/persona-manager.js` — TUI personas overview, --json
- `ops/v2/log-rotate.js` — rotation/nettoyage logs avec --dry-run/--max-age-days
- `packages/tui` — ansi helpers, statusDot, formatTable, drawBox, stripAnsi

## Lot 8 — Migration et bascule `[complété]`

Livré:
- `scripts/migrate-v1-to-v2.js` — migration personas, graphs, runs → Postgres (upsert, --dry-run, --verbose)
- `scripts/parity-check.js` — 10 checks parité V1/V2 (personas, graphs, channels, API shapes)
- `scripts/rollback-v2.js` — drop/truncate tables avec confirmation (--yes, --tables, --truncate)
- `scripts/smoke-v2.js` — 22 tests sur 5 catégories (`npm run smoke:v2`)

## Lot 9 — Intégration avancée `[complété]`

Livré:
- Migration ollama-js SDK officiel (même interface, streaming natif)
- Chat WebSocket React (hook useWebSocket, auto-reconnect, composant IRC)
- Éditeur visuel Node Engine (React Flow, 7 familles colorées, drag/connect/save/run)
- Persona sub-stores Postgres (sources, feedback, proposals — 3 tables, 3 repos)
- Déduplication requêtes GET admin-api.js
- CI/CD GitHub Actions (`.github/workflows/ci.yml`)
- Deep analyse finale V1+V2 (14 modules vérifiés, intégrité confirmée)

## Lot 10 — Production readiness `[complété]`

Livré:
- Adaptateurs training réels (TRL + Unsloth) — `packages/node-engine/src/training.ts`, worker intégré
- Sandboxing runtimes (none/subprocess/container) — `packages/node-engine/src/sandbox.ts`
- Tests unitaires V2 (node:test + supertest) — 102 tests, 46 suites, 0 failures
- Tests React (Vitest + RTL) — 33 tests, 6 composants
- Turborepo build orchestration — `turbo.json`, scripts alignés, CI mis à jour
- Code quality review (simplify) — 3 fixes efficacité/duplication
- Repo GitHub privé créé et pushé — https://github.com/electron-rare/kxkm_clown

## Lot 11 — Consolidation & feature parity `[en cours]`

Objectifs:
- Deep analyse code (bugs, perf, sécurité, dead code) → correctifs chirurgicaux
- Veille OSS mise à jour (LLM orchestration, training, chat UI)
- Recherche HuggingFace (modèles persona-ready, datasets DPO, outils LoRA)
- Feature parity V2 : combler les "prevu" restants dans la matrice

### Phase A — Analyse & recherche `[en cours]`
- [x] Deep analyse code V1+V2 (agent background)
- [x] Veille OSS web (agent background)
- [x] Recherche HuggingFace (agent background)

### Phase B — Correctifs sécurité `[complété]`
Corrigé:
- P0 SEC-01: Path traversal node-engine-runner.js (reject absolute + boundary check)
- P0 SEC-04: Login role self-assignment (viewer default, ADMIN_TOKEN for admin)
- P1 BUG-06: Health endpoint DATABASE_URL leak (redacted)
- P1 BUG-02: Timeout promise leak (AbortSignal cancel)
- P1 SEC-03: Attachment endpoints unauthenticated (requireAdminNetwork)

### Phase C — Feature parity V2 `[complété — 10/10]`

Livré:
- Recovery on crash (worker recoverStaleRuns + shouldCancel)
- Cancel support (requestCancel repo + API endpoint + worker callback)
- Commandes slash V2 (11 commandes + parseSlashCommand + resolveCommand + 17 tests)
- Mémoire conversationnelle V2 (ConversationMemory + buildLlmContext)
- Status strip admin V2 (GET /api/v2/status)
- Subnet gate V2 (CIDR middleware ADMIN_SUBNET)
- Retention sweep V2 (deleteOlderThan + POST /api/v2/admin/retention-sweep)
- Export HTML V2 (GET /api/v2/export/html)
- Upload fichiers V2 (bouton upload base64 Chat.tsx)
- Tab completion chat V2 (nicks + slash commands, Tab cycling)
- Historique messages V2 (ArrowUp/Down, 100 items max)
- DOM pruning V2 (élagage automatique à 500 messages)

### Phase D — Déploiement & polish `[complété]`

Livré:
- Docker Compose reconfiguré (Ollama natif via extra_hosts, profils v1/v2/ollama)
- .env.example avec toutes les variables documentées
- .gitignore sécurisé (protection .env)
- Déploiement V2 sur kxkm-ai (API healthy port 4180, worker actif, Postgres container)
- README complet (démarrage dev/Docker, admin, architecture, variables)

### Phase E — Refonte globale `[en cours]`

#### E.1 — Deep analyse code V1+V2 `[complété]`

- [x] Analyse systématique (25 findings: 5 P0, 10 P1, 10 P2)
- [x] Corrections P0 chirurgicales (JSON crash, storage race, ollama leak)
- [x] Corrections P1 chirurgicales (shutdown, rate limits, timingSafeEqual)
- [x] Corrections P2 (structuredClone, React.memo, regex optim, validation, debounce, token lookup)

#### E.2 — Veille OSS mise à jour `[complété]`

- [x] Recherche web complète (20+ projets analysés)
- [x] docs/OSS_WATCH_2026-03-16.md enrichi (chat UI, orchestration, training, libs)

#### E.3 — Documentation & specs `[complété]`

- [x] Mermaid persona editorial state machine ajouté
- [x] FEATURE_MAP.md matrice de parité mise à jour
- [x] ARCHITECTURE.md RBAC terminology fix (ops → operator)
- [x] NODE_ENGINE_ARCHITECTURE.md training status mis à jour
- [x] SPEC.md table commandes slash ajoutée
- [x] PROJECT_MEMORY.md référence manifeste ajoutée
- [x] AUTORESEARCH_MODE.md métriques artefact documentées

#### E.4 — Autoresearch avancé `[complété]`

- [x] Extraction score métier depuis artefacts d'évaluation (6 métriques)
- [x] Score artefact prioritaire, fallback status-based
- [x] TSV étendu avec colonne artifact_score

#### E.5 — Redéploiement `[complété]`

- [x] Commit corrections + docs + autoresearch
- [x] Push et redéployer sur kxkm-ai (V2 API healthy)

## Lot 12 — Training pipeline réel `[complété]`

Livré:
- PyTorch 2.10+cu128 + Unsloth 2026.3.4 + TRL 0.24.0 installés sur kxkm-ai (venv)
- scripts/train_unsloth.py : wrapper LoRA/QLoRA via Unsloth, output JSON sur stdout
- scripts/eval_model.py : évaluation modèle sur prompts JSONL, score F1 + support adapter
- Worker V2 : exécution réelle via child_process (training + évaluation nodes)
- Testé sur kxkm-ai : Llama-3.2-1B-Instruct QLoRA 4bit, training 23s, évaluation 20s
- Config : PYTHON_BIN, SCRIPTS_DIR, TRAINING_TIMEOUT_MS

Livré (suite) :
- Pipeline DPO complet : GET /api/v2/export/dpo + scripts/v2-dpo-pipeline.js
- train_unsloth.py : support --method dpo (TRL DPOTrainer, chosen/rejected pairs)
- Autoresearch : mutation hyperparamètres (random/values strategies)
- Model registry file-based : data/node-engine/registry/{tag}-{timestamp}.json
- Worker : sft_training node type, DPO via params.dpo flag

Livré (suite lot 13) :
- Intégration Ollama : scripts/ollama-import-adapter.sh + scripts/ollama-import.js
- Worker deploy_api : import réel LoRA adapter → modèle Ollama
- Dashboard training React : TrainingDashboard.tsx (#/training)
- GPU passthrough Docker : deploy.resources.reservations.devices (nvidia)
- Dockerfile : bash + scripts Python copiés dans l'image

## Lot 14 — Bascule chat V2 `[en cours]`

Objectif : faire du frontend React V2 l'interface chat principale.
- [ ] WebSocket chat V2 (ws-chat.ts) connecté à Ollama avec streaming
- [ ] API V2 sert le build Vite statique (SPA fallback)
- [ ] Frontend auto-détecte le WebSocket URL
- [ ] Vite dev proxy configuré
- [ ] Docker : V2 web dist copié dans l'image
- [ ] Port principal 3333 → V2
- [ ] Test end-to-end sur kxkm-ai

### Phase 2 — Consolidation chat V2 `[en cours]`
- [ ] Personas chargées depuis la DB (pas hardcodé)
- [ ] Persistance conversations JSONL (chat-logs)
- [ ] Extraction PDF réelle (pdf-parse)
- [ ] Deep analyse sécurité/perf ws-chat.ts
- [ ] Upload fichiers + analyse vision (images via qwen2.5:14b)

### Phase 3 — Multimodal & intelligence (RAG, STT, TTS, mémoire, web) `[en cours]`
- [ ] RAG local (nomic-embed-text, recherche contexte manifeste/sources)
- [x] STT : faster-whisper installé, script transcribe_audio.py
- [ ] STT : intégration upload audio → transcription → personas
- [ ] TTS : synthèse vocale des réponses personas (piper-tts)
- [ ] TTS : voix distinctes par persona
- [ ] Recherche web dans le chat (/web intégrée au WebSocket V2)
- [ ] Mémoire de contexte persistante par persona (résumé conversations, faits retenus)

## Lot 16 — Refonte UI chat : Minitel rose 3615-KXKM `[complété]`

Objectif : refonte esthétique complète du chat en mode Minitel/Télétel.
L'interface IRC actuelle évolue vers une esthétique Minitel rose — écran phosphore,
blocs VIDEOTEX, bandes de service, mosaïques, clavier AZERTY virtuel.

- [ ] Palette phosphore : fond noir, texte vert/ambre, accents rose Minitel (#FF69B4)
- [ ] Typo blocs : police monospace épaisse type VIDEOTEX (blocs 2×3)
- [ ] Bande de service haute : 3615 KXKM — tarification (gratuit, c'est local)
- [ ] Bande de service basse : F1=Sommaire F2=Suite F3=Retour F5=Envoi
- [ ] Mosaïques VIDEOTEX : séparateurs, cadres, art ASCII Minitel
- [ ] Écran de connexion : animation modem (biiiiip bzzz tchiiiik)
- [ ] Messages personas : style serveur vocal Minitel (>>> SCHAEFFER <<<)
- [ ] Curseur bloc clignotant vert/ambre
- [ ] Sons : bips Minitel (touche, envoi, réception, déconnexion)
- [ ] Easter egg : page 3615 ULLA si on tape /ulla
- [ ] Mode dégradé : scanlines CRT + flicker
- [ ] Responsive : mode portrait = écran Minitel vertical

### Phase 4 — Chat avancé `[complété]`
- [x] Chat Vocal dédié (#/voice) — STT/TTS séparé
- [x] Inter-persona dialogue (@mention, depth 3)
- [x] Upgrade qwen3:8b (personas) + qwen3-vl:8b (vision)
- [x] Multi-channel /join /channels
- [x] Analytics dashboard (stats, top personas, messages/jour)
- [x] P1 fixes (TTS queue, file semaphore, PDF startup, WS try-catch)
- [x] F1-F5 raccourcis clavier Minitel
- [x] Création persona depuis l'UI React
- [x] 23 personas couvrant : musique, arts de la rue, arts numériques,
  spectacle vivant, sciences, philosophie, écologie, tech, cinéma
- [x] Pharmacius orchestrateur (mistral:7b) avec routing par domaine
- [x] Contexte conversationnel par canal (10 derniers échanges)
- [x] Page Collectif (#/collectif)
- [x] Seed personas en DB

### Phase 5 — Personas spéciales + génération `[complété]`
- [x] ComfyUI intégré (/imagine, workflow SDXL, images inline)
- [x] Sherlock (mistral:7b) — recherche web, analyse de sources
- [x] Picasso (qwen3.5:9b) — direction artistique, prompts /imagine
- [x] Diversification modèles (mistral, gemma3, qwen3.5)
- [x] Contexte permanent 750 MB (16K chars prompt, 20K summary)
- [x] 26 personas total (10 domaines)
- [x] Veille HF modèles (30+ analysés) + Document AI state of art

### Phase 6 — Améliorations planifiées
- [ ] Installer Docling (remplacer pdf-parse pour tables/layout)
- [ ] SearXNG self-hosted (remplacer DuckDuckGo API)
- [ ] Flux 2 dans ComfyUI (meilleur que SDXL pour texte/photo)
- [ ] Voice cloning Coqui XTTS-v2 (voix unique par persona)
- [ ] ACE-Step 1.5 (génération musicale dans le Node Engine)
- [ ] GLM-OCR (0.9B) pour OCR documents scannés
- [ ] Pipeline RAG documentaire (indexer les fichiers uploadés)

Reste à faire (futur) :
- [ ] MCP (Model Context Protocol) pour intégration outils
- [ ] WebRTC voice (streaming temps réel au lieu d'upload)
- [ ] Fine-tune personas dédié (OpenCharacter/Ditto methodology)

## Lot 17 — Deep Audit & Refactoring `[en cours]`

Objectif : audit complet du code, optimisations chirurgicales, documentation enrichie.

### Phase A — Analyse & documentation `[en cours]`

- [x] Deep audit TUI script (ops/v2/deep-audit.js) — security, perf, complexity, deps
- [x] Veille OSS enrichie (10 nouvelles categories: voice cloning, music gen, PDF, RAG, WebRTC, MCP, persona fine-tune)
- [x] Diagrammes Mermaid ajoutés (Context Store, Docker deploy, Inter-persona dialogue)
- [x] AGENTS.md refondu (matrice 10 agents, Mermaid skill routing, pipeline intervention)
- [ ] Consolidation PLAN.md et TODO.md avec etat reel
- [ ] Deep analyse code par agents (5 agents paralleles: api, web, packages, mascarade, v1+worker)

### Phase B — Refactoring code `[planifié]`

- [ ] ws-chat.ts: extraction modules (1449 LOC → 4 modules <400 LOC)
- [ ] app.ts: extraction routes + middleware + handlers (1292 LOC → 3 modules)
- [ ] writeFileSync → async dans ws-chat.ts (3 occurrences P2)
- [ ] console.log → structured logging (apps/api, apps/worker)
- [ ] React.memo + lazy load sur composants lourds (Chat, ChatHistory, VoiceChat, NodeEditor)

### Phase C — Infrastructure `[planifié]`

- [ ] Ajouter SearXNG au docker-compose (remplacer DuckDuckGo scraping)
- [ ] Ajouter MinerU/Docling (remplacer pdf-parse)
- [ ] Spike BGE-M3 embeddings (upgrade RAG)
- [ ] Deployer deep-audit.js sur kxkm-ai

### Phase D — Nouveaux node types `[planifié]`

- [ ] Node type `music_generation` (ACE-Step 1.5, <4GB VRAM)
- [ ] Node type `voice_clone` (XTTS-v2, zero-shot 6s reference)
- [ ] Node type `document_extraction` (MinerU/Docling)

## Lot 18 — Voice & MCP `[futur]`

Objectif : voix temps réel et intégration outils standardisée.

- [ ] XTTS-v2 voice cloning par persona (remplacer Piper pour voix uniques)
- [ ] LLMRTC WebRTC streaming (TypeScript SDK, VAD, barge-in)
- [ ] MCP SDK integration (personas comme MCP servers, tool-calling)
- [ ] PCL + OpenCharacter (pipeline fine-tune persona avancé)
- [ ] Chatterbox TTS evaluation (remplacement Piper qualité)

## Lot 19 — Music & Creative `[futur]`

- [ ] ACE-Step 1.5 production (génération musicale)
- [ ] `/compose` command (prompt → musique via Node Engine)
- [ ] Flux 2 dans ComfyUI (upgrade image gen)
- [ ] A2A Protocol evaluation (interop agents externes)

## Lot 20 — Deep Analyse Continue & Execution Chainee `[en cours]`

Objectif: industrialiser la boucle analyse -> correction -> test -> documentation -> prochain lot.

Livres au cycle 2026-03-17:
- Deep audit execute et relance apres correctifs.
- Correctifs chirurgicaux sur le store de contexte V2.
- Reduction des faux positifs audit (security/perf) pour signal exploitable.
- Verification complete: check:v2 et test:v2 au vert.
- Correctif anti-derive de compteur TTS (`ttsActive`) dans `ws-chat.ts`.
- Nettoyage opportuniste des sessions expirees en mode in-memory dans `app.ts`.
- Purge des logs vides/obsoletes dans `ops/v2/logs`.
- Veille OSS web actualisee (LibreChat/OpenWebUI/Flowise/Dify/LangGraph/SearXNG/Docling).
- Durcissement `context-store.ts` complete (budget contexte, fallback compactage, serialisation enforcement).
- Tests API et unitaires context-store ajoutes et valides (`apps/api/src/context-store.test.ts`).
- Script d'orchestration lot 20 ajoute et execute (`ops/v2/run-deep-cycle.sh`).
- Scoring de dette technique ajoute a `ops/v2/deep-audit.js` (score/100 + niveau).
- Derniere mesure dette: **78/100 (high)**, principalement due a la dette perf/complexite.
- Refonte UI Minitel racine livree sur `public/*` avec rendu desktop/mobile.
- **Extraction modulaire du bloc upload/analyse de `ws-chat.ts` livree dans `ws-upload-handler.ts`**

Backlog immediat (ordre impose):
1. Poursuivre extraction modulaire de `ws-chat.ts` (router, commandes, core).
2. Refactor `app.ts` en routes + middleware.
3. Ajouter mesures perf API/WS (latence, debit, memoire) et reporter dans les logs Lot 20.
4. Ajouter SearXNG et Docling au compose pour le pipeline multimodal.