# Veille OSS -- kxkm_clown / 3615-KXKM
**Date**: 2026-03-20

---

## Delta depuis le 2026-03-19

| # | Projet | Quoi de neuf | Impact kxkm | Action |
|---|--------|-------------|-------------|--------|
| 1 | **Ollama v0.18** | Web search/fetch natif, ROCm 7, Qwen3.5 + Nemotron-3-Super, fix tool calls Qwen3/3.5 thinking mode, `--yes` non-interactif | **CRITIQUE** | Mettre a jour Ollama sur kxkm-ai, tester Qwen3.5:9b comme modele persona |
| 2 | **Qwen3.5 9B** | Nouveau modele mars 2026, 256K context, multimodal, tool calling natif, bat GPT-OSS-120B sur plusieurs benchmarks (13x plus petit) | **TRES HAUT** | `ollama pull qwen3.5:9b` -- candidat ideal pour remplacer les modeles persona actuels |
| 3 | **LightRAG v1.4.11rc2** | Makefile deploy, batch query embeddings, BFS deque perf, Qdrant batching fix, reduction taille meta.json Faiss | **HAUT** | Mettre a jour LightRAG, attention: necessite qdrant-client >= 1.11.0 |
| 4 | **ACE-Step 1.5** | 34.48x RTF sur RTX 4090 (1.74s/min audio), LoRA + ControlNet, ComfyUI natif, 50+ langues, Apache 2.0 | **HAUT** | Integrer via ComfyUI node pour generation musicale des personnages |
| 5 | **Docling (Heron)** | Nouveau modele layout Heron (+23.5% mAP), support WAV/MP3, export WebVTT, parsing PPTX/XLSX | **MOYEN-HAUT** | Evaluer pour pipeline RAG documents complexes (remplace parsing PDF custom) |
| 6 | **Jina Reranker v3** | 0.6B params, 61.94 nDCG-10 BEIR (+5.43% vs bge-reranker-v2-m3), 131K context, listwise, GGUF dispo | **HAUT** | Remplacer bge-reranker par Jina v3 pour le pipeline RAG (meilleur multilingual) |
| 7 | **SearXNG 2026.3.18** | Release du 18 mars, maintenance active, 242 moteurs | **FAIBLE** | Deja a jour, rien a faire |
| 8 | **react-window v2** | Rename FixedSizeList -> List (breaking), useDynamicRowHeight hook, fix grid 1-row height, TS ReactElement types | **MOYEN** | Verifier si kxkm utilise FixedSizeList import -- migration necessaire vers `List` |
| 9 | **DeepSeek V3.2** | 685B MoE, MIT license, bat GPT-5 en reasoning, 128K context, Sparse Attention | **INFO** | Trop gros pour local (RTX 4090), mais dispo via API si besoin de reasoning lourd |
| 10 | **Pocket TTS** | Repo actif (derniere activite 12 mars), pas de release majeure depuis janvier | **FAIBLE** | Pas de changement, garder dans le radar |

---

## 1. Ollama v0.18 (17 mars 2026)

- **URL**: https://github.com/ollama/ollama/releases/tag/v0.18.0
- **Version actuelle**: v0.18.2-rc0

### Nouveautes majeures
- **Web search & fetch natif**: Plugin OpenClaw integre, les modeles peuvent chercher sur le web sans proxy externe
- **Fix tool calls Qwen3/3.5**: Les tool calls emis pendant le mode "thinking" sont maintenant parses correctement
- **Tool call indices**: Support des indices dans les tool calls paralleles (crucial pour le multi-tool)
- **`--yes` flag**: Mode non-interactif pour scripts/CI/deploy.sh
- **ROCm 7**: Support AMD mis a jour (pas pertinent pour kxkm-ai/NVIDIA mais note)
- **Cloud models sans pull**: Tag `:cloud` connecte automatiquement aux modeles cloud

### Nouveaux modeles disponibles
- **Qwen3.5 9B**: Multimodal, 256K context, tool calling, thinking -- **star du lot**
- **Nemotron-3-Super 122B**: Reasoning + tool calling haut de gamme (tient sur RTX 4090 en Q4)
- **Kimi-K2.5, GLM-5, MiniMax**: Nouveaux providers cloud

### Recommandation
```bash
# Sur kxkm-ai:
ollama pull qwen3.5:9b        # 6.6GB, multimodal + tools
ollama pull nemotron-3-super   # si besoin reasoning lourd
```
**Priorite**: IMMEDIATE -- le fix tool calling Qwen3 impacte directement le routage persona.

---

## 2. Qwen3.5 9B -- Nouveau modele reference

- **URL**: https://ollama.com/library/qwen3.5:9b
- **Taille**: 6.6GB (Q4_K_M)
- **Context**: 256K tokens
- **Capacites**: Texte + Image (vision), thinking mode, tool calling natif

### Pourquoi c'est important pour kxkm
- **256K context** = conversations longues multi-persona sans troncature
- **Tool calling natif** = routage d'outils fiable pour les actions de personas (web search, generation image, TTS)
- **Vision** = les personas peuvent analyser des images envoyees par l'utilisateur
- **9B params** = tourne confortablement sur RTX 4090 avec marge pour 2-3 modeles charges simultanement
- **Bat GPT-OSS-120B** sur plusieurs benchmarks tout en etant 13x plus petit

### Recommandation
Tester comme remplacement du modele persona par defaut. Le ratio performance/taille est exceptionnel.

---

## 3. LightRAG v1.4.11rc2

- **URL**: https://github.com/HKUDS/LightRAG/releases
- **Date**: Mars 2026

### Changements depuis v1.4.10 (derniere version notee)
- **Makefile de deploiement**: `make env-base`, `make storage`, `make server` -- deploiement modulaire
- **Perf batch embeddings**: Pre-calcul batch des embeddings de requete (elimine les round-trips sequentiels API)
- **Perf BFS**: `deque` pour la queue BFS dans `get_knowledge_subgraph()` -- plus rapide sur gros graphes
- **Fix Qdrant**: Batching borne pour les gros upserts (evite les failures de payload)
- **Fix Faiss**: Reduction taille meta.json en excluant les vecteurs

### Breaking change
- Necessite `qdrant-client >= 1.11.0` (tenant indexing)
- Migration de donnees potentiellement longue pour gros datasets

### Recommandation
Mettre a jour apres backup. Le batch embeddings va accelerer les requetes RAG multi-persona.

---

## 4. ACE-Step 1.5 -- Generation musicale

- **URL**: https://github.com/ace-step/ACE-Step-1.5
- **Paper**: https://arxiv.org/abs/2602.00744
- **Licence**: Apache 2.0

### Benchmarks RTX 4090
| Hardware | RTF | Temps/min audio | VRAM |
|----------|-----|-----------------|------|
| RTX 5090 | ~50x | ~1.2s | <4GB |
| **RTX 4090** | **34.48x** | **1.74s** | **<4GB** |
| RTX 3090 | 12.76x | ~4.7s | <4GB |
| A100 | ~30x | ~2s | <4GB |

### Capacites
- **50+ langues** dont le francais
- **LoRA + ControlNet** pour fine-tuning style/voix
- **Cover generation, repainting, vocal-to-BGM**
- **Voice cloning et style transfer**
- **ComfyUI natif**: Node `ComfyUI_ACE-Step` disponible

### Integration kxkm
- ComfyUI deja dans le stack -> integration directe via node
- < 4GB VRAM = peut cohabiter avec Ollama sur la RTX 4090
- Cas d'usage: chaque persona pourrait avoir sa "signature musicale" generee dynamiquement
- Generation d'ambiances sonores pour les performances

### Recommandation
Installer le node ComfyUI ACE-Step. Tester la generation de jingles/ambiances par persona.

---

## 5. Docling -- Parsing de documents (modele Heron)

- **URL**: https://github.com/docling-project/docling
- **Derniere release**: 14 mars 2026

### Nouveau modele Heron
- **+23.5% mAP** vs ancien modele de layout Docling
- Architecture RT-DETRv2 (Real-Time DEtection TRansformer)
- Developpe par IBM Research
- Meilleure distinction titre/paragraphe/image

### Formats supportes (nouveautes en gras)
- PDF, DOCX, PPTX, XLSX, HTML
- **WAV, MP3** (transcription audio)
- **WebVTT** (sous-titres)
- Images (PNG, TIFF, JPEG)
- LaTeX

### Exports
- Markdown, HTML, WebVTT, DocTags, JSON lossless

### Recommandation
Evaluer Docling + Heron comme pre-processeur pour le pipeline RAG LightRAG. Le support WAV/MP3 est interessant pour indexer du contenu audio des performances.

---

## 6. Jina Reranker v3 -- Alternative a bge-reranker

- **URL**: https://huggingface.co/jinaai/jina-reranker-v3
- **Taille**: 0.6B params (base Qwen3-0.6B)

### Comparaison avec bge-reranker-v2-m3

| Metrique | bge-reranker-v2-m3 | Jina Reranker v3 | Delta |
|----------|-------------------|-------------------|-------|
| nDCG-10 BEIR | ~58.5 | 61.94 | +5.43% |
| MIRACL (18 langues) | ~60 | 66.50 | +10% |
| Francais (MIRACL) | ~62 | ~68 (estime) | significatif |
| Context window | 8K | 131K | 16x |
| Architecture | Cross-encoder | Listwise (64 docs) | plus efficace |

### Deployment local
- Transformers: `AutoModel.from_pretrained('jinaai/jina-reranker-v3')`
- GGUF quantise disponible
- vLLM compatible
- **Attention**: Licence CC BY-NC 4.0 (non-commercial). Contacter Jina pour usage commercial.

### Alternatives open-source (licence permissive)
- **bge-reranker-v2.5-gemma2-lightweight**: Base Gemma-2-9B, token compression, Apache 2.0
- **Zerank-2**: 40x moins cher que Cohere, 100+ langues, scores calibres

### Recommandation
Pour kxkm (projet non-commercial): migrer vers Jina Reranker v3. Le gain multilingual est substantiel pour le contenu francais. Si la licence pose probleme: rester sur bge-reranker-v2.5-gemma2-lightweight.

---

## 7. SearXNG 2026.3.18

- **URL**: https://github.com/searxng/searxng
- **Version**: 2026.3.18+3810dc9d1

### Changements
- Maintenance continue, 242 moteurs de recherche
- Ameliorations detection de langue et filtrage
- Securite renforcee
- 58 traductions, ~70 instances publiques

### Recommandation
Rien d'urgent. Mettre a jour si ce n'est pas fait. L'integration Ollama v0.18 web search pourrait completer ou remplacer le proxy SearXNG pour certains cas d'usage.

---

## 8. react-window v2 -- Breaking changes

- **URL**: https://github.com/bvaughn/react-window
- **Issue tracking**: https://github.com/bvaughn/react-window/issues/302

### Breaking changes v1 -> v2
- **`FixedSizeList` renomme en `List`** -- import cassant pour tout le code existant
- **`FixedSizeGrid` renomme en `Grid`** -- idem
- `rowComponent`/`cellComponent` return type: `ReactNode` -> `ReactElement` (TS)
- Incompatibilite confirmee avec FluentUI et autres libs qui dependaient de `FixedSizeList`

### Nouveautes v2
- **`useDynamicRowHeight` hook** -- plus besoin de VariableSizeList hacky
- Bundle NPM reduit
- Fix: grids 1 row ne forcent plus height 100%
- RangeError (au lieu de Error) pour index invalides

### Recommandation
Verifier les imports dans le code kxkm. Si `FixedSizeList` est utilise, migrer vers `List`. Le hook `useDynamicRowHeight` resout potentiellement les problemes de virtualisation qu'on avait.

---

## 9. Qwen3-TTS -- Status

- **URL**: https://github.com/QwenLM/Qwen3-TTS
- **Licence**: Apache 2.0

### Rappel capacites (pas de changement majeur depuis le 19)
- 0.6B et 1.7B params, 97ms latence premier token
- Voice design par langage naturel
- 10 langues dont le francais (qualite "forte et consistante")
- 1.835% WER moyen, 0.789 speaker similarity
- Clone 3s, streaming natif

### Francais specifiquement
Le francais est confirme parmi les langues ou Qwen3-TTS montre une qualite "generalement forte et consistante". Pas de mise a jour specifique francais depuis la release initiale.

### Recommandation
Pas de changement par rapport au 19 mars. Tester Qwen3-TTS pour les voix de personas avec le design par prompt NL.

---

## 10. Piper TTS -- Status francais

- **URL**: https://github.com/rhasspy/piper
- **Voix francaises**: https://rhasspy.github.io/piper-samples/

### Status
- Pas de release majeure en 2026
- Les voix francaises restent "legerement plus robotiques" que les alternatives (Kokoro, Chatterbox)
- Modeles communautaires francais disponibles (https://github.com/tjiho/French-tts-model-piper)
- Reste pertinent pour le chemin ultra-basse-latence CPU (Raspberry Pi, edge)

### Recommandation
**Migrer vers Pocket TTS ou Kokoro-82M** pour le chemin CPU francais. Garder Piper uniquement si deploiement edge Raspberry Pi est envisage.

---

## Modeles LLM notables (mars 2026)

| Modele | Params | Licence | Notes |
|--------|--------|---------|-------|
| **Qwen3.5 9B** | 9B | Apache 2.0 | Multimodal, 256K, tool calling, **recommande** |
| Nemotron-3-Super | 122B | ? | Reasoning + tool calling, tient sur 4090 Q4 |
| DeepSeek V3.2 | 685B MoE | MIT | Trop gros pour local, API only |
| DeepSeek V3.2-Speciale | 685B+ | MIT | Bat GPT-5 en reasoning |
| GPT-OSS | 120B | Open | Reference OpenAI |
| Llama 4 | varies | Meta | Derniere generation Meta |
| Gemma 3 | varies | Google | Petits modeles efficaces |

---

## Feuille de route mise a jour

### Immediat (cette semaine)

| Action | Effort | Impact |
|--------|--------|--------|
| `ollama pull qwen3.5:9b` + test persona | 1h | Fort -- meilleur modele rapport perf/taille |
| Mettre a jour Ollama v0.18 sur kxkm-ai | 30min | Fort -- fix tool calling Qwen3 |
| Mettre a jour LightRAG v1.4.11 | 2h | Moyen -- perf batch embeddings |
| Verifier imports react-window v2 | 1h | Bloquant si breaking |

### Court terme (semaine prochaine)

| Action | Effort | Impact |
|--------|--------|--------|
| Installer ACE-Step 1.5 ComfyUI node | 2h | Moyen -- generation musicale personas |
| Evaluer Jina Reranker v3 vs bge-reranker | 3h | Fort -- +5% retrieval multilingual |
| Tester Docling Heron pour pipeline RAG | 3h | Moyen -- meilleur parsing docs |

### Moyen terme

| Action | Effort | Impact |
|--------|--------|--------|
| Migrer Piper -> Kokoro/Pocket TTS (CPU path) | 1-2j | Moyen -- meilleure qualite francais |
| Integrer Qwen3-TTS voice design par persona | 3-5j | Fort -- voix uniques par persona |
| Evaluer web search natif Ollama vs SearXNG | 2h | Faible -- SearXNG fonctionne deja |

---

## Sources

### Ollama
- [Ollama Releases](https://github.com/ollama/ollama/releases)
- [Ollama v0.18.0](https://github.com/ollama/ollama/releases/tag/v0.18.0)
- [Qwen3.5 sur Ollama](https://ollama.com/library/qwen3.5:9b)
- [Ollama Tool Calling Docs](https://docs.ollama.com/capabilities/tool-calling)
- [Ollama Blog](https://ollama.com/blog)

### LLM Models
- [DeepSeek V3.2](https://huggingface.co/deepseek-ai/DeepSeek-V3.2)
- [Best Open-Source LLMs 2026](https://www.bentoml.com/blog/navigating-the-world-of-open-source-large-language-models)
- [7 Best LLM Tools Local (Unite.AI)](https://www.unite.ai/best-llm-tools-to-run-models-locally/)

### RAG & Reranking
- [LightRAG Releases](https://github.com/HKUDS/LightRAG/releases)
- [Jina Reranker v3](https://jina.ai/models/jina-reranker-v3/)
- [Jina Reranker v3 HuggingFace](https://huggingface.co/jinaai/jina-reranker-v3)
- [Best Reranker Models 2026](https://docs.bswen.com/blog/2026-02-25-best-reranker-models/)
- [Reranker Leaderboard](https://agentset.ai/rerankers)

### TTS
- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)
- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts)
- [Piper TTS](https://github.com/rhasspy/piper)
- [Kokoro-82M](https://github.com/hexgrad/kokoro)

### Music Generation
- [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5)
- [ACE-Step 1.5 Paper](https://arxiv.org/abs/2602.00744)
- [ComfyUI ACE-Step](https://github.com/ace-step/ACE-Step-ComfyUI)
- [ACE-Step ComfyUI Blog](https://blog.comfy.org/p/ace-step-15-is-now-available-in-comfyui)

### Document Parsing
- [Docling](https://github.com/docling-project/docling)
- [Docling Docs](https://docling-project.github.io/docling/)

### Search
- [SearXNG](https://github.com/searxng/searxng)
- [SearXNG Docs](https://docs.searxng.org/)

### UI
- [react-window v2 Changes](https://github.com/bvaughn/react-window/issues/302)
- [react-window Releases](https://github.com/bvaughn/react-window/releases)
- [react-window CHANGELOG](https://github.com/bvaughn/react-window/blob/main/CHANGELOG.md)

### Audio / Composition (recherche 2026-03-20 22:00)
- [wavesurfer.js](https://wavesurfer.xyz/) — Waveform visualization, Web Audio API + Canvas, MIT
- [@wavesurfer/react](https://www.npmjs.com/package/@wavesurfer/react) — Official React hook + component, all wavesurfer options as props
- Plugins: regions (clickable overlays), timeline, spectrogram, minimap, hover, envelope, microphone
- Candidat ideal pour lot-194 (waveform visualization dans CompositionView)
- [Demucs v4 (htdemucs)](https://github.com/facebookresearch/demucs) — Meta, MIT license, pip install demucs
- Hybrid Transformer architecture, SDR 9.20 dB sur MUSDB HQ
- 6-stem mode: vocals, drums, bass, other, piano, guitar (htdemucs_6s)
- htdemucs_ft (fine-tuned) pour meilleure qualite, mdx_extra pour vitesse
- GPU recommande, fonctionne aussi CPU (plus lent)
- Candidat ideal pour lot-199 (stem separation)
