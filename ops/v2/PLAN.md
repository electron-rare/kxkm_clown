# PLAN (kxkm-clown-v2)

Updated: 2026-03-17T08:45:00Z

## lot-0-cadrage [done]

- Description: Docs, architecture, feature map, agents, invariants, orchestration
- Depends on: none

## lot-1-socle [done]

- Description: Workspace V2, packages, scripts TUI, verification
- Depends on: lot-0-cadrage

## lot-2-domaines [done]

- Description: Auth, chat, storage, personas, node engine
- Depends on: lot-1-socle

## lot-3-surfaces [done]

- Description: Shell React/Vite, admin, chat, node engine, ops
- Depends on: lot-2-domaines

## lot-4-bascule [done]

- Description: Migration, parite, rollback, bascule
- Depends on: lot-3-surfaces

## lot-5-production [done]

- Description: Training adapters, sandboxing, tests, turborepo, CI/CD, GitHub
- Depends on: lot-4-bascule

## lot-6-consolidation [done]

- Description: Deep analyse, correctifs securite, feature parity V2, deploy
- Depends on: lot-5-production

## lot-7-training [done]

- Description: PyTorch, Unsloth, TRL, DPO pipeline, autoresearch, Ollama import
- Depends on: lot-6-consolidation

## lot-8-multimodal [done]

- Description: RAG, STT, TTS, vision, PDF, recherche web, memoire persona
- Depends on: lot-7-training

## lot-9-chat-avance [done]

- Description: Chat vocal, inter-persona, multi-channel, analytics, 26 personas
- Depends on: lot-8-multimodal

## lot-10-generation [done]

- Description: ComfyUI, Sherlock, Picasso, diversification modeles, contexte 750MB
- Depends on: lot-9-chat-avance

## lot-11-mcp-personas [done]

- Description: MCP tool-calling personas, pipeline fine-tune
- Depends on: lot-10-generation

## lot-12-deep-audit [in-progress]

- Description: Deep audit code, refactoring, veille OSS, diagrammes, infrastructure
- Depends on: lot-11-mcp-personas
- Deliverables:
  - ops/v2/deep-audit.js (TUI security/perf/complexity)
  - docs/OSS_WATCH enrichi (voice, music, PDF, WebRTC, MCP, persona fine-tune)
  - docs/ARCHITECTURE.md (3 Mermaid ajoutes)
  - docs/AGENTS.md (matrice 10 agents, pipeline intervention)
  - PLAN.md + TODO.md consolides
  - Refactoring ws-chat.ts + app.ts
  - SearXNG + MinerU/Docling docker

## lot-13-voice-mcp [planned]

- Description: XTTS-v2 voice cloning, LLMRTC WebRTC, MCP SDK, Discord Pharmacius
- Depends on: lot-12-deep-audit

## lot-14-music-creative [planned]

- Description: ACE-Step 1.5, /compose, Flux 2, A2A Protocol
- Depends on: lot-13-voice-mcp
