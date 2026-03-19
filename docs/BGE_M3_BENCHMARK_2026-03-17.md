# BGE-M3 Benchmark - 2026-03-17

## Etat local confirme

- Le RAG courant utilise encore des embeddings locaux via Ollama dans `apps/api/src/rag.ts`, avec `nomic-embed-text` par defaut.
- Le repo contient deja un bench local `scripts/bench-embeddings.js`.
- Le health check `scripts/health-embeddings.sh` sonde Ollama et detecte la presence ou non de `bge-m3`.

## Etat machine observe

- `npm run -s smoke:embeddings` passe.
- `ollama pull bge-m3` a ete execute avec succes; `bge-m3:latest` est maintenant present localement.
- `bash scripts/health-embeddings.sh --strict` passe et confirme la presence de `bge-m3`.
- Le benchmark local resout maintenant correctement les noms de modeles tagges `:latest` et remonte les erreurs Ollama par modele.
- Sur cette machine Apple/Metal, `bge-m3:latest` echoue au chargement avec une erreur `ggml_metal_init` / `MTLLibraryErrorDomain`.
- Sur cette meme machine, `nomic-embed-text:latest` et `qwen3-embedding:0.6b` retournent aussi des `500` Ollama de chargement de modele, donc le benchmark numerique ne peut pas etre compare localement ici.

## Commandes utiles

- `npm run -s smoke:embeddings`
- `bash scripts/health-embeddings.sh --strict`
- `node scripts/bench-embeddings.js --models bge-m3 --json-only`
- `node scripts/bench-embeddings.js --models qwen3-embedding:0.6b,bge-m3 --json-only`

## Decision actuelle

1. Invalider `bge-m3` comme upgrade local sur cette machine macOS/Metal tant que le runner Ollama termine sur `ggml_metal_init`.
2. Conserver la baseline applicative actuelle et ne pas changer `apps/api/src/rag.ts` sur la base de ce host.
3. Si on veut requalifier `bge-m3`, le refaire sur une cible Linux/CPU ou Linux/CUDA, pas sur ce host Apple/Metal.

## Sources officielles

- BGE-M3 model card: https://huggingface.co/BAAI/bge-m3
- FlagEmbedding repository: https://github.com/FlagOpen/FlagEmbedding
- Ollama embedding models overview: https://ollama.com/blog/embedding-models
