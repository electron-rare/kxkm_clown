# PLAN (kxkm-clown-v2)

Updated: 2026-03-16T05:53:08Z

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
- Description: Migration, parité, rollback, bascule
- Depends on: lot-3-surfaces
