# OPS V2 Status

Updated: 2026-03-19T17:30:00Z

## Lots

| Lot | Status | Summary |
|-----|--------|---------|
| lot-0-cadrage | done | Cadrage historique |
| lot-1-socle | done | Monorepo, TUI, verifications |
| lot-2-domaines | done | Auth, chat, storage, personas, node engine |
| lot-3-surfaces | done | React/Vite, admin, chat UI, node engine UI |
| lot-4-bascule | done | Migration, parite, rollback |
| lot-12-deep-audit | done | Pipeline/docs coherents, seams fermes |
| lot-13-voice-mcp | done | XTTS valide, MCP SDK officiel |
| lot-14-documents-search | done | SearXNG + BGE-M3 spike |
| lot-15-hotspot-reduction | done | Chat.tsx 631→67 LOC, cookie secure, rate limit |
| lot-16-minitel-ui | done | CSS phosphore, VIDEOTEX, F1-F7 |
| lot-17-chat-fixes | done | nick WS, Pharmacius concis, qwen3:8b |
| lot-18-media-tts | done | media-store, VoiceChat, 26 voices |
| lot-19-infra | done | Dockerfile Bookworm, deploy.sh tmux |
| lot-20-deep-audit-2 | done | 7 bugs, 6 fixes, Mermaid, OSS veille |
| lot-21-chat-reactivity | done | Streaming chunks, web search, timestamps |
| lot-22-chatterbox-tts | done | Chatterbox Docker GPU :9200 |
| lot-23-graph-rag | done | LightRAG :9621 integre |
| lot-24-deep-audit-3 | running | Admin fixes, compose timing, tests, ARCHITECTURE.md |

## Services (kxkm-ai)

| Service | Port | Status |
|---------|------|--------|
| API V2 | :3333 | healthy |
| PostgreSQL | :5432 | healthy |
| SearXNG | :8080 | healthy (JSON enabled) |
| Chatterbox TTS | :9200 | GPU Docker |
| TTS Sidecar | :9100 | chatterbox-remote |
| LightRAG | :9621 | healthy |
| Ollama | :11434 | natif (25 models) |
| Worker | host | UP |

## Tests: 265 (248 pass, 6 fail → fix en cours)

## Health Check: 19/19 pass, 1 warning (Chatterbox :9200 direct)
