#!/usr/bin/env python3
"""Patch useChatState.ts to add /changelog and /version to tab-completion."""

filepath = "/home/kxkm/KXKM_Clown/apps/web/src/hooks/useChatState.ts"
with open(filepath, "r") as f:
    content = f.read()

old = '"/flip"'
new = '"/flip", "/changelog", "/version"'
content = content.replace(old, new)

with open(filepath, "w") as f:
    f.write(content)
print("OK: tab-completion patched")
