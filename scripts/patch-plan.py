#!/usr/bin/env python3
"""Prepend summary header to PLAN.md and write STATUS.md."""

# --- PLAN.md ---
plan_path = "/home/kxkm/KXKM_Clown/PLAN.md"
with open(plan_path, "r") as f:
    old = f.read()

header = """# PLAN.md — KXKM_Clown

Updated: 2026-03-20T09:00:00Z

## Summary

- **104 lots executed** (24-127) in session 2026-03-19/20
- **425 tests**, 0 fail
- **34 commands**, 12 services, 9 spec docs
- **All SEC-01-05 resolved**
- Ollama v0.18.2, qwen3.5:9b (256K ctx, adaptive thinking)
- Next: lots 128+ (E2E Playwright, DPO automation, mobile responsive)

---

"""

# Remove old header if it starts with "# PLAN"
if old.startswith("# PLAN"):
    old = old[old.index("\n") + 1:]
    # skip "Updated:" line if present
    if old.lstrip().startswith("Updated:"):
        old = old[old.index("\n") + 1:]

with open(plan_path, "w") as f:
    f.write(header + old.lstrip())
print("OK: PLAN.md updated")

# --- STATUS.md ---
status_path = "/home/kxkm/KXKM_Clown/ops/v2/STATUS.md"
status = """# OPS V2 Status
Updated: 2026-03-20T09:00:00Z

## Session 2026-03-19/20: 104 lots (24-127)

Tests: 425/425 pass
Commands: 34
Services: 12 (8/8 health OK)
Commits: ~24 pushed
Agents: ~105 executed

## Services
| Service | Port | Status |
|---------|------|--------|
| API | :3333 | healthy |
| PostgreSQL | :5432 | healthy |
| SearXNG | :8080 | healthy |
| TTS | :9100 | active |
| LightRAG | :9621 | active |
| Reranker | :9500 | active |
| Docling | :9400 | healthy |
| ComfyUI | :8189 | active |
| Ollama | :11434 | v0.18.2 |
| Worker | host | UP |
| Discord | host | UP |
"""

with open(status_path, "w") as f:
    f.write(status)
print("OK: STATUS.md updated")
