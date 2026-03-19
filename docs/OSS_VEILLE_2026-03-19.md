# Veille OSS — 2026-03-19

Mise a jour veille projets et librairies open source pour 3615-KXKM.

## Top recommandations (impact/effort)

| Priorite | Projet | Usage | URL |
| --- | --- | --- | --- |
| 1 | Chatterbox Turbo | TTS zero-shot, 350M, emotion tags, MIT | https://github.com/resemble-ai/chatterbox |
| 2 | LightRAG v1.4.11 | Graph RAG, Ollama natif, workspace isolation | https://github.com/HKUDS/LightRAG |
| 3 | Qwen3-TTS | TTS 0.6B-1.7B, clone 3s, 10 langues, Apache 2.0 | https://github.com/QwenLM/Qwen3-TTS |
| 4 | Kokoro | TTS 82M params, ultra-leger, CPU | https://github.com/hexgrad/kokoro |
| 5 | AgoraAI | Multi-persona voice-to-voice, dual-queue async | https://www.mdpi.com/2076-3417/16/4/2120 |
| 6 | vault66-crt-effect | React CRT presets (npm install) | https://github.com/mdombrov-33/vault66-crt-effect |
| 7 | webgl-crt-shader | WebGL GPU CRT shader, jan 2026 | https://github.com/gingerbeardman/webgl-crt-shader |
| 8 | NexusRAG | Hybrid: LightRAG + Docling + Ollama | https://github.com/LeDat98/NexusRAG |
| 9 | Pocket TTS | 100M params, CPU temps reel, voice cloning | https://github.com/kyutai-labs/pocket-tts |
| 10 | LiveKit Agents v1.4.5 | Voice/WebRTC, MCP natif, Apache 2.0 | https://github.com/livekit/agents |

## Nouvelles decouvertes (mars 2026)

### TTS

- **Qwen3-TTS** (Alibaba, jan 2026) — 0.6B-1.7B params, clone voix en 3s, 10 langues, latence 97ms, Apache 2.0. FastAPI OpenAI-compat. Concurrent serieux de Chatterbox.
- **Pocket TTS** (Kyutai) — 100M params, CPU temps reel, voice cloning. Ultra-leger, ideal edge/embarque. ~3600 stars.
- **Chatterbox Turbo** — 350M params, 1-step diffusion, tags paralinguistiques [laugh] [cough]. Multilingual (23 langues).

### RAG

- **LightRAG v1.4.11rc2** (13 mars 2026) — 29.4k stars. Nouveau Makefile, batch query embeddings, Qdrant fixes.
- **RAG-Anything** (HKUDS) — Extension LightRAG pour multimodal (images, tables, formules).
- **NexusRAG** — Hybrid: vector + LightRAG graph + cross-encoder reranking + Docling. Supporte Ollama nativement.
- **ApeRAG** — Production-ready GraphRAG, multi-modal, MCP support, K8s.

### Multi-persona / Agents

- **AgoraAI** (fev 2026, paper MDPI) — Framework voice-to-voice multi-persona. Resout le "Concurrency-Coherence Paradox" via Asynchronous Dual-Queue Processing. Directement applicable au use-case kxkm_clown.
- **CrewAI** — 44.3k stars, role-playing agents. Trop enterprise pour kxkm.
- **LobeChat Agent Groups** — Equipes d'agents specialises collaborant en parallele.

### MCP 2026

- **Roadmap 2026** : Streamable HTTP (serveurs MCP distants sans etat), Tasks (lifecycle), Enterprise (audit, SSO, gateway).
- **Ecosysteme** : OpenAI et Microsoft supportent MCP. Catalogue mcpservers.org.
- **LiveKit Agents** : Integration MCP native depuis v1.4.

### UI Retro / CRT

- **webgl-crt-shader** (gingerbeardman, jan 2026) — WebGL pur, GPU-accelere, tweakable. Plus performant qu'overlay CSS.
- **crt-beam-simulator** (Blur Busters) — Simulation physique du faisceau CRT, le plus realiste.

## Par categorie (mise a jour)

### TTS

| Projet | Stars | Licence | Notes |
| --- | --- | --- | --- |
| Chatterbox Turbo | 11k+ | MIT | Zero-shot, emotion, 350M, 1-step diffusion |
| Qwen3-TTS | Nouveau | Apache 2.0 | 0.6B-1.7B, clone 3s, 10 langues |
| Kokoro | 3k+ | Apache | 82M, ultra-rapide, CPU |
| Pocket TTS | 3.6k | Open | 100M, CPU temps reel |
| RealtimeTTS | 3.8k | MIT | Abstraction multi-backends |
| OpenVoice | 36k | MIT | Voice cloning zero-shot |

### RAG

| Projet | Stars | Notes |
| --- | --- | --- |
| LightRAG | 29.4k | Graph RAG, Ollama natif, v1.4.11rc2 |
| RAGFlow | 70k+ | Enterprise, deep document understanding |
| NexusRAG | Nouveau | Hybrid LightRAG + Docling + Ollama |
| ApeRAG | Nouveau | GraphRAG, MCP, K8s |

### Embeddings

| Modele | Taille | Ollama | Notes |
| --- | --- | --- | --- |
| nomic-embed-text | ~137M | Oui | Baseline actuelle |
| BGE-M3 | ~568M | Oui | Hybrid dense+sparse, multilingual |
| mxbai-embed-large | ~335M | Oui | Depasse text-embedding-3-large |
| Qwen3-Embedding-0.6B | 600M | A verifier | Nouveau 2026 |

### Voice temps reel

| Projet | Stars | Notes |
| --- | --- | --- |
| LiveKit Agents | 9.7k | v1.4.5, MCP natif, Apache 2.0 |
| pipecat | Actif | Voice/multimodal conversational AI |
| AgoraAI | Paper | Multi-persona voice, dual-queue |
