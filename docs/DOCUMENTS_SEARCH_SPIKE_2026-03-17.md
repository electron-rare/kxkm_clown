# Documents / Search Spike - 2026-03-17

## Etat local confirme

- `apps/api/src/web-search.ts` tente deja `SearXNG` en premier, puis `WEB_SEARCH_API_BASE`, puis DuckDuckGo.
- `docker-compose.yml` expose deja un service `searxng` sous le profil `v2`.
- `ops/v2/searxng/settings.yml` versionne maintenant la config locale pour autoriser `format=json`.
- `apps/api/src/ws-upload-handler.ts` envoie deja les PDFs vers `scripts/extract_pdf_docling.py`.
- `scripts/extract_pdf_docling.py` sait utiliser `Docling`, puis `PyMuPDF` en fallback.
- `scripts/extract_document.py` couvre deja les formats bureautiques hors PDF.
- `MinerU` n'est pas encore branche runtime; il reste un spike adjacent.

## Gaps reels

- Pas de check ops unifie pour distinguer `seam pret` et `service/dependance effectivement provisionne`.
- Pas de branchement runtime MinerU dans le pipeline upload.
- Pas de verification CI/ops legere pour la presence des deps `docling`, `fitz` ou `magic_pdf`.

## Recommandation minimale

1. Garder `SearXNG` comme backend prioritaire, avec fallback visible et explicite.
2. Traiter `Docling` comme premier parseur PDF local, puis `PyMuPDF` en repli.
3. Garder `MinerU` au stade spike jusqu'a preuve de valeur sur des PDFs complexes.
4. Utiliser un health check ops non destructif avant toute activation stricte en runtime.

## Commandes utiles

- `npm run smoke:documents-search`
- `bash scripts/health-doc-search.sh all --verbose`
- `bash scripts/health-doc-search.sh search --strict`
- `bash scripts/health-doc-search.sh docs`
- `docker compose --profile v2 config --services`

## Etat machine observe

- `docker compose --profile v2 config --services` expose bien `searxng`, `api` et `worker`.
- Sur cette machine, `SearXNG` tourne sur `http://localhost:8080` et `bash scripts/health-doc-search.sh search --strict` est vert.
- Les modules Python `docling`, `fitz` et `magic_pdf` ne sont pas provisionnes actuellement.

## Sources officielles

- SearXNG docs: https://docs.searxng.org/
- SearXNG GitHub: https://github.com/searxng/searxng
- Docling docs: https://docling-project.github.io/docling/
- MinerU repo: https://github.com/opendatalab/MinerU
