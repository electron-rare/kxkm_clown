# Architecture KXKM_Clown

> "Le medium est le message, et ton terminal a deja compris." -- electron rare
>
> Systeme de chat IA multimodal local. IRC dans l'interface, musique concrete dans le traitement,
> crypto-anarchisme dans l'infrastructure. Saboteur du big daddy mainframe.

---

## 1. Vue d'ensemble systeme

V2 est desormais l'architecture primaire. V1 reste fonctionnelle en parallele.

```mermaid
flowchart TB
    Browser["Client Browser (IRC aesthetic)"]

    Browser -- "WebSocket /ws" --> WS["ws-chat.ts"]
    Browser -- "REST API" --> HTTP["app.ts (Express)"]

    WS --> Ollama["Ollama (LLM inference)"]
    WS --> RAG["LocalRAG (embeddings)"]
    WS --> Vision["Vision (minicpm-v)"]
    WS --> STT["STT (faster-whisper)"]
    WS --> TTS["TTS (piper-tts)"]
    WS --> PDF["PDF extraction"]

    HTTP --> Repos["Repos (Postgres / memory)"]

    subgraph NodeEngine["Node Engine"]
        NEQ["Queue (Postgres poll)"] --> NER["Runner"]
        NER --> RT_CPU["local_cpu"]
        NER --> RT_GPU["local_gpu"]
        NER --> RT_CLOUD["cloud_api"]
    end

    HTTP --> NEQ

    subgraph Training["Training Pipeline"]
        DPO["DPO Export"] --> Dataset["Dataset Builder"]
        Dataset --> Train["train (TRL/Unsloth)"]
        Train --> Eval["Evaluation"]
        Eval --> Registry["Model Registry"]
        Registry --> Import["Ollama Import"]
    end

    subgraph Autoresearch["Autoresearch Loop"]
        AR["autoresearch-loop.js"] --> NEQ
        AR --> Scoring["Score & keep/discard"]
        Scoring --> Registry
    end
```

---

## 2. Architecture V2 (primaire — monorepo TypeScript)

```mermaid
flowchart TD
    Root["KXKM_Clown (monorepo)"]

    subgraph Apps["apps/"]
        api["api (Express + TypeScript)"]
        web["web (React + Vite)"]
        worker["worker (background jobs)"]
    end

    subgraph Packages["packages/"]
        core["core"]
        auth["auth"]
        chatDomain["chat-domain"]
        personaDomain["persona-domain"]
        nodeEngine["node-engine"]
        storagePkg["storage"]
        ui["ui"]
        tui["tui"]
    end

    Root --> Apps
    Root --> Packages

    web -- "HTTP / WS" --> api
    api --> auth
    api --> chatDomain
    api --> personaDomain
    api --> nodeEngine
    api --> storagePkg
    api --> core

    worker --> nodeEngine
    worker --> storagePkg
    worker --> core

    web --> ui

    chatDomain --> core
    personaDomain --> core
    nodeEngine --> core
    storagePkg --> core
    auth --> core
```

---

## 3. Architecture V1 (reference, monolithique)

```mermaid
flowchart TD
    server["server.js (entrypoint)"]

    server --> config["config.js"]
    server --> networkPolicy["network-policy.js"]
    server --> adminSession["admin-session.js"]

    server --> personaRegistry["persona-registry.js"]
    personaRegistry --> personas["personas.js"]
    server --> personaStore["persona-store.js"]
    personaStore --> pharmacius["pharmacius.js"]

    server --> runtimeState["runtime-state.js"]

    server --> storage["storage.js"]
    server --> sessions["sessions.js"]
    server --> clientRegistry["client-registry.js"]

    server --> ollama["ollama.js"]
    server --> webTools["web-tools.js"]

    server --> chatRouting["chat-routing.js"]
    server --> commands["commands.js"]

    server --> attachStore["attachment-store.js"]
    server --> attachPipeline["attachment-pipeline.js"]
    server --> attachService["attachment-service.js"]

    server --> neRegistry["node-engine-registry.js"]
    server --> neStore["node-engine-store.js"]
    server --> neRunner["node-engine-runner.js"]
    server --> neRuntimes["node-engine-runtimes.js"]
    server --> neQueue["node-engine-queue.js"]

    server --> httpApi["http-api.js"]
    server --> websocket["websocket.js"]

    chatRouting --> ollama
    chatRouting --> storage
    chatRouting --> runtimeState
    chatRouting --> personaRegistry

    commands --> ollama
    commands --> webTools
    commands --> storage

    httpApi --> networkPolicy
    httpApi --> adminSession
    httpApi --> personaStore
    httpApi --> neStore
    httpApi --> neQueue

    websocket --> chatRouting
    websocket --> commands
    websocket --> clientRegistry

    neQueue --> neRunner
    neRunner --> neRuntimes
    neRunner --> neRegistry
    neRunner --> neStore
```

---

## 4. Pipeline multimodal (chat)

Parcours d'un message dans le systeme multimodal. Le type de contenu determine le pipeline de traitement.

```mermaid
flowchart LR
    Input["Message entrant (WebSocket)"]

    Input --> TypeCheck{Type?}

    TypeCheck -- "type: message" --> TextPipe["Texte brut"]
    TypeCheck -- "type: command" --> CmdPipe["Commande slash"]
    TypeCheck -- "type: upload" --> UploadPipe["Upload fichier"]

    TextPipe --> RAGEnrich["RAG: enrichissement contexte"]
    RAGEnrich --> MemoryEnrich["Memoire persona injectee"]
    MemoryEnrich --> OllamaChat["Ollama streaming chat"]
    OllamaChat --> Response["Reponse broadcast"]
    Response --> TTSynth{"TTS_ENABLED?"}
    TTSynth -- oui --> PiperTTS["Piper TTS → audio broadcast"]
    TTSynth -- non --> Done["Fin"]
    PiperTTS --> Done

    UploadPipe --> MimeCheck{MIME type?}
    MimeCheck -- "text/*" --> TextExtract["Lecture texte (12K chars max)"]
    MimeCheck -- "image/*" --> VisionAnalyze["minicpm-v analyse image"]
    MimeCheck -- "audio/*" --> WhisperSTT["faster-whisper transcription"]
    MimeCheck -- "application/pdf" --> PDFParse["pdf-parse extraction"]
    MimeCheck -- "autre" --> MetaOnly["Metadata seulement"]

    TextExtract --> RoutePersonas["Route vers personas"]
    VisionAnalyze --> RoutePersonas
    WhisperSTT --> RoutePersonas
    PDFParse --> RoutePersonas
    MetaOnly --> RoutePersonas

    RoutePersonas --> RAGEnrich

    CmdPipe --> CmdCheck{Commande?}
    CmdCheck -- "/web" --> WebSearch["DuckDuckGo / API custom"]
    WebSearch --> RoutePersonas
    CmdCheck -- "/help /nick /who /personas" --> SysMsg["Message systeme"]
```

---

## 5. Flux RAG (Retrieval-Augmented Generation)

```mermaid
sequenceDiagram
    participant Boot as Server boot
    participant FS as Filesystem
    participant RAG as LocalRAG
    participant Ollama as Ollama /api/embed
    participant Chat as ws-chat

    Boot->>FS: lire manifeste.md + manifeste_references_nouvelles.md
    FS-->>Boot: contenu texte
    Boot->>RAG: addDocument(text, source)
    RAG->>RAG: splitIntoChunks(500 chars)
    loop chaque chunk
        RAG->>Ollama: POST /api/embed (nomic-embed-text)
        Ollama-->>RAG: embedding vector
        RAG->>RAG: stocker {id, text, source, embedding}
    end
    Note over RAG: Index pret (N chunks en memoire)

    Chat->>RAG: search(userMessage, maxResults=2)
    RAG->>Ollama: POST /api/embed (query)
    Ollama-->>RAG: query embedding
    RAG->>RAG: cosine similarity vs tous les chunks
    RAG-->>Chat: top-K chunks (score >= 0.3)
    Chat->>Chat: enrichedText = message + "[Contexte pertinent]\n" + chunks
```

---

## 6. Pipeline Training (DPO → Ollama)

```mermaid
flowchart LR
    Feedback["Feedback utilisateur\n(votes, edits)"]
    Feedback --> DPO["extractDPOPairs()"]
    DPO --> Export["GET /api/v2/export/dpo\n→ JSONL"]
    Export --> Dataset["Dataset Builder\n(Node Engine)"]
    Dataset --> Train["train_unsloth.py\n(TRL / Unsloth)"]
    Train --> Adapter["LoRA adapter\n(safetensors)"]
    Adapter --> Eval["eval_model.py\n(accuracy, f1, bleu)"]
    Eval --> Score{"Score OK?"}
    Score -- oui --> Registry["Model Registry\n(data/node-engine/registry/)"]
    Score -- non --> Discard["Discard"]
    Registry --> Import["ollama-import-adapter.sh\n→ ollama create"]
    Import --> Ollama["Modele disponible\ndans Ollama"]
```

---

## 7. Pipeline TTS / STT

```mermaid
sequenceDiagram
    participant User as Utilisateur
    participant WS as ws-chat
    participant Whisper as faster-whisper (Python)
    participant Piper as piper-tts (Python)
    participant Clients as Clients WebSocket

    Note over User,WS: === STT: Audio upload → texte ===
    User->>WS: upload {type: "upload", mimeType: "audio/*", data: base64}
    WS->>WS: ecrire fichier temporaire
    WS->>Whisper: execFile transcribe_audio.py --input /tmp/audio.wav --language fr
    Whisper-->>WS: {status: "completed", transcript: "..."}
    WS->>WS: routeToPersonas("[Audio: fichier]\nTranscription: ...")

    Note over WS,Clients: === TTS: Reponse persona → audio ===
    WS->>WS: persona repond (fullText)
    WS->>Piper: execFile tts_synthesize.py --text "..." --voice schaeffer --output /tmp/speech.wav
    Piper-->>WS: {status: "completed"}
    WS->>WS: lire WAV, encoder base64
    WS->>Clients: broadcast {type: "audio", nick, data: base64, mimeType: "audio/wav"}
```

---

## 8. Flux de donnees

### 8.1 Message chat (V2)

```mermaid
sequenceDiagram
    participant C as Client
    participant WS as ws-chat.ts
    participant RAG as LocalRAG
    participant Mem as PersonaMemory
    participant OL as Ollama
    participant Log as chat-logs/

    C->>WS: {type: "message", text: "..."}
    WS->>WS: broadcast message utilisateur
    WS->>Log: appendFileSync JSONL
    WS->>WS: pickResponders (mention ou random)

    loop chaque persona
        WS->>RAG: search(text, 2)
        RAG-->>WS: chunks contexte
        WS->>Mem: loadPersonaMemory(nick)
        Mem-->>WS: faits + resume
        WS->>WS: enrichir systemPrompt + contexte RAG
        WS->>OL: POST /api/chat (stream: true)
        loop streaming tokens
            OL-->>WS: chunk
        end
        WS->>WS: broadcast reponse complete
        WS->>Log: appendFileSync JSONL
        WS->>Mem: updatePersonaMemory (toutes les 5 msgs)
    end
```

### 8.2 Node Engine pipeline

```mermaid
sequenceDiagram
    participant Admin as Admin UI
    participant API as app.ts
    participant Q as Queue (Postgres)
    participant W as Worker
    participant RT as Runtime (cpu/gpu/cloud)
    participant S as Storage

    Admin->>API: POST /api/admin/node-engine/graphs/:id/run
    API->>Q: INSERT run (status: queued)
    Q-->>API: run id
    API-->>Admin: 201 run

    loop pour chaque noeud du graphe
        W->>Q: poll queued runs
        W->>RT: execute(nodeType, params)
        RT-->>W: result / artifacts
        W->>S: saveArtifact + updateNodeStatus
    end

    W->>Q: UPDATE status = completed
    Admin->>API: GET /api/admin/node-engine/runs/:id
    API-->>Admin: run + artifacts
```

### 8.3 Persona lifecycle

```mermaid
flowchart LR
    Seed["Catalogue seed\n(persona-domain)"]
    Registry["persona-repo"]
    Overrides["upsert()"]
    Feedback["feedback-repo"]
    Sources["source-repo"]
    Pharmacius["Pharmacius\n(LLM generateur)"]
    Proposals["proposal-repo"]
    Runtime["Persona active\n(ws-chat)"]

    Seed --> Registry
    Overrides --> Registry
    Registry --> Runtime

    Sources --> Pharmacius
    Feedback --> Pharmacius
    Pharmacius --> Proposals

    Proposals -- "apply" --> Overrides
    Proposals -- "revert" --> Overrides
```

### 8.4 Persona editorial state machine

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> collecting : feedback recu
    collecting --> generating : seuil atteint
    generating --> review : proposals generees
    review --> applied : admin approuve
    review --> reverted : admin rejette
    applied --> idle : cycle termine
    reverted --> idle : cycle termine
```

---

## 9. Autoresearch

```mermaid
flowchart LR
    Config["autoresearch.json\n(graphId, mutations, budget)"]
    Config --> Loop["Boucle experimentation"]

    Loop --> Mutate["mutateParams()\n(random, cycle)"]
    Mutate --> Run["createQueuedRun()\n→ Postgres"]
    Run --> Wait["waitForTerminalStatus()\n(poll)"]
    Wait --> Score["scoreRun()\n(artifact metric + speed bonus)"]
    Score --> Decision{Meilleur score?}
    Decision -- keep --> Best["Mettre a jour best"]
    Decision -- discard --> Next["Experiment suivant"]
    Best --> Next
    Next --> Loop

    Best --> Register["registerBestModel()\n→ data/node-engine/registry/"]
    Register --> TSV["Resultats TSV"]
```

---

## 10. Stockage

### 10.1 Arborescence `data/`

```mermaid
flowchart TD
    data["data/"]
    data --> channels["channels.json"]
    data --> runtimeAdmin["runtime-admin.json"]
    data --> users["users.json"]
    data --> overrides["personas.overrides.json"]
    data --> manifeste["manifeste.md + manifeste_references_nouvelles.md"]

    data --> chatLogs["chat-logs/ (v2-YYYY-MM-DD.jsonl)"]
    data --> personaMemory["persona-memory/ (nick.json)"]
    data --> dpo["dpo/ (paires DPO jsonl)"]
    data --> training["training/ (conversations jsonl)"]
    data --> logs["logs/ (historiques par canal)"]
    data --> memory["memory/ (contexte par session)"]
    data --> sessions_dir["sessions/ (sessions persistees)"]
    data --> v2local["v2-local/ (personas, sources, feedback, proposals)"]

    data --> uploads["uploads/ (fichiers binaires)"]
    data --> uploadsMeta["uploads-meta/ (metadonnees)"]

    data --> pFeedback["persona-feedback/ (retours)"]
    data --> pProposals["persona-proposals/ (patches)"]
    data --> pSources["persona-sources/ (dossiers source)"]

    data --> ne["node-engine/ (graphes, runs, artifacts, registry)"]
```

### 10.2 Arborescence `models/`

```mermaid
flowchart TD
    models["models/"]
    models --> base["base_models/"]
    models --> finetuned["finetuned/"]
    models --> lora["lora/"]
    models --> registry["registry.json"]
```

---

## 11. Securite

### Politique reseau

- `ADMIN_SUBNET` (V2): CIDR unique pour restriction admin.
- `ADMIN_ALLOWED_SUBNETS` (V1): liste de sous-reseaux.
- Verification IP source sur chaque requete admin.
- Mode d'acces: `loopback` (127.0.0.1) ou `lan_controlled`.

### Sessions admin

- Authentification par token (`ADMIN_TOKEN` ou `ADMIN_BOOTSTRAP_TOKEN`).
- Cookie de session `HttpOnly`, `SameSite=Strict`, `Secure` si HTTPS.
- Verification same-origin sur toute mutation.

### Roles RBAC

| Role       | Description                                    | Source de configuration    |
|------------|------------------------------------------------|----------------------------|
| `admin`    | Acces complet, gestion personas et node-engine | `ADMIN_TOKEN` match        |
| `operator` | Operations, monitoring, acces TUI              | Token eleve                |
| `editor`   | Modification personas (via admin UI)           | Session admin authentifiee |
| `viewer`   | Chat public, lecture seule                     | Tout client connecte       |

---

## 12. Routes API

### Routes publiques

| Methode | Route                              | Description                        |
|---------|------------------------------------|------------------------------------|
| GET     | `/api/v2/health`                   | Sante de l'API                     |
| GET     | `/api/v2/status`                   | Statut general (personas, runs)    |
| GET     | `/api/status`                      | Statut general (V1)                |
| GET     | `/api/models`                      | Liste des modeles Ollama           |
| GET     | `/api/channels`                    | Liste des canaux actifs            |
| GET     | `/api/personas`                    | Liste des personas publiques       |

### Routes session

| Methode | Route                    | Description                      |
|---------|--------------------------|----------------------------------|
| POST    | `/api/session/login`     | Creation session (token)         |
| GET     | `/api/session`           | Verification session courante    |
| POST    | `/api/session/logout`    | Deconnexion                      |

### Routes admin - Personas

| Methode | Route                                       | Description                          |
|---------|---------------------------------------------|--------------------------------------|
| PUT     | `/api/admin/personas/:id`                   | Modifier une persona                 |
| GET     | `/api/admin/personas/:id/source`            | Lire dossier source                  |
| PUT     | `/api/admin/personas/:id/source`            | Modifier dossier source              |
| GET     | `/api/admin/personas/:id/feedback`          | Lister les retours                   |
| GET     | `/api/admin/personas/:id/proposals`         | Lister les propositions              |
| POST    | `/api/admin/personas/:id/reinforce`         | Lancer renforcement Pharmacius       |
| POST    | `/api/admin/personas/:id/revert`            | Revenir a un etat precedent          |

### Routes admin - Node Engine

| Methode | Route                                           | Description                       |
|---------|--------------------------------------------------|-----------------------------------|
| GET     | `/api/admin/node-engine/overview`               | Vue d'ensemble (runs, queue)      |
| GET     | `/api/admin/node-engine/graphs`                 | Lister les graphes                |
| POST    | `/api/admin/node-engine/graphs`                 | Creer un graphe                   |
| PUT     | `/api/admin/node-engine/graphs/:id`             | Modifier un graphe                |
| POST    | `/api/admin/node-engine/graphs/:id/run`         | Lancer execution                  |
| GET     | `/api/admin/node-engine/runs/:id`               | Detail d'une execution            |
| POST    | `/api/admin/node-engine/runs/:id/cancel`        | Annuler une execution             |
| GET     | `/api/admin/node-engine/artifacts/:runId`       | Artifacts d'une execution         |
| GET     | `/api/admin/node-engine/models`                 | Lister les modeles                |

### Routes export et historique

| Methode | Route                              | Description                       |
|---------|------------------------------------|------------------------------------|
| GET     | `/api/v2/export/html`              | Export HTML conversation           |
| GET     | `/api/v2/export/dpo`               | Export paires DPO (JSONL)          |
| GET     | `/api/v2/chat/history`             | Liste fichiers de chat logs        |
| GET     | `/api/v2/chat/history/:date`       | Messages d'un jour (pagine)        |
| POST    | `/api/v2/admin/retention-sweep`    | Nettoyage runs anciens             |
