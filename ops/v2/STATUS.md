# OPS V2 Status
Updated: 2026-03-20T13:30:00Z

## Session 2026-03-19/20: 120 lots (24-143)

Tests: 425/425 pass
Commands: 40
Services: 12 (8/8 health OK + ComfyUI)
Commits: ~28 pushed
Agents: ~120 executed
Specs: 9 module docs (5220+ lines)

## Services
| Service | Port | Status |
|---------|------|--------|
| API | :3333 | healthy |
| PostgreSQL | :5432 | healthy |
| SearXNG | :8080 | healthy |
| TTS Sidecar | :9100 | active |
| LightRAG | :9621 | active |
| Reranker | :9500 | active |
| Docling | :9400 | healthy |
| ComfyUI | :8189 | active |
| Ollama | :11434 | v0.18.2 |
| Worker | host | UP |
| Discord | host | UP |

## Models
- qwen3.5:9b (28 personas, 100% GPU, adaptive thinking)
- mistral:7b (5 personas, 100% GPU)
- nomic-embed-text (embeddings, 100% GPU)
- qwen3:4b (fallback model)

## Next: lots 144-149
- E2E Playwright, DPO automation, multi-channel persist
- Mobile responsive, guest mode, file sharing

## Final State 2026-03-20
Lots: 171 done | Tests: 425+ | Commands: 45 | Services: 13 (8/8 green)
TTFC: 284ms | RSS: 110MB | VRAM: 14.2GB/24GB
NLP auto-detect verified | ComfyUI smart models (32ckpt, 24 LoRA)
