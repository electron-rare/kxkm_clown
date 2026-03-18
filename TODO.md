# TODO (kxkm-clown-v2)

Updated: 2026-03-18T21:30:00Z

## Lots termines

- [x] lot-0 cadrage
- [x] lot-1 socle
- [x] lot-2 domaines
- [x] lot-3 surfaces
- [x] lot-4 bascule
- [x] lot-12 deep-audit
- [x] lot-13 voice-mcp
- [x] lot-14 documents-search
- [x] lot-16 minitel-ui
- [x] lot-17 chat-fixes
- [x] lot-18 media-tts
- [x] lot-19 infra
- [x] lot-20 deep-audit-2

## lot-21-chatterbox-tts (P1)

- [ ] Installer Chatterbox sur kxkm-ai | owner: Multimodal
- [ ] Adapter tts-server.py backend Chatterbox | owner: Multimodal
- [ ] Tester qualite vocale 33 personas | owner: Multimodal
- [ ] Benchmark latence <500ms/100chars | owner: Multimodal

## lot-22-graph-rag (P2)

- [ ] Evaluer LightRAG vs txtai vs RAGatouille | owner: Backend API
- [ ] Integrer dans rag.ts | owner: Backend API
- [ ] Indexer manifeste + lore personas | owner: Backend API
- [ ] Benchmark recall vs baseline cosine | owner: Backend API

## lot-23-crt-webgl (P3)

- [ ] Evaluer vault66-crt-effect vs shaders custom | owner: Frontend
- [ ] Integrer dans MinitelFrame | owner: Frontend
- [ ] Tester perf mobile FPS 30+ | owner: Frontend

## lot-24-tests-integration (P2)

- [ ] Mock HTTP Ollama (streaming + tools) | owner: Backend API
- [ ] Mock ComfyUI workflow + polling | owner: Backend API
- [ ] Mock SearXNG + DuckDuckGo fallback | owner: Backend API
- [ ] Mock TTS sidecar HTTP | owner: Backend API
- [ ] Test context-store concurrent writes | owner: Backend API
- [ ] Test media-store path traversal | owner: Backend API

## Bugs restants (P3)

- [ ] Bug #7: token comparison timing-attack (crypto.timingSafeEqual) | owner: Backend API
- [ ] Merzbow 0 chars (think tokens consomment tout num_predict) | owner: Backend API
- [ ] Docker build torch timeout (layer trop lourd) | owner: Ops
