# Spike: Integration LightRAG pour kxkm_clown

**Date**: 2026-03-19
**Auteur**: Claude (spike automatise)
**Statut**: DRAFT
**Version cible LightRAG**: v1.4.11 (lightrag-hku sur PyPI)

---

## 1. Resume de LightRAG

### Qu'est-ce que LightRAG ?

LightRAG (HKU) est un framework de Graph RAG open-source (licence MIT) qui combine
la recherche vectorielle classique avec un graphe de connaissances (knowledge graph)
extrait automatiquement des documents. Contrairement au RAG naif (chunk + cosine similarity),
LightRAG construit un graphe d'entites et de relations, ce qui permet des requetes
multi-niveaux : local (contexte precis), global (themes generaux), hybrid, et mix
(graphe + vecteurs combines).

### Fonctionnalites cles

| Fonctionnalite | Detail |
|---|---|
| **Graph RAG** | Extraction automatique d'entites/relations via LLM, stockage dans un graphe |
| **Modes de requete** | `local`, `global`, `hybrid`, `naive`, `mix` (KG + vecteurs), `bypass` |
| **Backends LLM** | OpenAI, Ollama, vLLM, Hugging Face, tout API compatible OpenAI |
| **Backends Embedding** | OpenAI, Ollama, Sentence-Transformers, API compatible |
| **Stockage vectoriel** | NanoVectorDB (defaut), PostgreSQL (pgvector), Milvus, Chroma, Faiss, Qdrant, MongoDB |
| **Stockage graphe** | NetworkX (defaut), Neo4J, PostgreSQL (AGE), OpenSearch |
| **Stockage KV** | JSON (defaut), PostgreSQL, Redis, MongoDB, OpenSearch |
| **Reranker** | Support natif (bge-reranker-v2-m3, Jina), ameliore significativement le mode mix |
| **API REST** | Serveur integre (lightrag-server) avec Web UI, API compatible Ollama |
| **Docker** | docker-compose officiel inclus |
| **Citations** | Support des citations/sources dans les reponses |
| **Deletion** | Suppression de documents avec regeneration automatique du KG |
| **Cache LLM** | Cache des reponses LLM pour eviter les appels redondants |

### Architecture interne

```
Documents
    |
    v
[Chunking (1200 tokens, overlap 100)]
    |
    v
[Embedding via Ollama/OpenAI] --> [Vector Store (pgvector)]
    |
    v
[Entity/Relation Extraction via LLM] --> [Knowledge Graph (NetworkX/PG)]
    |
    v
[KV Store (metadonnees, doc status)] --> [PostgreSQL/JSON]

Query:
  User Query --> [Embedding] --> [Vector Search] \
                                                  --> [Merge + Rerank] --> [LLM Generation]
              --> [KG Traversal (entites/relations)] /
```

---

## 2. Comparaison avec le RAG actuel (LocalRAG)

### LocalRAG actuel (`apps/api/src/rag.ts`)

Le systeme actuel est un RAG minimal in-memory en TypeScript :

- **Chunking** : Split par paragraphes, fusion des chunks courts (max 500 chars)
- **Embedding** : nomic-embed-text via Ollama `/api/embed`
- **Stockage** : En memoire (array de `DocumentChunk[]`), perdu au restart
- **Recherche** : Cosine similarity brute-force, seuil min 0.3
- **Documents indexes** : `manifeste.md`, `manifeste_references_nouvelles.md`
- **Integration** : Injecte via `ChatOptions.rag` dans ws-chat et ws-ollama

### Tableau comparatif

| Critere | LocalRAG (actuel) | LightRAG (cible) |
|---|---|---|
| **Type** | Vector RAG naif | Graph RAG + Vector RAG |
| **Langage** | TypeScript | Python |
| **Persistance** | Aucune (in-memory) | PostgreSQL / fichiers |
| **Chunking** | 500 chars, paragraphes | 1200 tokens, overlap intelligent |
| **Recherche** | Cosine brute-force | Multi-mode (local/global/hybrid/mix) |
| **Graphe de connaissances** | Non | Oui (entites + relations) |
| **Reranking** | Non | Oui (bge-reranker) |
| **Scalabilite** | ~100 chunks max raisonnable | Datasets large-scale |
| **Cache** | Non | Cache LLM integre |
| **Web UI** | Non | Oui (lightrag-server) |
| **API REST** | Non (code embarque) | Oui (compatible Ollama) |
| **Maintenance** | Custom, fragile | Communaute active (22k+ stars) |

### Points forts de LocalRAG a conserver

- Simplicite d'integration (meme process Node.js)
- Latence minimale (pas de round-trip reseau supplementaire)
- Zero dependance externe

### Points faibles de LocalRAG justifiant la migration

- Pas de persistance : re-indexation a chaque restart
- Pas de graphe de connaissances : les relations entre concepts du manifeste sont perdues
- Chunking naif : decoupe par paragraphes sans respect des limites semantiques
- Pas de reranking : les resultats sont parfois peu pertinents
- Pas d'UI d'administration pour visualiser les documents indexes

---

## 3. Plan d'integration en 3 phases

### Phase 1 : Installation et configuration standalone

**Objectif** : LightRAG tourne sur kxkm-ai, accessible via API REST, valide avec les documents existants.

**Taches** :

1. Deployer LightRAG via Docker Compose sur kxkm-ai
   - Image officielle `ghcr.io/hkuds/lightrag`
   - Configurer `.env` pour utiliser Ollama local (localhost:11434)
   - Modele LLM : `qwen3:8b` (deja sur le serveur, 8B params suffisants pour extraction d'entites)
   - Modele embedding : `nomic-embed-text` (coherence avec le systeme actuel)
   - Stockage : PostgreSQL (meme instance que le projet, database separee `lightrag`)
2. Verifier le fonctionnement :
   - Inserer un document test via API REST
   - Tester les 4 modes de requete (local, global, hybrid, mix)
   - Valider la Web UI
3. Benchmarker les performances :
   - Temps d'indexation du manifeste (~10 KB)
   - Latence de requete par mode
   - Utilisation GPU (extraction d'entites via qwen3:8b)

**Criteres de succes** :
- LightRAG repond aux requetes en < 5s
- Le graphe de connaissances contient des entites pertinentes du manifeste
- Pas d'impact sur les performances d'Ollama pour les autres usages

**Effort estime** : 0.5 jour

### Phase 2 : Migration des documents manifeste vers LightRAG

**Objectif** : Tous les documents de reference du projet sont indexes dans LightRAG avec un graphe de connaissances complet.

**Taches** :

1. Indexer les documents existants :
   - `data/manifeste.md`
   - `data/manifeste_references_nouvelles.md`
   - Descriptions des personas (system prompts)
2. Enrichir le corpus :
   - Ajouter les documents de reference artistique
   - Ajouter les fiches personas detaillees
3. Valider la qualite du graphe :
   - Visualiser le KG via la Web UI
   - Verifier les entites extraites (artistes, concepts, references)
   - Ajuster les parametres d'extraction si necessaire (`entity_types`, `language`)
4. Configurer les parametres de requete optimaux :
   - Tester `addon_params.language: "French"` pour l'extraction
   - Ajuster `chunk_token_size` si necessaire
   - Tester le reranker si disponible

**Criteres de succes** :
- Les requetes en francais retournent des resultats pertinents
- Le graphe contient les entites cles : artistes, oeuvres, concepts esthetiques
- Les relations entre concepts sont coherentes

**Effort estime** : 1 jour

### Phase 3 : Remplacement de LocalRAG par un adapter LightRAG

**Objectif** : Le code de l'API Node.js utilise LightRAG via son API REST au lieu de LocalRAG.

**Taches** :

1. Creer un adapter `LightRAGClient` dans `apps/api/src/` :
   ```typescript
   // apps/api/src/lightrag-client.ts
   export class LightRAGClient {
     constructor(private baseUrl: string) {}

     async search(query: string, mode: "hybrid" | "mix" = "mix", topK = 3): Promise<SearchResult[]>
     async insert(text: string, source: string): Promise<void>
     get ready(): boolean
   }
   ```
2. L'adapter doit implementer la meme interface que `LocalRAG` (methodes `search`, `addDocument`, `size`)
3. Modifier `server.ts` pour instancier `LightRAGClient` au lieu de `LocalRAG`
4. Mettre a jour `ChatOptions` dans `chat-types.ts` pour accepter le nouveau type
5. Conserver `LocalRAG` comme fallback si LightRAG est indisponible
6. Ajouter un health check LightRAG dans le monitoring

**Points d'integration** :
- `apps/api/src/server.ts` : ligne 44 (`new LocalRAG(...)` -> `new LightRAGClient(...)`)
- `apps/api/src/ws-conversation-router.ts` : ligne 95-97 (appel `rag.search`)
- `apps/api/src/ws-ollama.ts` : ligne 145-146 (appel `rag.search`)
- `apps/api/src/chat-types.ts` : ligne 34 (type `rag?: LocalRAG`)

**Criteres de succes** :
- Les personas utilisent LightRAG pour le contexte sans changement d'UX
- Fallback vers LocalRAG si LightRAG est down
- Temps de reponse total < 8s (incluant RAG + LLM generation)

**Effort estime** : 1 jour

---

## 4. Configuration recommandee pour Ollama

### Modeles requis

| Usage | Modele | Taille | Deja installe? |
|---|---|---|---|
| **LLM (extraction KG)** | `qwen3:8b` | ~5 GB | A verifier |
| **Embedding** | `nomic-embed-text` | ~274 MB | Oui (utilise par LocalRAG) |
| **Reranker** (optionnel) | `bge-reranker-v2-m3` (via API) | ~1 GB | Non |

### Recommandations modeles

- **qwen3:8b** est recommande par LightRAG pour l'extraction d'entites/relations avec des LLM open-source.
  Le contexte de 32K tokens est suffisant. La RTX 4090 (24 GB VRAM) peut le charger confortablement.
- **nomic-embed-text** : conserver le meme modele d'embedding garantit la coherence
  avec les embeddings existants et evite une re-indexation.
- **Reranker** : Le reranker ameliore significativement le mode `mix`. A evaluer en Phase 2.

### Configuration Ollama

Pas de changement de config Ollama necessaire. LightRAG utilise les endpoints standard :
- `POST /api/chat` (LLM generation)
- `POST /api/embed` (embeddings)

### Storage

```
data/lightrag/              # Working directory LightRAG
  ├── graph_chunk_entity_relation.graphml  # Export graphe (si NetworkX)
  └── kv_store_llm_response_cache.json     # Cache LLM
```

Pour PostgreSQL (recommande en production) :
- Database : `lightrag` (separee de la DB principale du projet)
- Extensions requises : `pgvector`, `age` (pour le graph storage)
- Tables creees automatiquement par LightRAG

---

## 5. Risques et mitigations

| # | Risque | Impact | Probabilite | Mitigation |
|---|---|---|---|---|
| R1 | **Qualite extraction FR** : LightRAG est optimise pour l'anglais, l'extraction d'entites en francais peut etre moins precise | Moyen | Moyenne | Configurer `addon_params.language: "French"`, tester avec qwen3:8b qui a un bon support multilingue |
| R2 | **Latence** : L'extraction d'entites via LLM ajoute de la latence a l'indexation | Faible | Haute | L'indexation est asynchrone (au demarrage), pas d'impact sur les requetes. Requetes < 5s en mode hybrid |
| R3 | **Ressources GPU** : qwen3:8b pour l'extraction + modele persona en parallele | Moyen | Moyenne | Ollama gere le swapping de modeles. Indexation en batch hors peak. La 4090 a 24 GB VRAM |
| R4 | **Complexite operationnelle** : Ajout d'un service Python (LightRAG server) a maintenir | Moyen | Faible | Docker Compose, health checks, monitoring existant. Service stateless |
| R5 | **Lock-in embedding** : Changer de modele d'embedding necessite une re-indexation complete | Faible | Faible | Conserver nomic-embed-text, documenter la procedure de migration |
| R6 | **Indisponibilite LightRAG** : Si le service tombe, les personas n'ont plus de contexte RAG | Moyen | Faible | Fallback vers LocalRAG in-memory. Health check avec alerte |
| R7 | **Taille du graphe** : Avec peu de documents (~20 KB de manifeste), le graphe peut etre trop sparse | Faible | Moyenne | Enrichir le corpus en Phase 2. Le mode `naive` reste disponible comme fallback |

---

## 6. Estimation d'effort total

| Phase | Effort | Prerequis |
|---|---|---|
| Phase 1 : Standalone | 0.5 jour | Acces SSH kxkm-ai, Docker |
| Phase 2 : Migration docs | 1 jour | Phase 1 validee |
| Phase 3 : Adapter API | 1 jour | Phase 2 validee |
| **Total** | **2.5 jours** | |

### Dependances externes

- Docker et Docker Compose sur kxkm-ai (deja present)
- PostgreSQL avec extensions pgvector et age (a installer/activer)
- Ollama avec qwen3:8b (a pull si absent)

### Definition of Done

- [ ] LightRAG server tourne sur kxkm-ai (Docker)
- [ ] Documents manifeste indexes avec graphe de connaissances
- [ ] Requetes en francais retournent des resultats pertinents (modes hybrid et mix)
- [ ] Adapter LightRAGClient integre dans apps/api
- [ ] Fallback LocalRAG fonctionnel
- [ ] Health check et monitoring en place
- [ ] Documentation operationnelle a jour

---

## 7. References

- LightRAG GitHub : https://github.com/HKUDS/LightRAG
- Paper : https://arxiv.org/abs/2410.05779
- PyPI : https://pypi.org/project/lightrag-hku/
- Docker : https://github.com/HKUDS/LightRAG/pkgs/container/lightrag
- Code actuel LocalRAG : `apps/api/src/rag.ts`
- Points d'integration : `apps/api/src/server.ts`, `ws-conversation-router.ts`, `ws-ollama.ts`
