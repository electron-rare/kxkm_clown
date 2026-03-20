# Chat Commands Reference

> Complete reference for all 19 slash commands available in 3615-KXKM chat.
> Commands are typed in the chat input. Some commands are admin-only.

## General

| Command | Syntax | Description |
|---------|--------|-------------|
| `/help` | `/help` | Display the full list of available commands |
| `/clear` | `/clear` | Clear the chat for all clients in the channel (broadcasts `__clear__`) |
| `/nick` | `/nick <pseudo>` | Change your nickname (2-24 chars, unique, alphanumeric + accents) |
| `/who` | `/who` | List all connected users and active personas in the channel |
| `/personas` | `/personas` | Show active personas with their model and system prompt excerpt |
| `/channels` | `/channels` | List all active channels with connected user counts |
| `/join` | `/join #canal` | Join a channel (2-30 chars, starts with `#`, alphanumeric + `-_`) |

## Search & Generation

| Command | Syntax | Description |
|---------|--------|-------------|
| `/web` | `/web <query>` | Search the web via SearXNG, display top 5 results, route to personas for commentary |
| `/imagine` | `/imagine <prompt>` | Generate an image via ComfyUI SDXL (progress updates every 5s, result broadcast as `image` message) |
| `/compose` | `/compose <prompt>, <style>, <duration>s` | Compose music via ACE-Step TTS sidecar. Duration 5-120s (default 30s). Result broadcast as `music` message |

## Monitoring & Debug

| Command | Syntax | Description |
|---------|--------|-------------|
| `/status` | `/status` | System status: uptime, connected users, active personas, Ollama models, VRAM usage, HTTP perf metrics |
| `/models` | `/models` | List all installed Ollama models with size, and indicate which are currently loaded in VRAM |
| `/context` | `/context` | Stats for the channel's conversation context store: entries, chars, compaction state, global size |
| `/memory` | `/memory <persona>` | Show a persona's persistent memory: retained facts, summary, last update time |
| `/export` | `/export` | Export the current channel's conversation history as text (up to 100K chars) |
| `/responders` | `/responders <1-5>` | Set the max number of personas that respond to each message (runtime, all users) |

## Administration

| Command | Syntax | Description |
|---------|--------|-------------|
| `/model` | `/model` | Show the current active LLM model |
| `/persona` | `/persona` | Show the current active persona configuration |
| `/reload` | `/reload` | Hot-reload personas from the database (broadcasts updated list to channel) |

## Implicit Commands

| Pattern | Description |
|---------|-------------|
| `@NomPersona` | Directly mention a persona by name — bypasses random selection, triggers that specific persona to respond |
