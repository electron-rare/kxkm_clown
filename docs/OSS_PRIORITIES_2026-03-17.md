# OSS Priorities - 2026-03-17

## Decision

Priorite d'integration pour le cycle actuel:

1. `SearXNG` comme backend de recherche self-hosted.
2. `Docling` et `MinerU` comme spike document parsing adjacent.
3. `MCP TypeScript SDK` comme standard d'outillage/personas.
4. `LiveKit Agents JS` comme candidat principal pour le lot voice/WebRTC.

Projets gardes comme benchmarks produit, pas comme dependances embarquees:

- `Open WebUI`
- `LibreChat`
- `AnythingLLM`

## Shortlist

| Projet | Role retenu | Pourquoi maintenant | Source |
| --- | --- | --- | --- |
| SearXNG | integration directe | moteur self-hosted, API JSON, alignement avec la recherche web locale | https://github.com/searxng/searxng , https://docs.searxng.org/ |
| Docling | spike prioritaire | conversion multi-format, OCR, sorties Markdown/JSON, execution locale | https://docling-project.github.io/docling/ |
| MinerU | spike prioritaire | PDF complexes, OCR CPU/GPU, oriente extraction LLM | https://github.com/opendatalab/MinerU |
| MCP TypeScript SDK | integration directe | standardiser tools/resources/prompts cote personas et services | https://github.com/modelcontextprotocol/typescript-sdk |
| LiveKit Agents JS | lot suivant | voice/WebRTC temps reel en Node, bon fit pour la suite voice-mcp | https://github.com/livekit/agents-js |

## Benchmarks produit

| Projet | Usage retenu | Source |
| --- | --- | --- |
| Open WebUI | benchmark UX local/Ollama/RAG | https://github.com/open-webui/open-webui |
| LibreChat | benchmark multi-provider, auth, MCP, memory | https://www.librechat.ai/ , https://github.com/LibreChat-AI |
| AnythingLLM | benchmark workspaces/RAG/agents | https://github.com/Mintplex-Labs/anything-llm |

## Notes d'adoption

- `SearXNG` est le seul candidat a brancher dans le cycle current sans attendre une refonte majeure.
- `Docling` et `MinerU` doivent rester adjacents tant que la boucle `audit -> test -> resume -> sync-docs -> purge` n'est pas stabilisee.
- `LiveKit Agents JS` ne doit pas entrer dans le cycle backend immediat; il reste assigne au lot voice-mcp.
- `BGE-M3` reste un spike benchmark, pas une decision de remplacement immediate.

## Seams prets

| Zone | Etat actuel | Petite action utile maintenant |
| --- | --- | --- |
| Recherche web | `apps/api/src/web-search.ts` tente `SearXNG` puis `WEB_SEARCH_API_BASE` puis DuckDuckGo, et `scripts/mcp-server.js` a deja un fallback SearXNG. | Utiliser `scripts/health-doc-search.sh search --strict` pour valider le endpoint JSON et garder le fallback visible en ops. |
| PDF/doc parsing | `apps/api/src/ws-upload-handler.ts` appelle deja `scripts/extract_pdf_docling.py` pour les PDFs et `scripts/extract_document.py` pour le reste. | Utiliser `scripts/health-doc-search.sh docs` pour verifier les deps `docling`/`PyMuPDF` et la presence du futur chemin `magic_pdf` MinerU. |
| Docs de reference | `docs/DOCUMENT_AI_STATE_OF_ART_2026.md` recommande Docling d'abord, MinerU ensuite. | Laisser le produit inchangé et documenter l'ordre d'adoption avant tout branchement runtime. |

### Commande de preparation

```bash
bash scripts/health-doc-search.sh all --verbose
```
