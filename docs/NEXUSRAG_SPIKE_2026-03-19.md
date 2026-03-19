# Spike: Integration NexusRAG (lot-31) — 2026-03-19

**Date**: 2026-03-19
**Auteur**: Claude (spike automatise)
**Statut**: DRAFT
**Lot**: 31

---

## 1. Resume du projet

| Champ | Valeur |
|---|---|
| **Nom** | NexusRAG |
| **Auteur** | LeDat98 |
| **URL GitHub** | https://github.com/LeDat98/NexusRAG |
| **Stars** | ~197 (mars 2026) |
| **Forks** | ~45 |
| **Licence** | Non specifiee (pas de LICENSE dans le repo) |
| **Cree** | 2026-03-15 |
| **Derniere MAJ** | 2026-03-19 (actif, 4 jours d'age) |
| **Langage** | Python |
| **Issues ouvertes** | 6 |

NexusRAG est un systeme RAG hybride combinant recherche vectorielle, graphe de connaissances
(LightRAG), et cross-encoder reranking, avec parsing documentaire Docling, intelligence
visuelle (captioning images/tableaux), chat agentique streaming, et citations inline.
Alimente par Gemini ou des modeles locaux Ollama.

**Note importante** : ce projet a seulement 4 jours d'existence (cree le 15 mars 2026).
C'est un projet tres recent et experimental.

---

## 2. Architecture

### Pipeline de retrieval hybride a 3 voies

```
Documents (PDF, DOCX, PPTX, HTML, TXT)
    |
    v
[Docling Parser]
    |  - Preservation hierarchie titres
    |  - Enrichissement formules LaTeX
    |  - Groupement paragraphes, limites de pages
    v
[HybridChunker (max_tokens=512, merge_peers=True)]
    |  - Respecte limites semantiques ET structurelles
    |  - Ne coupe jamais mid-heading ou mid-table
    |  - Metadata page-aware (numeros de page, heading paths)
    v
    +--------------------+--------------------+
    |                    |                    |
    v                    v                    v
[Vector Search]    [KG Entity Lookup]   [Visual Intelligence]
 BAAI/bge-m3        LightRAG KG           Image/Table
 1024d embeddings   Gemini 3072d /        captioning
                    Ollama / ST
    |                    |                    |
    +--------------------+--------------------+
                    |
                    v
           [Cross-Encoder Reranking]
                    |
                    v
           [Agentic Streaming Chat]
                    |
                    v
           [Reponse avec citations inline]
```

### Composants cles

| Composant | Detail |
|---|---|
| **Parsing documents** | Docling (PDF, DOCX, PPTX, HTML, TXT) |
| **Chunking** | HybridChunker semantique + structurel, 512 tokens max |
| **Embeddings** | Dual-model : BAAI/bge-m3 (1024d) + KG embedding (Gemini 3072d / Ollama / sentence-transformers) |
| **Vector Search** | Recherche vectorielle classique (over-fetch) |
| **Knowledge Graph** | LightRAG — extraction entites/relations automatique |
| **Reranking** | Cross-encoder (ameliore significativement la precision) |
| **Visual Intelligence** | Captioning images et tableaux dans les documents |
| **Chat** | Streaming agentique avec citations inline |
| **LLM backends** | Gemini (cloud) ou Ollama (local) |

### Dual-Model Embeddings

- **Recherche vectorielle** : BAAI/bge-m3 (1024 dimensions) — modele multilingue performant
- **KG embedding** : Gemini 3072d (cloud) / Ollama embedding (local) / sentence-transformers (offline)

---

## 3. Compatibilite Ollama

NexusRAG supporte nativement Ollama pour un deploiement 100% local :

- **LLM** : tout modele Ollama (gemma2, llama3, mistral, qwen, etc.)
- **Embeddings** : via Ollama ou sentence-transformers (offline complet)
- **Mode offline** : possible sans aucun appel cloud

Cela correspond parfaitement a l'architecture kxkm_clown qui utilise deja Ollama
en natif sur kxkm-ai.

### Test communautaire Ollama

LightRAG (composant interne de NexusRAG) a ete teste avec Ollama + gemma2:2b sur un
GPU de minage avec 6 GB RAM : 197 entites et 19 relations extraites sur un livre de test.

---

## 4. Integration Docling

Docling est le parser documentaire de NexusRAG, developpe par IBM :

| Fonctionnalite | Detail |
|---|---|
| **Formats** | PDF, DOCX, PPTX, HTML, TXT |
| **Preservation structure** | Hierarchie titres, limites pages, groupement paragraphes |
| **Formules** | Notation LaTeX preservee |
| **Tables** | Extraction structurelle (optionnelle, GPU pour table_structure) |
| **GPU** | Optionnel — principalement CPU-bound, GPU pour model table seulement |
| **VRAM** | Minimal avec `convert_do_table_structure=false` |

Docling est principalement CPU-bound (parsing PDF, analyse layout). Le GPU n'accelere
que le modele de structure de tableaux, qui s'active en courtes rafales par page.

---

## 5. Benchmarks et evaluation

### Methodology de test NexusRAG

NexusRAG a ete evalue avec deux methodes complementaires :

| Methode | Detail |
|---|---|
| **16 tests manuels** | 6 categories, 8 metriques rule-based (keyword coverage, refusal accuracy, citation format, language match) |
| **30 tests RAGAS synthetiques** | LLM-as-judge, metriques standard RAGAS |

### Corpus de test

- TechVina Annual Report 2025 (vietnamien, 26 chunks)
- DeepSeek-V3.2 Technical Paper (anglais, 57 chunks)

### Resultats publies

Les benchmarks comparent principalement :
- **Cout-efficacite** : modeles locaux 4B/9B vs cloud
- **Faithfulness** : fidelite aux documents sources
- **Table extraction** : qualite d'extraction de tableaux
- **Consistance multilingue** : vietnamien + anglais

**Note** : pas de benchmark direct NexusRAG vs LightRAG seul publie.
Les 197 stars suggerent un projet encore en phase d'adoption precoce.

### Comparaison conceptuelle : NexusRAG vs LightRAG seul

| Aspect | LightRAG seul | NexusRAG |
|---|---|---|
| **Retrieval** | KG + vecteurs (mode mix) | KG + vecteurs + cross-encoder reranking |
| **Parsing** | Manuel (text brut) | Docling (structure preservee) |
| **Visual** | Non | Captioning images/tableaux |
| **Citations** | Support basique | Citations inline avec sources |
| **Streaming** | Non natif | Chat agentique streaming |
| **Complexity** | Simple, mature (EMNLP 2025) | Plus complet, mais plus jeune |

---

## 6. Capacites cles pour kxkm_clown

### 6.1. RAG documentaire pour les personnages

Les clowns de kxkm_clown pourraient avoir acces a une base documentaire contextuelle :
- Scripts, textes de spectacle
- Fiches de personnages
- Historique des interactions
- Documents techniques/artistiques

NexusRAG permettrait une recherche hybride (vecteurs + graphe de connaissances)
significativement plus precise que le RAG naif.

### 6.2. Intelligence visuelle

Le captioning d'images et de tableaux pourrait enrichir les reponses des personnages
avec du contexte visuel (affiches, photos de scene, plans).

### 6.3. Citations inline

Les reponses avec citations permettent la tracabilite et le debug des hallucinations,
utile pour le monitoring en spectacle.

---

## 7. Plan d'integration (3 phases)

### Phase 1 : Evaluation comparative (2-3 jours)

1. Installer NexusRAG localement sur kxkm-ai
2. Comparer avec LightRAG seul (deja spike le meme jour) :
   - Qualite de retrieval sur corpus FR
   - Latence de reponse
   - Utilisation VRAM avec Ollama
3. Tester Docling sur documents FR reels (scripts, fiches)
4. Evaluer la maturite du code (4 jours d'age seulement)
5. Verifier : est-ce un wrapper fin sur LightRAG ou un apport reel ?

### Phase 2 : Integration conditionnelle (3-5 jours)

*Uniquement si Phase 1 montre un avantage significatif sur LightRAG seul*

1. Integrer le pipeline NexusRAG dans l'API kxkm_clown
2. Configurer Ollama comme backend LLM + embeddings
3. Indexer le corpus documentaire du spectacle
4. Exposer via endpoint REST pour les personas
5. Tester cross-encoder reranking avec bge-reranker-v2-m3

### Phase 3 : Production (2-3 jours)

1. Docker compose avec volumes persistants pour le KG et le vector store
2. Pipeline d'ingestion automatique de nouveaux documents
3. Monitoring latence / qualite dans OPS TUI
4. Cache et optimisation pour le temps reel conversationnel

---

## 8. Risques et bloqueurs

| Risque | Severite | Mitigation |
|---|---|---|
| **Projet de 4 jours d'age** | **HAUTE** | Evaluation approfondie Phase 1 ; fallback sur LightRAG seul |
| **Licence non specifiee** | **HAUTE** | Contacter l'auteur ou attendre clarification avant usage production |
| **197 stars seulement** | Moyenne | Indicateur de maturite faible ; le code peut manquer de robustesse |
| **Pas de benchmark FR** | Moyenne | Tests FR manuels en Phase 1 |
| **Dependance sur LightRAG** | Faible | LightRAG est mature (EMNLP 2025, MIT) ; NexusRAG ajoute une couche |
| **Overlap avec LightRAG spike existant** | Moyenne | Evaluer si NexusRAG apporte assez au-dessus de LightRAG seul |
| **Docling GPU optionnel** | Faible | CPU suffit pour le parsing ; GPU pour tables seulement |
| **6 issues ouvertes, 1 contributeur** | Moyenne | Bus factor de 1, risque d'abandon |
| **Corpus de test non-FR** | Moyenne | Vietnamien + anglais testes ; francais non valide |

---

## 9. Recommandation

### ATTENDRE (evaluer en Phase 1 avant engagement)

**Justification** :

1. **Projet extremement jeune** (4 jours, cree le 15 mars 2026). Malgre 197 stars
   et une architecture prometteuse, la maturite est insuffisante pour la production.

2. **Licence non specifiee** : bloqueur pour tout usage serieux. Pas de fichier LICENSE
   dans le repository.

3. **Overlap avec LightRAG** : le spike LIGHTRAG_SPIKE_2026-03-19.md couvre deja
   LightRAG seul, qui est mature (EMNLP 2025, MIT, 21K+ stars). NexusRAG ajoute
   Docling + cross-encoder reranking + visual intelligence par-dessus LightRAG.

4. **La valeur ajoutee est reproductible** : les composants que NexusRAG ajoute
   (Docling, cross-encoder reranking, bge-m3) peuvent etre integres manuellement
   dans un pipeline LightRAG existant, avec plus de controle.

5. **Bus factor 1** : un seul contributeur, risque d'abandon.

### Alternative recommandee

Plutot que d'adopter NexusRAG en bloc, construire un pipeline equivalent :

```
[Docling] --> [HybridChunker] --> [LightRAG (mature)]
                                       |
                                  [bge-reranker-v2-m3]
                                       |
                                  [API kxkm_clown]
```

Cela donne les memes capacites avec des composants matures et licencies :
- **LightRAG** : MIT, 21K+ stars, EMNLP 2025
- **Docling** : Apache-2.0, IBM, mature
- **bge-reranker-v2-m3** : MIT, BAAI

Surveiller NexusRAG pour evaluer sa maturation dans 2-3 mois.

---

## Sources

- [LeDat98/NexusRAG (GitHub)](https://github.com/LeDat98/NexusRAG)
- [HKUDS/LightRAG (GitHub)](https://github.com/HKUDS/LightRAG)
- [Docling (IBM)](https://www.docling.ai/)
- [LightRAG: Simple and Fast RAG (EMNLP 2025)](https://openreview.net/forum?id=bbVH40jy7f)
- [BAAI/bge-m3 (Hugging Face)](https://huggingface.co/BAAI/bge-m3)
- [Hands-on LightRAG (DEV Community)](https://dev.to/aairom/hands-on-experience-with-lightrag-3hje)
