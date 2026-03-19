# Veille OSS -- kxkm_clown / 3615-KXKM
**Date**: 2026-03-19 (mise a jour approfondie)

---

## Top recommandations (impact/effort)

| Priorite | Projet | Usage | URL |
| --- | --- | --- | --- |
| 1 | Pocket TTS | TTS CPU temps reel, voice cloning, MIT, 100M params | https://github.com/kyutai-labs/pocket-tts |
| 2 | Qwen3-TTS | Voice design par prompt NL, clone 3s, streaming 97ms | https://github.com/QwenLM/Qwen3-TTS |
| 3 | Kokoro-82M | TTS ultra-rapide (<0.3s), CPU/GPU, Apache 2.0 | https://github.com/hexgrad/kokoro |
| 4 | Dify | Workflow visuel LLM + RAG + agents + MCP server | https://github.com/langgenius/dify |
| 5 | SillyTavern | Multi-persona chat, character cards, group chat | https://github.com/SillyTavern/SillyTavern |
| 6 | Chatterbox Turbo | TTS zero-shot, 350M, emotion tags, MIT (deja integre) | https://github.com/resemble-ai/chatterbox |
| 7 | LightRAG v1.4.11 | Graph RAG, Ollama natif (deja integre) | https://github.com/HKUDS/LightRAG |
| 8 | NodeTool | Visual AI workflow builder, reference pour node engine | https://github.com/nodetool-ai/nodetool |
| 9 | Rivet | Visual prompt graph editor, debug LLM chains | https://github.com/Ironclad/rivet |
| 10 | F5-TTS | Meilleur voice cloning zero-shot, flow matching | https://github.com/SWivid/F5-TTS |

---

## 1. Multi-Persona LLM Chat Platforms (Open Source)

### SillyTavern
- **URL**: https://github.com/SillyTavern/SillyTavern
- **Stars**: ~10k+ (300+ contributors, 3 ans de dev)
- **Activite**: Tres actif, grosse communaute
- **Description**: Fork de TavernAI. Character cards avec personnalite/background/scenario. Group chats multi-bots ou les personnages parlent entre eux. Fonctionne avec Ollama, Claude, OpenAI, modeles locaux.
- **Pertinence**: **HAUTE** -- projet existant le plus proche de kxkm_clown. Systeme de character cards similaire aux definitions de persona. Group chat = routage de conversation multi-persona.
- **Integration**: Etudier le format character card pour interoperabilite. Emprunter les patterns UI de switch de persona. Leur logique d'orchestration de group chat est directement pertinente.

### Open WebUI
- **URL**: https://github.com/open-webui/open-webui
- **Stars**: ~90k+
- **Activite**: Extremement actif, frontend Ollama de reference
- **Description**: Plateforme AI self-hosted complete. RAG avec 9 vector DBs, web search (15+ providers dont SearXNG), voice I/O (Whisper + TTS), model builder, multi-user, Python function calling.
- **Pertinence**: **HAUTE** -- overlap significatif avec le stack kxkm_clown. Meme backend Ollama, RAG, web search, integration TTS.
- **Integration**: Architecture de reference pour bonnes pratiques Ollama. Adopter leurs patterns de pipeline RAG. Leur integration SearXNG est directement pertinente (kxkm utilise deja SearXNG).

### LobeChat / LobeHub
- **URL**: https://github.com/lobehub/lobe-chat
- **Stars**: ~50k+
- **Activite**: Tres actif
- **Description**: Plateforme de collaboration multi-agents. Design d'equipes d'agents, ecosysteme de plugins, TTS/STT, upload fichiers, support modeles visuels.
- **Pertinence**: MOYENNE -- le paradigme agent-comme-unite-de-travail correspond au concept de persona. Bonne reference pour patterns UX multi-agents.
- **Integration**: L'architecture de plugins pourrait inspirer les extensions du node engine kxkm.

### LibreChat
- **URL**: https://github.com/danny-avila/LibreChat
- **Stars**: ~25k+
- **Description**: Interface chat AI unifiee. Multi-provider, branching de conversations, presets, plugins. API compatible OpenAI.
- **Pertinence**: MOYENNE -- le branching de conversations et le routage multi-provider sont des patterns pertinents.

### Eliza (BarbarossaKad)
- **URL**: https://github.com/BarbarossaKad/Eliza
- **Description**: Systeme de roleplay AI self-hosted. 100% local, zero fuites de donnees. Alternative open-source a Character.AI utilisant Ollama.
- **Pertinence**: MOYENNE -- meme philosophie que kxkm (local-first, Ollama, base sur les personnages).

---

## 2. Frameworks d'Orchestration LLM (Alternatives a LangChain)

### Dify
- **URL**: https://github.com/langgenius/dify
- **Stars**: ~70k+
- **Activite**: Extremement actif
- **Description**: Plateforme open-source d'apps LLM. Workflow builder visuel, pipeline RAG, 50+ outils agents integres, support serveur MCP, integration Ollama/LocalAI. Self-hosted, donnees restent locales.
- **Pertinence**: **HAUTE** -- le workflow builder visuel est parallele au node engine kxkm. Integration Ollama, RAG, support protocole MCP. Pourrait remplacer ou complementer l'orchestration custom.
- **Integration**: La capacite serveur MCP signifie que les workflows Dify pourraient etre exposes comme outils MCP vers kxkm. Les patterns de workflow visuel informent le design du node engine.

### LlamaIndex
- **URL**: https://github.com/run-llama/llama_index
- **Stars**: ~40k+
- **Description**: Framework de donnees pour apps LLM. Best-in-class pour search/retrieval, metadata structuree, traitement de documents.
- **Pertinence**: MOYENNE -- alternative de pipeline RAG. Meilleure metadata structuree que LightRAG pour certains cas.

### Haystack
- **URL**: https://github.com/deepset-ai/haystack
- **Stars**: ~20k+
- **Description**: Framework NLP/LLM end-to-end. Architecture pipeline, document stores, retrievers, generators. Production-ready.
- **Pertinence**: MOYENNE -- architecture pipeline mature. Bon pour hardening production du RAG.

### Flowise
- **URL**: https://github.com/FlowiseAI/Flowise
- **Stars**: ~35k+
- **Description**: UI low-code visuelle pour construire des chaines/agents LLM. Construit sur LangChain.js. Drag-and-drop.
- **Pertinence**: MOYENNE -- paradigme de builder visuel overlap avec le concept de node engine.

### LangGraph
- **URL**: https://github.com/langchain-ai/langgraph
- **Stars**: ~10k+
- **Description**: Apps multi-agents avec cycles, agents long-running, haut controle.
- **Pertinence**: BASSE-MOYENNE -- pertinent si kxkm a besoin de machines a etats agents complexes (graphes d'interaction de personas).

---

## 3. Streaming WebSocket pour Reponses LLM

### Bonnes pratiques (consolidees)

1. **WebSocket full-duplex > SSE pour le chat**: WebSocket permet communication bidirectionnelle (l'utilisateur peut interrompre/annuler la generation en cours). SSE est plus simple mais unidirectionnel.

2. **Forwarding token-par-token**: Forward chaque token de la reponse streaming Ollama directement au client WebSocket. Ne pas bufferiser la reponse entiere.

3. **Gestion de backpressure**: Monitorer le taux de consommation client. Si le buffer d'envoi WebSocket se remplit, pauser le streaming Ollama pour eviter l'accumulation memoire.

4. **Reconnexion avec reprise**: Implementer des IDs de message pour que les clients puissent se reconnecter et reprendre depuis le dernier token recu.

5. **Slots de modeles concurrents**: Ollama supporte `OLLAMA_MAX_LOADED_MODELS` pour inference parallele. Utiliser des canaux WebSocket separes par persona pour activer de vraies reponses multi-persona concurrentes.

6. **Heartbeat/ping-pong**: Garder les connexions vivantes a travers NAT/proxies avec des pings periodiques.

7. **Frames binaires pour l'audio**: Quand on stream des chunks audio TTS via WebSocket, utiliser des frames binaires (pas base64 dans JSON). 33% d'economie de bande passante.

8. **Multiplexage de canaux**: Utiliser un systeme de channel/topic dans les messages WS pour gerer plusieurs streams concurrents (generation texte + TTS + status generation image).

### Format de message recommande
```json
{
  "type": "token|audio|image|status|error",
  "persona": "pharmacius",
  "channel": "chat-123",
  "seq": 42,
  "data": "..."
}
```

### Projets de reference
- **Resonance Framework** (distantmagic/resonance) -- Framework PHP async avec integration WebSocket llama.cpp
- **web-llm** (mlc-ai/web-llm) -- ~15k+ stars. Inference LLM in-browser via WebGPU
- **AG2** -- Framework agent avec streaming WebSocket pour chat multi-agent

---

## 4. Ollama Tool Calling / Function Calling

### Meilleurs modeles pour tool calling (2025-2026)

| Modele | Taille | Qualite Tool Calling | Notes |
|--------|--------|---------------------|-------|
| Llama 3.1 8B-Instruct | 8B | Meilleur overall | Implementation de reference Meta |
| Qwen 2.5 7B | 7B | Excellent | Bon tool calling multilingual |
| Mistral 7B | 7B | Bon | Moins de ressources necessaires |
| Llama 3.3 70B | 70B | Excellent | Necessite RTX 4090 (kxkm en a une) |
| Command-R+ | 35B | Tres bon | Optimise pour l'utilisation d'outils |

### Bonnes pratiques

- **Format JSON Schema** pour les definitions d'outils via le champ `tools` de `/api/chat` Ollama
- **Tool calls en streaming** supporte -- commencer l'action avant la reponse complete
- **Modeles concurrents multiples**: Utiliser `OLLAMA_MAX_LOADED_MODELS` pour garder un petit modele pour le routage d'outils et un plus gros pour la generation
- **La fiabilite chute sous 8B params** -- pour du tool calling complexe, utiliser des modeles 8B+
- **Mode sortie structuree** (`format: json`) aide a forcer des reponses JSON valides pour les tool calls
- **Chaine de fallback**: Essayer tool call -> si JSON malformed, retry avec prompt plus simple -> fallback en texte libre

### References
- Docs officiels: https://docs.ollama.com/capabilities/tool-calling
- Blog post: https://ollama.com/blog/tool-support

---

## 5. Solutions TTS (Alternatives/Upgrades a Piper)

### Tier 1: Upgrades drop-in pour kxkm

#### Kokoro-82M
- **URL**: https://github.com/hexgrad/kokoro
- **Licence**: Apache 2.0
- **Taille**: 82M params (~300MB, quantise ~80MB)
- **Vitesse**: Sous 0.3s pour n'importe quel texte. 36x temps reel sur GPU. Quasi temps reel sur CPU.
- **Qualite**: Note 5/5 en naturalite. Gamme emotionnelle limitee.
- **Voice Cloning**: Pas de cloning natif. Librairie de voix preselectionnees.
- **Langues**: Anglais, Francais, Japonais, Coreen, Chinois, autres
- **Pertinence**: **HAUTE** -- minuscule, rapide, Apache. Parfait pour reponses personas a faible latence. Support francais.
- **Integration**: Remplacer Piper pour les chemins critique-vitesse. Runtime ONNX ou crate Rust disponible. Wrapper FastAPI existe (Kokoro-FastAPI).

#### Kyutai Pocket TTS
- **URL**: https://github.com/kyutai-labs/pocket-tts
- **Licence**: MIT
- **Taille**: 100M params
- **Vitesse**: Temps reel sur CPU (RTF ~0.17 sur M4, ~6x plus rapide que temps reel). Pas de GPU necessaire.
- **Qualite**: Plus bas WER (1.84%) parmi les concurrents. Haute fidelite.
- **Voice Cloning**: Oui, 5 secondes d'audio de reference.
- **Pertinence**: **TRES HAUTE** -- CPU temps reel + voice cloning + licence MIT + minuscule. Peut tourner a cote d'Ollama sans contention GPU.
- **Integration**: 5 lignes de Python. Lancer comme service sidecar. Parfait pour kxkm ou le GPU est occupe avec Ollama/ComfyUI.

### Tier 2: Haute qualite, plus de ressources

#### Chatterbox Turbo (deja dans le stack kxkm)
- **URL**: https://github.com/resemble-ai/chatterbox
- **Licence**: MIT
- **Taille**: 350M params
- **Qualite**: Bat ElevenLabs en tests aveugles (63.75% preference). 1M+ downloads HuggingFace.
- **Voice Cloning**: Oui, zero-shot. Expressivite configurable. Tags paralinguistiques [laugh] [cough].
- **Langues**: 23 langues dont le francais
- **Status**: Deja integre dans kxkm. Garder comme moteur haute-qualite principal.

#### F5-TTS
- **URL**: https://github.com/SWivid/F5-TTS
- **Licence**: MIT-like
- **Qualite**: Cloning zero-shot le plus realiste. Architecture flow matching + DiT.
- **Voice Cloning**: Oui, zero-shot a partir d'un court echantillon.
- **Pertinence**: HAUTE -- meilleure qualite de cloning que Chatterbox pour certaines voix.
- **Integration**: Backend TTS secondaire pour les personas necessitant un cloning vocal tres specifique.

#### Qwen3-TTS
- **URL**: https://github.com/QwenLM/Qwen3-TTS
- **Licence**: Apache 2.0
- **Taille**: 0.6B - 1.7B params
- **Vitesse**: 97ms latence premier token (architecture streaming)
- **Voice Cloning**: Oui, 3 secondes d'audio de reference
- **Special**: Design de voix par langage naturel ("fais-le sonner comme un vieux professeur fatigue"). Controle emotion/ton/prosodie.
- **Langues**: 10 langues dont le francais
- **Pertinence**: **HAUTE** -- le design de voix en langage naturel est parfait pour creer des voix distinctes par persona. Integration ComfyUI existante.
- **Integration**: Utiliser des prompts de design vocal pour creer des voix uniques par persona. Node ComfyUI deja disponible. Architecture streaming compatible avec le pipeline WebSocket.

### Tier 3: Specialise

#### CosyVoice2
- **URL**: https://github.com/FunAudioLLM/CosyVoice
- **Description**: Multi-lingue, ultra-basse latence, controle emotionnel. Par Alibaba/FunAudioLLM.

#### MeloTTS
- **Description**: Multilingual, basse latence, nombreux accents. Pas de voice cloning.
- **Pertinence**: BASSE -- Kokoro est meilleur pour le meme usage.

### Strategie TTS recommandee pour kxkm

```
Chemin rapide/CPU:  Kokoro-82M ou Pocket TTS  (< 200ms, pas de GPU)
Chemin qualite:     Chatterbox (actuel)        (GPU, meilleure qualite)
Chemin cloning:     Qwen3-TTS ou F5-TTS       (GPU, design de voix)
```

---

## 6. Frameworks RAG compatibles Ollama

### LightRAG (deja dans le stack kxkm)
- **URL**: https://github.com/HKUDS/LightRAG
- **Stars**: 29.4k
- **Status**: Deja integre. RAG base graphe, rapide, tourne sur CPU.
- **Verdict**: Garder. Meilleur equilibre vitesse/qualite pour retrieval augmente par graphe.

### Nano-GraphRAG
- **URL**: https://github.com/gusye1234/nano-graphrag
- **Description**: Alternative GraphRAG legere. Trois modes de requete (Naive, Local, Global). Plus simple que LightRAG.
- **Pertinence**: MOYENNE -- alternative plus simple si LightRAG devient trop complexe.

### RAGFlow
- **URL**: https://github.com/infiniflow/ragflow
- **Stars**: ~70k+
- **Description**: Moteur RAG avec comprehension profonde de documents. Chunking avance, extraction tables/images.
- **Pertinence**: MOYENNE -- meilleur pour traitement lourd de documents (PDFs avec tables, etc).

### NexusRAG
- **URL**: https://github.com/LeDat98/NexusRAG
- **Description**: Hybride: vector + graphe LightRAG + cross-encoder reranking + Docling. Supporte Ollama nativement.
- **Pertinence**: MOYENNE-HAUTE -- evolution naturelle du setup LightRAG actuel.

### Chroma + Ollama (RAG vectoriel simple)
- **URL**: https://github.com/chroma-core/chroma
- **Stars**: ~18k+
- **Description**: Vector DB legere. Integration facile embeddings Ollama.
- **Pertinence**: MOYENNE -- plus simple que LightRAG quand les relations de graphe ne sont pas necessaires.

### Strategie RAG recommandee
```
Requetes graphe:    LightRAG (actuel)     -- retrieval conscient des relations
Vecteur simple:     Chroma                -- recherche de similarite rapide
Documents lourds:   RAGFlow               -- si parsing PDF/tables necessaire
Hybride:            NexusRAG              -- quand les deux sont necessaires
```

---

## 7. Projets AI Creatifs / Performance Artistique

### NodeTool
- **URL**: https://github.com/nodetool-ai/nodetool
- **Description**: Builder visuel pour workflows/agents AI. Node-based, local-first, multimodal (texte/image/video/audio). Connexions de nodes type-safe.
- **Pertinence**: **HAUTE** -- directement comparable au concept de node engine kxkm. Editeur visuel de graphes pour workflows AI avec connexions type-safe.
- **Integration**: Etudier leur systeme de types de nodes et la validation de connexions. Peut informer le design du registry du node engine kxkm.

### Rivet
- **URL**: https://github.com/Ironclad/rivet
- **Stars**: ~3k+
- **Description**: Environnement de programmation AI visuel open-source. Editeur de graphes node-based pour chaines de prompts LLM. Debug et collaboration sur des graphes de prompts.
- **Pertinence**: **HAUTE** -- le plus proche du concept de node engine kxkm pour des workflows specifiques LLM.
- **Integration**: Leurs outils de debug de graphes de prompts sont directement pertinents. Adapter leur format de serialisation de graphes.

### Invoke AI
- **URL**: https://github.com/invoke-ai/InvokeAI
- **Stars**: ~25k+
- **Licence**: Apache 2.0
- **Description**: Moteur creatif pour generation d'images AI. Self-hosted, entierement personnalisable. Editeur de workflow node-based.
- **Pertinence**: MOYENNE -- workflow creatif AI node-based. Parallele avec l'approche ComfyUI + node engine de kxkm.

### ChainForge
- **URL**: https://github.com/ianarawjo/ChainForge
- **Description**: Environnement de programmation visuelle pour battle-tester des prompts LLM. Analyse de data flow.
- **Pertinence**: MOYENNE -- evaluation de prompts et A/B testing des prompts de personas.

### AgoraAI
- **URL**: https://www.mdpi.com/2076-3417/16/4/2120
- **Description**: Framework voice-to-voice multi-persona (paper fev 2026). Resout le "Concurrency-Coherence Paradox" via Asynchronous Dual-Queue Processing.
- **Pertinence**: **HAUTE** -- directement applicable au use-case kxkm_clown pour conversations multi-persona concurrentes.

### NeurIPS Creative AI Track
- **URL**: https://neurips.cc/Conferences/2025/CallForCreativeAI
- **Description**: Papiers de recherche et oeuvres explorant l'AI dans l'art/design/performance.
- **Pertinence**: BASSE mais inspirante -- recherche academique sur AI + performance creative.

---

## 8. Architecture WebSocket Recommandee

```
Client (UI Minitel)
    |
    | WebSocket (wss://)
    |
API Server (Node.js)
    |
    +-- Ollama streaming API (HTTP SSE)
    +-- TTS sidecar (HTTP streaming)
    +-- ComfyUI (HTTP polling -> WS notify)
    |
Persona Router
    |
    +-- Route message vers le bon modele/config persona
    +-- Gere le contexte de conversation par persona
    +-- Gere les reponses concurrentes de personas (group chat)
```

---

## Feuille de route d'integration prioritaire

### Immediat (faible effort, fort impact)

| Projet | Action | Effort |
|---------|--------|--------|
| **Pocket TTS** | Ajouter comme backend TTS CPU-only a cote de Chatterbox | 1-2 jours |
| **Kokoro-82M** | Ajouter comme TTS ultra-rapide pour reponses basse-latence | 1 jour |
| **Ollama tool calling** | Implementer le tool calling structure pour les actions de personas | 2-3 jours |

### Court terme (effort moyen)

| Projet | Action | Effort |
|---------|--------|--------|
| **Qwen3-TTS** | Design vocal par persona via prompts en langage naturel | 3-5 jours |
| **SillyTavern** | Etudier le format character card, envisager la compatibilite import | 2 jours |
| **NodeTool/Rivet** | Informer le design du node engine avec leurs patterns | Recherche |

### Moyen terme (effort plus eleve)

| Projet | Action | Effort |
|---------|--------|--------|
| **Dify** | Evaluer comme workflow builder visuel pour pipelines persona complexes | 1 semaine |
| **Open WebUI** | Etudier patterns RAG/search pour ameliorer kxkm | Recherche |
| **F5-TTS** | Ajouter comme backend de voice cloning premium | 3-5 jours |
| **NexusRAG** | Evaluer comme upgrade hybride de LightRAG | 3 jours |

---

## Sources

### Multi-Persona Chat
- [SillyTavern Docs](https://docs.sillytavern.app/)
- [Open WebUI](https://github.com/open-webui/open-webui)
- [LobeChat](https://github.com/lobehub/lobe-chat)
- [LibreChat](https://www.librechat.ai/)
- [Eliza](https://github.com/BarbarossaKad/Eliza)

### LLM Orchestration
- [Dify AI](https://github.com/langgenius/dify)
- [LlamaIndex](https://github.com/run-llama/llama_index)
- [Haystack](https://github.com/deepset-ai/haystack)
- [Flowise](https://flowiseai.com/)
- [LangGraph](https://github.com/langchain-ai/langgraph)
- [Top LangChain Alternatives](https://www.vellum.ai/blog/top-langchain-alternatives)
- [LLM Orchestration 2026](https://aimultiple.com/llm-orchestration)

### TTS
- [Kokoro-82M](https://github.com/hexgrad/kokoro)
- [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts)
- [Chatterbox](https://github.com/resemble-ai/chatterbox)
- [F5-TTS](https://github.com/SWivid/F5-TTS)
- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)
- [CosyVoice2](https://github.com/FunAudioLLM/CosyVoice)
- [Best Open-Source TTS Models 2026](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models)
- [Open-Source TTS Comparison](https://www.inferless.com/learn/comparing-different-text-to-speech---tts--models-part-2)
- [Chatterbox vs Kokoro vs others](https://ocdevel.com/blog/20250720-tts)

### RAG
- [LightRAG](https://github.com/HKUDS/LightRAG)
- [Nano-GraphRAG](https://github.com/gusye1234/nano-graphrag)
- [RAGFlow](https://github.com/infiniflow/ragflow)
- [NexusRAG](https://github.com/LeDat98/NexusRAG)
- [Best Open-Source RAG Frameworks 2026](https://www.firecrawl.dev/blog/best-open-source-rag-frameworks)

### Node/Visual Programming
- [NodeTool](https://github.com/nodetool-ai/nodetool)
- [Rivet](https://rivet.ironcladapp.com/)
- [ChainForge](https://github.com/ianarawjo/ChainForge)
- [Invoke AI](https://invoke.ai/)

### WebSocket/Streaming
- [web-llm](https://github.com/mlc-ai/web-llm)
- [Resonance Framework](https://github.com/distantmagic/resonance)
- [Ollama Tool Calling Docs](https://docs.ollama.com/capabilities/tool-calling)
- [ComfyUI LLM Toolkit](https://github.com/Big-Idea-Technology/ComfyUI_LLM_Node)

### Creative AI
- [AgoraAI Paper](https://www.mdpi.com/2076-3417/16/4/2120)
- [NeurIPS Creative AI 2025](https://neurips.cc/Conferences/2025/CallForCreativeAI)
