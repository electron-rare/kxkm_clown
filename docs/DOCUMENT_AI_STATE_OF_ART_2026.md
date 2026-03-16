# État de l'art — Import & Analyse de Fichiers (Mars 2026)

Recherche sur les meilleures solutions open source locales pour l'extraction
et l'analyse de documents dans KXKM_Clown.

---

## 1. Modèles OCR / Vision-Document

### Top picks (petits, locaux)

| Modèle | Taille | Description | Pertinence KXKM |
| --- | --- | --- | --- |
| **GLM-OCR** | 0.9B | OCR multimodal (CogViT 0.4B + GLM 0.5B), 94.6 OmniDocBench, tables, formules, KIE | **TOP PICK** — ultra-léger, tourne sur CPU |
| **OCRFlux-3B** | 3B | Fine-tune Qwen2.5-VL-3B, PDF→Markdown clean, tourne sur GTX 3090 | Excellent rapport taille/qualité |
| **Qwen3.5:9b** | 5.5B | Vision native, bon en documents (déjà installé) | Déjà en place, polyvalent |
| **olmOCR** | variable | Allen AI, PDF→texte haute fidélité, tables, équations, manuscrit | Très précis, open source |

### Grands modèles (référence, si VRAM suffisante)

| Modèle | Taille | Description |
| --- | --- | --- |
| **GLM-4.5V** | 106B (12B actifs, MoE) | SOTA 41 benchmarks multimodaux |
| **Qwen2.5-VL-72B** | 72B | 131K context, extraction structurée, factures |
| **DeepSeek-VL2** | variable | Layout, tables, graphiques, ~100 langues |

---

## 2. Pipelines d'extraction de documents

### Comparatif des outils

| Outil | Type | Tables | Vitesse | Local | Recommandation |
| --- | --- | --- | --- | --- | --- |
| **Docling** (IBM) | Pipeline Python | 97.9% tables simples | 28s/doc | ✅ | **TOP PICK local** — DataFrames natifs |
| **MinerU** | Pipeline hybride VLM+OCR | Bon | Moyen | ✅ | 109 langues, multi-format |
| **Marker** | Pipeline Surya | Bon layout | 6min/doc | ✅ | Meilleur quand Docling échoue |
| **Unstructured.io** | Pipeline complet | 0.844 score | Rapide | ✅ | Meilleur score tables complexes |
| **LlamaParse** | Cloud API | Meilleure précision | 17s/doc | ❌ | Cloud requis |
| **PaddleOCR** | OCR toolkit | PP-StructureV3 | Rapide | ✅ | Multilingue, formules, manuscrit |
| **Reducto** | Cloud API | Excellent | Rapide | ❌ | API payante |

### Pipeline recommandé pour KXKM

```
Fichier uploadé
    │
    ├── PDF → Docling (tables, layout, DataFrames)
    │         fallback: MinerU ou Marker
    │
    ├── Image → Qwen3.5:9b (vision native, déjà en place)
    │           ou GLM-OCR pour extraction texte pure
    │
    ├── Word/Excel/PPT → python-docx/openpyxl/python-pptx (déjà en place)
    │
    ├── Audio → faster-whisper (déjà en place)
    │
    └── Texte/code → UTF-8 direct (déjà en place)
```

---

## 3. Améliorations recommandées

### Court terme (immédiat)

1. **Installer Docling** (`pip install docling`) pour remplacer pdf-parse
   - Extraction tables structurées en DataFrames
   - Layout analysis supérieur
   - Support OCR pour PDFs scannés

2. **Pull GLM-OCR** sur Ollama (`ollama pull glm-ocr` si dispo, sinon HF)
   - 0.9B = ultra-rapide
   - OCR + KIE (Key Information Extraction)

### Moyen terme

3. **Intégrer MinerU** pour les documents complexes multi-pages
   - Pipeline hybride VLM + OCR traditionnel
   - 109 langues

4. **Utiliser Qwen3.5:9b** directement pour l'analyse de documents visuels
   - Déjà installé, vision native
   - Peut décrire des layouts, charts, diagrammes

### Long terme

5. **PaddleOCR** pour les cas edge (manuscrit, formules mathématiques)
6. **Pipeline RAG documentaire** : indexer les documents uploadés dans le RAG
   pour que les personas puissent s'y référer dans les conversations futures

---

## 4. Comparaison avec l'état actuel KXKM

| Fonctionnalité | Actuel | Recommandé |
| --- | --- | --- |
| PDF texte | pdf-parse (basique) | **Docling** (tables, layout, OCR) |
| PDF scanné | Non supporté | Docling + OCR ou GLM-OCR |
| Images → texte | minicpm-v / qwen3-vl | **qwen3.5:9b** (déjà fait) |
| Tables Excel | openpyxl (OK) | OK, garder |
| Word | python-docx (OK) | OK, garder |
| Audio | faster-whisper (OK) | OK, garder |
| Indexation RAG | Non (fichiers jetés après analyse) | **Indexer dans le RAG** |

---

Sources:
- [MinerU - PDF→LLM-ready markdown](https://github.com/opendatalab/MinerU)
- [olmOCR - Allen AI](https://olmocr.allenai.org/)
- [GLM-OCR 0.9B](https://www.marktechpost.com/2026/03/15/zhipu-ai-introduces-glm-ocr-a-0-9b-multimodal-ocr-model-for-document-parsing-and-key-information-extraction-kie/)
- [Best Multimodal Models for Documents 2026](https://www.siliconflow.com/articles/en/best-multimodal-models-for-document-analysis)
- [Docling vs LlamaParse vs Unstructured](https://llms.reducto.ai/document-parser-comparison)
- [PDF Table Extraction Benchmark](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/)
- [Best Open Source OCR Tools 2026](https://unstract.com/blog/best-opensource-ocr-tools/)
- [LLMs for OCR and PDF Parsing](https://www.cradl.ai/posts/llm-ocr)
