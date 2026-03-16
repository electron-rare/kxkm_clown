# State of the Art -- Mars 2026

> Technologies pertinentes pour le projet KXKM_Clown : systeme multi-persona AI chat, esthetique IRC, inference LLM locale (Ollama), Node Engine DAG, pipeline LoRA/DPO, frontend React.
>
> Date de recherche : 16 mars 2026

---

## 1. Inference LLM Locale (Mars 2026)

### 1.1 Ollama

**Version courante : v0.18.0** (13 mars 2026)

- **Cloud Models** : les modeles cloud ne necessitent plus `ollama pull` ; le tag `:cloud` connecte automatiquement.
- **Mode non-interactif** : flag `--yes` pour `ollama launch`, utile pour les agents/scripts.
- **Monitoring memoire** : `ollama run --verbose` affiche le pic memoire (moteur MLX).
- **ROCm 7** embarque ; Windows ARM64 natif.
- **Performance** : jusqu'a +35 % de generation de tokens sur RTX grace au FP8, GPU token sampling, et ameliorations de concurrence.

Sources :
- [Releases ollama/ollama](https://github.com/ollama/ollama/releases)
- [Ollama Setup 2026 | SitePoint](https://www.sitepoint.com/ollama-setup-guide-2026/)
- [Best Ollama Models 2026 | StudyHUB](https://studyhub.net.in/techtools/best-ollama-models-in-2026-top-10-ranked-by-use-case-hardware/)

### 1.2 Meilleurs petits modeles pour chat personas (< 8 GB VRAM)

| Modele | Params | VRAM (Q4) | Points forts |
|---|---|---|---|
| **Qwen3.5-4B** | 4B | ~8 GB | Meilleur overall, multimodal natif, 262K contexte |
| **Phi-4-mini** | 3.8B | ~7.5 GB | Raisonnement (83.7 % ARC-C, 88.6 % GSM8K) |
| **Gemma 3 4B** | 4B | ~8 GB | Coding & maths (71.3 % HumanEval) |
| **Gemma 3n E4B** | 8B (footprint 4B) | ~3 GB | Optimal mobile, architecture selective |
| **Llama 3.2 3B** | 3B | ~2 GB | Ultra-leger, baseline fonctionnel |

La famille **Qwen3.5** (fevrier-mars 2026) ajoute les tailles 0.8B, 2B, 4B, 9B avec multimodalite native (texte+image+video) et support de 201 langues.

Sources :
- [Best Open-Source SLMs 2026 | BentoML](https://www.bentoml.com/blog/the-best-open-source-small-language-models)
- [Small Language Models Guide 2026 | Local AI Master](https://localaimaster.com/blog/small-language-models-guide-2026)
- [Qwen3.5 Small Series | Medium](https://medium.com/data-science-in-your-pocket/qwen-3-5-small-model-series-released-7a5ed34fcbb3)

**Pertinence pour KXKM_Clown** : Qwen3.5-4B est le candidat ideal pour les personas -- multimodal, multilangue, contexte long. Phi-4-mini pour les personas a forte dominante raisonnement. Llama 3.2 3B pour les machines les plus contraintes. Tous tournent dans Ollama.

### 1.3 Meilleurs modeles vision locaux

| Modele | Taille | Points forts |
|---|---|---|
| **Qwen3-VL 8B** | 8B | Leader : 85.8 MathVista, OCR, graphiques, captures |
| **MiniCPM-V 2.6** | ~8.1B / 5.5 GB | Compact, multi-images, video, 1.8 Mpx |
| **Qwen2.5-VL** | 7B | Window attention ViT, localisation objets |
| **InternVL** | Varies | Rivalise GPT-4V en raisonnement visuel |
| **Gemma 3 / Phi-4** | 4B-14B | Depassent LLaVA a taille comparable |

LLaVA est desormais depasse par les modeles ci-dessus.

Sources :
- [Best Local VLMs | Roboflow](https://blog.roboflow.com/local-vision-language-models/)
- [Top 10 VLMs 2026 | DataCamp](https://www.datacamp.com/blog/top-vision-language-models)
- [Benchmarking VLMs | Clarifai](https://www.clarifai.com/blog/benchmarking-best-open-source-vision-language-models)

**Pertinence pour KXKM_Clown** : Qwen3-VL peut ajouter une capacite de comprehension d'images aux personas (partage d'images dans le chat IRC). MiniCPM-V est le meilleur compromis taille/performance.

### 1.4 Moteurs d'inference : vLLM, SGLang, llama.cpp

| Moteur | Perf (H100, Llama 3.1 8B) | Atout cle |
|---|---|---|
| **SGLang** | ~16 200 tok/s | RadixAttention (cache prefix arborescent), +10-20 % multi-turn |
| **vLLM v0.7.3** | ~12 500 tok/s | Multi-LoRA switching, speculative decoding mature, Blackwell B200 |
| **llama.cpp** | N/A (CPU/hybride) | 1-bit weights merge, GGUF natif, CPU offloading |

**Speculative decoding** : speedup 2-3x en scenarios memory-bound ; supporte par vLLM et SGLang.

Sources :
- [LLM Inference Engine Comparison 2026 | n1n.ai](https://explore.n1n.ai/blog/llm-inference-engine-comparison-vllm-tgi-tensorrt-sglang-2026-03-13)
- [vLLM vs SGLang vs LMDeploy | PremAI](https://blog.premai.io/vllm-vs-sglang-vs-lmdeploy-fastest-llm-inference-engine-in-2026/)
- [SGLang vs vLLM | Local AI Master](https://localaimaster.com/blog/sglang-vs-vllm-comparison)

**Pertinence pour KXKM_Clown** : Ollama (base llama.cpp) reste le choix pragmatique pour le dev local. vLLM interessant en production pour le multi-LoRA switching (une LoRA par persona). SGLang optimal pour le multi-turn chat.

### 1.5 Quantization (GGUF, AWQ, GPTQ, EXL2)

| Format | Retention qualite | Atout |
|---|---|---|
| **AWQ 4-bit** | ~95 % | Meilleur qualite/bit, activation-aware |
| **GGUF Q4_K_M** | ~92 % | Pragmatique, CPU offloading, defaut Ollama |
| **GPTQ 4-bit** | ~90 % | Ecosysteme mature |
| **EXL2** | Variable | 2-3x plus rapide que GGUF quand tout en VRAM, flexible |

GGUF Q4_K_M reste le defaut pragmatique pour Ollama. EXL2 domine quand le VRAM le permet.

Sources :
- [Quantization Explained 2026 | Local AI Master](https://localaimaster.com/blog/quantization-explained)
- [Quantization Methods Compared | ai.rs](https://ai.rs/ai-developer/quantization-methods-compared)

**Pertinence pour KXKM_Clown** : rester sur GGUF Q4_K_M pour Ollama. Envisager AWQ si migration vers vLLM pour la production multi-persona.

---

## 2. Fine-Tuning & Alignement (Mars 2026)

### 2.1 Unsloth

**Version courante : unsloth-zoo 2026.3.2**

- **MoE 12x plus rapide**, 35 % moins de VRAM, 6x plus de contexte (via kernels Triton).
- **30x plus rapide que Flash Attention 2** avec 30 % de precision en plus et 90 % de memoire en moins.
- Support audio, embedding, vision.
- Modeles supportes : gpt-oss, Qwen3 (30B, 235B, VL, Coder), DeepSeek R1/V3, GLM.
- Collaboration HuggingFace : 1.8-3.3x plus rapide pour les modeles d'embedding/BERT/classifieurs.
- Compatible : Tesla T4 a H100 ; portable AMD/Intel.

Sources :
- [Unsloth AI](https://unsloth.ai/)
- [Unsloth GitHub](https://github.com/unslothai/unsloth)
- [Fine-tuning RTX + Unsloth | NVIDIA](https://blogs.nvidia.com/blog/rtx-ai-garage-fine-tuning-unsloth-dgx-spark/)

**Pertinence pour KXKM_Clown** : Unsloth est l'outil ideal pour fine-tuner les personas sur GPU consumer. Support natif Qwen3 + LoRA + GRPO = pipeline complete persona.

### 2.2 TRL (Transformers Reinforcement Learning)

Librairie HuggingFace de reference pour le post-training :

- **SFT** : Supervised Fine-Tuning standard
- **DPO** : Direct Preference Optimization -- evite le reward model explicite
- **ORPO** : combine SFT + preference en un seul objectif (gain de temps)
- **KTO** : Kahneman-Tversky Optimization -- feedback binaire (pouce haut/bas) au lieu de paires
- **GRPO** : Group Relative Policy Optimization -- elimine le critic, echantillonne un groupe de reponses, normalise les rewards intra-groupe

**Tendance 2026** : GRPO, DAPO et RLVR ont remplace RLHF comme stack post-training dominant. Le pipeline moderne : SFT pour instruction-following, puis preference optimization (DPO/KTO) pour l'alignement, puis RL avec rewards verifiables (GRPO/DAPO) pour le raisonnement.

- **DAPO** (Decoupled clip And dynamic sampling Policy Optimization) : 4 techniques pour stabiliser l'entrainement long-CoT : Clip-Higher, Dynamic Sampling, Token-level PG Loss, Overlong Reward Shaping.
- **RLVR** : rewards provenant de verification programmatique (math, code) au lieu de labels humains. DeepSeek-R1 a demontre des capacites de raisonnement emergentes via RLVR pur.

Sources :
- [Post-Training 2026: GRPO, DAPO, RLVR | llm-stats](https://llm-stats.com/blog/research/post-training-techniques-2026)
- [TRL GitHub | HuggingFace](https://github.com/huggingface/trl)
- [Fine-Tuning 2026 Comparison | DEV](https://dev.to/ultraduneai/eval-003-fine-tuning-in-2026-axolotl-vs-unsloth-vs-trl-vs-llama-factory-2ohg)

**Pertinence pour KXKM_Clown** : pipeline DPO/KTO pour aligner chaque persona sur des preferences de style. GRPO envisageable si rewards verifiables (format, ton, longueur). ORPO pour simplifier le pipeline SFT+alignement en une passe.

### 2.3 Variantes LoRA

| Variante | Principe | Quand l'utiliser |
|---|---|---|
| **LoRA** | Matrices A et B low-rank | Defaut, toujours solide |
| **LoRA+** | Learning rates differents pour A et B (ratio lambda) | Convergence plus rapide |
| **DoRA** | Decompose poids en magnitude + direction (direction via LoRA) | Meilleur a faible rank |
| **QLoRA** | LoRA sur modele quantifie 4-bit | Reduit VRAM de moitie sans perte mesurable |
| **PiSSA** | Init LoRA via SVD des valeurs singulieres principales | Convergence rapide, stable a LR varies |
| **GaLore** | Projection low-rank des gradients (pas des poids) | Full fine-tuning memoire-efficace, pas compatible LoRA |

Decouverte 2026 : avec tuning attentif du learning rate, toutes les variantes atteignent des performances quasi identiques (differences 0.4-1.7 %). Le choix depend surtout de la facilite de convergence et du budget VRAM.

Sources :
- [Advanced LoRA Fine-Tuning | Kaitchup](https://kaitchup.substack.com/p/advanced-lora-fine-tuning-how-to)
- [Learning Rate Matters | arXiv](https://www.arxiv.org/pdf/2602.04998)
- [LoRA Guide | HuggingFace PEFT](https://huggingface.co/docs/peft/en/developer_guides/lora)

**Pertinence pour KXKM_Clown** : QLoRA reste le defaut pour fine-tuner sur GPU consumer. DoRA a considerer si le rank doit rester tres bas (r=8-16) pour minimiser la taille des adaptateurs persona.

### 2.4 Bonnes pratiques : fine-tuning < 1000 exemples

- **200-500 exemples** suffisent pour classification/extraction (LoRA).
- **500-2000** pour generation de contenu.
- **Qualite >> quantite** : 200 exemples curates > 2000 mediocres.
- Format : ChatML, ShareGPT, ou Alpaca.
- Deduplication + filtrage longueur obligatoire.
- **Hyperparams** : batch size plus grand + learning rate plus bas = meilleure performance. Gradient norms bas et loss haute en debut de training = bon signe.
- **Overfitting** : comparer train loss vs validation loss ; si outputs repetitifs, reduire les epochs.
- **QLoRA** pour diviser le VRAM par 2 sans perte mesurable.

Sources :
- [Fine-Tuning Small Datasets | Sapien](https://www.sapien.io/blog/strategies-for-fine-tuning-llms-on-small-datasets)
- [How Much Data to Fine-Tune | Particula](https://particula.tech/blog/how-much-data-fine-tune-llm)
- [Fine-Tuning Guide | Unsloth](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide)

**Pertinence pour KXKM_Clown** : avec ~200-500 exemples de dialogue par persona dans le style voulu, QLoRA via Unsloth devrait suffire. Format ChatML ideal pour le multi-turn.

### 2.5 Fusion d'adaptateurs (TIES, DARE, Task Arithmetic)

| Methode | Principe |
|---|---|
| **Task Arithmetic** | Soustrait poids base, manipule les task vectors, re-additionne |
| **TIES** | Trim (elague redondances), Elect Sign (resout conflits de signe), Merge (moyenne) |
| **DARE** | Dropout aleatoire sur les deltas avant TIES, rescale par 1/density |
| **DARE-TIES** | Combine DARE + TIES ; attention, peut etre trop agressif si deltas bien alignes |
| **ACM-TIES** | Coefficients layerwise via information mutuelle |

Les adaptateurs LoRA etant deja des tenseurs task-specific, la fusion est naturelle. LoRAX permet le merge dynamique multi-LoRA par requete en production.

Sources :
- [Model Merging for LLMs | NVIDIA](https://developer.nvidia.com/blog/an-introduction-to-model-merging-for-llms/)
- [PEFT Merging Methods | HuggingFace](https://huggingface.co/blog/peft_merging)
- [Model Merging Guide | PEFT docs](https://huggingface.co/docs/peft/developer_guides/model_merging)

**Pertinence pour KXKM_Clown** : potentiel pour creer des personas hybrides en fusionnant des LoRA de style/ton/domaine. TIES simple et efficace pour commencer.

---

## 3. Systemes Multi-Agent / Multi-Persona

### 3.1 Frameworks agents

| Framework | Modele | Atout 2026 |
|---|---|---|
| **LangGraph** | Graphe dirige, stateful | Standard production, observabilite LangSmith, human-in-the-loop |
| **CrewAI** | Equipes role-based | Low barrier, delegation parallele, support A2A |
| **AutoGen** | Conversationnel | Fusionne avec Semantic Kernel dans Microsoft Agent Framework (GA Q1 2026) |
| **OpenAgents** | Open-source | Seul framework avec support natif MCP + A2A |

LangGraph domine pour les workflows stateful en production. CrewAI pour le prototypage rapide d'equipes d'agents.

Sources :
- [Agent Frameworks Compared 2026 | OpenAgents](https://openagents.org/blog/posts/2026-02-23-open-source-ai-agent-frameworks-compared)
- [AutoGen vs LangGraph vs CrewAI 2026 | DEV](https://dev.to/synsun/autogen-vs-langgraph-vs-crewai-which-agent-framework-actually-holds-up-in-2026-3fl8)
- [Top 5 Agentic AI Frameworks 2026](https://futureagi.substack.com/p/top-5-agentic-ai-frameworks-to-watch)

**Pertinence pour KXKM_Clown** : le Node Engine DAG du projet s'inspire du meme modele que LangGraph (graphe dirige + etat). LangGraph pourrait servir de reference architecturale ou de remplacement si le Node Engine custom s'avere trop couteux a maintenir.

### 3.2 MCP (Model Context Protocol)

- **Standard de facto** pour connecter les modeles a des outils/fichiers/systemes externes.
- Adopte par Anthropic, OpenAI, Microsoft, Google, Amazon.
- Donne a l'**Agentic AI Foundation** (Linux Foundation) en decembre 2025 ; co-fondateurs : OpenAI, Block ; supporters : AWS, Google, Microsoft, Cloudflare, Bloomberg.
- **Roadmap 2026** : scalabilite transport, communication inter-agents, gouvernance, enterprise readiness.
- **Critique** : Perplexity abandonne MCP au profit d'APIs/CLI traditionnels (consommation context window trop elevee, auth compliquee).

Sources :
- [MCP Roadmap 2026 | The New Stack](https://thenewstack.io/model-context-protocol-roadmap-2026/)
- [MCP Enterprise Adoption 2026 | CData](https://www.cdata.com/blog/2026-year-enterprise-ready-mcp-adoption)
- [MCP Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)

**Pertinence pour KXKM_Clown** : MCP peut standardiser l'acces des personas a des outils externes (recherche web, fichiers, bases de connaissances). Attention a la consommation de contexte.

### 3.3 A2A (Agent-to-Agent Protocol)

- Protocole ouvert de Google (avril 2025) pour la communication inter-agents.
- **v0.3.0** en mars 2026 : support gRPC, security cards signees, SDK Python client.
- Donne a la **Linux Foundation** ; 150+ organisations supportent.
- Complementaire a MCP : MCP = agent-outils, A2A = agent-agent.

Sources :
- [A2A Protocol Upgrade | Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/agent2agent-protocol-is-getting-an-upgrade)
- [A2A Protocol](https://a2a-protocol.org/latest/)
- [A2A Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents)

**Pertinence pour KXKM_Clown** : A2A pourrait standardiser la communication inter-personas dans le Node Engine. Pertinent si les personas doivent collaborer (ex: un persona qui "repond" a un autre).

### 3.4 Systemes de memoire pour agents

| Systeme | Approche |
|---|---|
| **Letta** (ex-MemGPT) | LLM-as-OS : memoire core (toujours en prompt) + memoire archivale (BD searchable). L'agent gere activement sa propre memoire. |
| **Zep** | Graphe de connaissances temporel : memoire episodique, suivi des changements de faits dans le temps. |
| **Mem0** | Memoire graphe pour agents (janvier 2026) ; combine plusieurs types de memoire. |

Tendance 2026 : la memoire devient un composant explicite, gere activement par l'agent, pas un simple retrieval passif.

Sources :
- [Top 10 AI Memory Products 2026 | Medium](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)
- [Letta (MemGPT) Memory Models | Medium](https://medium.com/@piyush.jhamb4u/stateful-ai-agents-a-deep-dive-into-letta-memgpt-memory-models-a2ffc01a7ea1)
- [Letta Agent Memory Blog](https://www.letta.com/blog/agent-memory)

**Pertinence pour KXKM_Clown** : chaque persona pourrait avoir sa propre memoire persistante (souvenirs des conversations passees, preferences, relations avec les autres personas). L'approche Letta (core + archival memory) est la plus adaptee au use case multi-persona.

---

## 4. Chat UI & Frameworks

### 4.1 Open WebUI

- Interface self-hosted pour Ollama et APIs OpenAI-compatibles.
- **Mars 2026** : endpoint API format Anthropic Messages (permet Claude Code -> Open WebUI), tool calls en streaming, multi-session OAuth.
- Roadmap : note-taking integre avec AI, analytics/cost tracking.
- Supporte les modeles Ollama Cloud nativement.

Sources :
- [Open WebUI Docs](https://docs.openwebui.com/)
- [Open WebUI Features](https://docs.openwebui.com/features/)
- [Open WebUI Releases](https://github.com/open-webui/open-webui/releases)

### 4.2 LobeChat & LibreChat

**LobeChat** :
- Multi-model, plugin system (function-call), agent marketplace, knowledge base, voice chat (STT/TTS), image generation, PWA, themes custom.
- Support LLM locaux (Ollama).

**LibreChat** :
- Replica ChatGPT open-source, multi-user, plugin ecosystem.
- **Roadmap 2026** : Admin Panel GUI, Agent Skills, Programmatic Tool Calling, workflows interactifs (Q1-Q2).

Sources :
- [LibreChat vs LobeChat 2026](https://openalternative.co/compare/librechat/vs/lobechat)
- [LibreChat 2026 Roadmap](https://www.librechat.ai/blog/2026-02-18_2026_roadmap)

### 4.3 Librairies React pour chat

| Librairie | Description |
|---|---|
| **chatscope/chat-ui-kit-react** | Toolkit chat open-source, TypeScript, composable |
| **@llamaindex/chat-ui** | Composants React pour interfaces chat LLM |
| **assistant-ui** | Librairie TypeScript/React pour AI chat |
| **react-chat-elements** | Composants chat simples et legers |

### 4.4 Esthetique Terminal / IRC

Pas de librairie pre-faite pour l'esthetique IRC specifiquement. L'approche recommandee est de customiser une librairie existante (chatscope ou assistant-ui) avec du CSS retro (font monospace, couleurs terminales, prefixes de nick type `<pseudo>`, timestamps). Plusieurs projets open-source utilisent xterm.js ou des composants terminal React pour creer cette esthetique.

**Pertinence pour KXKM_Clown** : le projet a deja un frontend React custom avec esthetique IRC. chatscope ou assistant-ui pourraient fournir une base de composants pour accelerer le developpement tout en gardant le theming IRC via CSS custom.

---

## 5. Orchestration DAG

### 5.1 LangGraph vs Flowise vs n8n

| Outil | Approche | Quand l'utiliser |
|---|---|---|
| **LangGraph** | Code-first, graphe de noeuds LLM, stateful | Workflows agents complexes, multi-agent, production |
| **Flowise** | Visual low-code, base LangChain | Prototypage rapide, RAG standard |
| **n8n** | Visual + code, 1100+ integrations, Node.js | Automatisation business, APIs externes, event-driven |

LangGraph et n8n sont de plus en plus utilises ensemble : LangGraph pour l'orchestration agent fine-grained, n8n pour les integrations business.

Sources :
- [Flowise vs LangGraph vs n8n 2026 | Index](https://www.index.dev/skill-vs-skill/ai-langgraph-vs-n8n-vs-flowise)
- [AI Agent Orchestration | n8n Blog](https://blog.n8n.io/ai-agent-orchestration-frameworks/)
- [LangGraph vs n8n | ZenML](https://www.zenml.io/blog/langgraph-vs-n8n)

### 5.2 Dify

- Plateforme open-source pour workflows agentic visuels.
- **Mars 2026** : leve $30M Series Pre-A.
- RAG integre (PDF, PPT, extraction), 50+ outils built-in, RBAC, workspaces partages.
- Integrations vector DB : Qdrant, TiDB Vector.

Sources :
- [Dify AI](https://dify.ai/)
- [Dify $30M Funding | BusinessWire](https://www.businesswire.com/news/home/20260309511426/en/Dify-Raises-$30-million-Series-Pre-A-to-Power-Enterprise-Grade-Agentic-Workflows)

### 5.3 Prefect, Dagster, Airflow (ML Pipelines)

| Outil | Force | Ideal pour |
|---|---|---|
| **Prefect** | Python-native, dynamique, event-driven | Workflows flexibles, pas de DAG rigide |
| **Dagster** | Asset lineage, DX local forte | Pipelines "produit", tracabilite donnees |
| **Airflow** | Battle-tested, communaute massive | ETL schedule-based, ecosysteme existant |

Sources :
- [Orchestration Showdown | ZenML](https://www.zenml.io/blog/orchestration-showdown-dagster-vs-prefect-vs-airflow)
- [Data Pipeline Tools 2026 | Dagster](https://dagster.io/learn/data-pipeline-orchestration-tools)

**Pertinence pour KXKM_Clown** : le Node Engine DAG custom du projet est plus proche de LangGraph (graphe dirige d'operations LLM) que des orchestrateurs data classiques. Prefect pourrait servir pour le pipeline de fine-tuning (orchestrer les etapes d'entrainement, evaluation, deploiement des LoRA). Dify est une alternative "tout-en-un" si le projet voulait abandonner le Node Engine custom.

---

## 6. Embeddings & RAG

### 6.1 Meilleurs modeles d'embedding locaux

| Modele | Taille | Atout |
|---|---|---|
| **Qwen3-Embedding-8B** | 8B | #1 MTEB multilingual, 32K tokens, ideal RAG |
| **nomic-embed-text** | 274 MB | Leger et rapide, bat text-embedding-ada-002 |
| **mxbai-embed-large** | ~670 MB | Bat text-embedding-3-large, compact |
| **BGE-M3** | ~1.5 GB | 100+ langues, 8192 tokens, retrieval-focused |

Pour Ollama : `nomic-embed-text` (768d, 8K contexte) pour la majorite des setups ; `bge-m3` pour le multilangue.

Sources :
- [Best Embedding Models 2026 | Elephas](https://elephas.app/blog/best-embedding-models)
- [Ollama Embedding Models](https://ollama.com/blog/embedding-models)
- [Best Open Source Embedding Models | AImultiple](https://aimultiple.com/open-source-embedding-models)

### 6.2 ColBERT & Late Interaction Retrieval

- ColBERT utilise des representations token-level fine-grained pour un retrieval plus precis que le single-vector.
- **Extensions 2026** : ColPali (multimodal), VideoColBERT, reasoning-based retrieval.
- Toolkits : RAGatouille, PyLate, PyTerrier.
- Premier workshop dedie : **LIR @ ECIR 2026**.
- Particulierement efficace en out-of-domain et pour le long-context retrieval.

Sources :
- [Late Interaction Workshop @ ECIR 2026](https://www.lateinteraction.com/)
- [Late Interaction Overview | Weaviate](https://weaviate.io/blog/late-interaction-overview)

### 6.3 RAG local avec Ollama

Pipeline recommandee :
1. **Embedding** : `nomic-embed-text` via Ollama
2. **Vector store** : ChromaDB ou Qdrant (local)
3. **Retrieval** : similarity search ou ColBERT via RAGatouille
4. **Generation** : Qwen3.5-4B ou Llama 3.2 via Ollama

Sources :
- [Local RAG Pipeline Ollama + LangChain 2026](https://markaicode.com/build-local-rag-pipeline-ollama-langchain/)
- [Best Local LLMs for RAG 2026 | InsiderLLM](https://insiderllm.com/guides/best-local-llms-rag/)

**Pertinence pour KXKM_Clown** : RAG pertinent pour donner aux personas acces a une base de connaissances (lore, historique, contexte). Setup minimal : nomic-embed-text + ChromaDB + Ollama. ColBERT/RAGatouille pour une precision superieure si necessaire.

---

## Resume des recommandations pour KXKM_Clown

| Composant | Recommandation 2026 |
|---|---|
| **Modele chat persona** | Qwen3.5-4B (principal) / Phi-4-mini (raisonnement) / Llama 3.2 3B (leger) |
| **Modele vision** | Qwen3-VL 8B ou MiniCPM-V 2.6 |
| **Inference locale** | Ollama v0.18.0 (dev) ; vLLM pour production multi-LoRA |
| **Quantization** | GGUF Q4_K_M (Ollama) ; AWQ si vLLM |
| **Fine-tuning** | Unsloth + QLoRA, 200-500 exemples ChatML par persona |
| **Alignement** | DPO/KTO via TRL pour le style ; GRPO si rewards verifiables |
| **Adaptateurs** | QLoRA defaut, DoRA si rank tres bas |
| **Fusion personas** | TIES pour merges simples de LoRA |
| **Memoire persona** | Approche Letta (core + archival memory) |
| **Communication inter-persona** | Node Engine DAG custom (ref. architecturale : LangGraph) |
| **Protocoles** | MCP pour outils externes, A2A pour inter-agent |
| **Chat UI** | React custom + chatscope ou assistant-ui + CSS IRC |
| **RAG** | nomic-embed-text + ChromaDB + Ollama |
| **Pipeline ML** | Prefect pour orchestrer training/eval/deploy |
