#!/usr/bin/env python3
"""Patch ws-commands.ts to add /changelog and /version commands."""

filepath = "/home/kxkm/KXKM_Clown/apps/api/src/ws-commands.ts"
with open(filepath, "r") as f:
    content = f.read()

# 1. Insert new commands before case "/flip"
changelog_version = '''
      case "/changelog": {
        try {
          const { execFileSync } = await import("node:child_process");
          const log = execFileSync("git", ["log", "--oneline", "-10"], { cwd: process.cwd(), timeout: 5000 }).toString().trim();
          send(ws, { type: "system", text: `Changelog:\\n${log}` });
        } catch {
          send(ws, { type: "system", text: "Changelog indisponible" });
        }
        return;
      }

      case "/version": {
        const pkg = { version: "2.0.0", name: "@kxkm/api" };
        send(ws, { type: "system", text: `KXKM_Clown ${pkg.version}\\n  Ollama: v0.18.2\\n  Node: ${process.version}\\n  Commandes: 34\\n  Personas: ${getPersonas().length}\\n  Uptime: ${Math.floor(process.uptime()/3600)}h${Math.floor((process.uptime()%3600)/60)}m` });
        return;
      }

'''

content = content.replace('      case "/flip": {', changelog_version + '      case "/flip": {')

with open(filepath, "w") as f:
    f.write(content)
print("OK: ws-commands.ts patched with /changelog and /version")
