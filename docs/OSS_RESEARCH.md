# Open Source Research: Multi-LLM IRC-Style Chat Interfaces

**Date:** 2026-03-11
**Purpose:** Survey of open source projects relevant to building a multi-LLM IRC-style chat interface.

---

## Table of Contents

1. [Multi-LLM Chat Interfaces](#1-multi-llm-chat-interfaces)
2. [IRC / Retro-Style AI Chat UIs](#2-irc--retro-style-ai-chat-uis)
3. [Ollama Web UIs with Multi-Model Support](#3-ollama-web-uis-with-multi-model-support)
4. [AI Agent Orchestration Frameworks](#4-ai-agent-orchestration-frameworks)
5. [Multi-Agent Conversation / Debate Frameworks](#5-multi-agent-conversation--debate-frameworks)
6. [LLM API Unification Layers](#6-llm-api-unification-layers)
7. [Retro CRT / Terminal UI Components](#7-retro-crt--terminal-ui-components)
8. [DPO/RLHF Fine-Tuning Tools for Local Models](#8-dporlhf-fine-tuning-tools-for-local-models)
9. [Ollama Fine-Tuning Pipeline & GGUF Tools](#9-ollama-fine-tuning-pipeline--gguf-tools)
10. [WebSocket Chat Libraries for Node.js](#10-websocket-chat-libraries-for-nodejs)
11. [IRC Protocol Libraries for Node.js](#11-irc-protocol-libraries-for-nodejs)
12. [Retro / Terminal CSS Frameworks](#12-retro--terminal-css-frameworks)
13. [Multi-Agent Chat Projects (LLMs Talking to Each Other)](#13-multi-agent-chat-projects-llms-talking-to-each-other)
14. [Additional Ollama Web UIs (Lightweight)](#14-additional-ollama-web-uis-lightweight)
15. [Key Takeaways for KXKM_Clown](#15-key-takeaways-for-kxkm_clown)

---

## 1. Multi-LLM Chat Interfaces

### LibreChat

- **URL:** https://github.com/danny-avila/LibreChat
- **Stars:** ~34.5k
- **License:** MIT
- **What it does:** Enhanced ChatGPT clone that unifies multiple AI backends (OpenAI, Anthropic, Google, Groq, Mistral, Azure, OpenRouter, Vertex AI, Gemini, DeepSeek) under a familiar chat interface. Supports Agents, MCP (Model Context Protocol), AI model switching mid-conversation, message search, code interpreter, multi-user auth, presets.
- **What we can learn/reuse:**
  - Multi-provider architecture -- how they abstract different LLM APIs behind a unified interface
  - Model switching UX patterns (switch models mid-conversation)
  - Message search implementation
  - MIT license means we can freely borrow code/patterns
- **Relevance:** HIGH -- closest to our multi-model concept in a polished UI

### LobeChat

- **URL:** https://github.com/lobehub/lobe-chat
- **Stars:** ~59k
- **License:** LobeHub Community License (Apache 2.0 base with commercial restrictions on derivative works)
- **What it does:** Modern-design AI chat framework. Supports OpenAI, Claude, Gemini, Ollama, Qwen, DeepSeek. Features MCP support, smart internet search, chain-of-thought visualization, branching conversations, artifacts, file upload/knowledge base, multi-modal (vision/TTS/STT), text-to-image, custom themes, plugin system.
- **What we can learn/reuse:**
  - Plugin system architecture
  - Branching conversation UI (relevant to multi-agent conversations)
  - Chain-of-thought visualization
  - Custom theme system (we want IRC/retro themes)
- **Relevance:** MEDIUM -- very feature-rich but heavy; license restricts derivative works

### Chatbox AI

- **URL:** https://github.com/chatboxai/chatbox
- **Stars:** ~38.5k
- **License:** GPLv3
- **What it does:** Desktop AI client supporting ChatGPT, Claude, DeepSeek, Gemini, Ollama and more. Cross-platform (Windows, macOS, Linux, iOS, Android, Web).
- **What we can learn/reuse:**
  - Clean multi-model provider abstraction for desktop apps
  - Local-first architecture patterns
- **Relevance:** LOW -- desktop client, not web-based IRC style

### AnythingLLM

- **URL:** https://github.com/Mintplex-Labs/anything-llm
- **Stars:** ~51.8k
- **License:** MIT
- **What it does:** All-in-one AI productivity tool. Privacy-first, runs locally. Supports both commercial and open-source LLMs, vector DB solutions, RAG, multi-user access. Desktop and self-hosted options.
- **What we can learn/reuse:**
  - Local-first RAG implementation
  - Multi-user workspace architecture
  - Document ingestion pipeline
  - MIT license -- freely reusable
- **Relevance:** MEDIUM -- good reference for local-first architecture, but different UX paradigm

### Jan

- **URL:** https://github.com/janhq/jan
- **Stars:** ~25k+
- **License:** AGPLv3
- **What it does:** Open source ChatGPT alternative that runs 100% offline. Download and run LLMs (Llama, Gemma, Qwen) locally. Also connects to cloud APIs (OpenAI, Anthropic, Mistral, Groq). Powered by Cortex engine (llama.cpp, ONNX, TensorRT-LLM).
- **What we can learn/reuse:**
  - Offline-first model management (download, run, switch models)
  - Cortex engine integration patterns
  - Multi-engine support (llama.cpp + ONNX + TensorRT)
- **Relevance:** MEDIUM -- strong local-first reference, but AGPL license is restrictive

---

## 2. IRC / Retro-Style AI Chat UIs

### Soulshack

- **URL:** https://github.com/pkdindustries/soulshack
- **Stars:** ~small (< 100)
- **License:** Check repo (likely MIT or similar)
- **What it does:** An actual IRC chatbot supporting multiple LLM providers: OpenAI, Ollama, Gemini, Anthropic. Has MCP server support and basic shell tools. Written in Go.
- **What we can learn/reuse:**
  - **DIRECTLY RELEVANT** -- IRC protocol + multi-LLM provider support in one bot
  - Go-based IRC client patterns
  - How they handle provider switching in an IRC context
  - MCP integration in an IRC bot
- **Relevance:** VERY HIGH -- closest to our IRC+multi-LLM concept

### Ollamarama-IRC

- **URL:** https://github.com/h1ddenpr0cess20/ollamarama-irc
- **Stars:** ~9
- **License:** AGPL-3.0
- **What it does:** AI chatbot for IRC with "infinite personalities" using Ollama. Supports custom prompts, personality switching, per-user chat histories, model listing, collaborative features.
- **What we can learn/reuse:**
  - Personality/persona system for different AI characters in IRC
  - Per-user conversation history management in IRC context
  - Ollama integration patterns for IRC
- **Relevance:** HIGH -- IRC + Ollama + personality system is very relevant

### Franklin

- **URL:** https://github.com/oxagast/Franklin
- **Stars:** Small
- **License:** Check repo
- **What it does:** LLM-powered IRC chat bot that is self-aware of its IRC context (channel, user, timestamp, op status). Uses context-aware prompting.
- **What we can learn/reuse:**
  - Context-aware IRC bot design (knows channel, user, time)
  - Self-aware bot personality patterns
- **Relevance:** MEDIUM -- interesting context-awareness approach

### Retro Terminal (Iris Terminal)

- **URL:** https://iristerminal.vercel.app/
- **Stars:** N/A (web app)
- **License:** Check source
- **What it does:** Retro-styled terminal interface for modern AI chat with theme support, chat history, local API key usage.
- **What we can learn/reuse:**
  - Retro terminal CSS/design patterns
  - Theme system for retro aesthetics
- **Relevance:** MEDIUM -- UI/design reference

---

## 3. Ollama Web UIs with Multi-Model Support

### Open WebUI

- **URL:** https://github.com/open-webui/open-webui
- **Stars:** ~17.9k (note: may be higher, some sources report 100k+)
- **License:** Open WebUI License (BSD-3 base with branding restrictions as of v0.6.6)
- **What it does:** The most popular Ollama web UI. Self-hosted, offline-capable. Supports Ollama and OpenAI-compatible APIs. Features: granular permissions, Markdown/LaTeX, voice/video calls, Python function calling, RAG, web search, image generation, model builder for creating custom Ollama models.
- **What we can learn/reuse:**
  - Ollama integration patterns (model management, streaming)
  - Model builder UI for creating custom personas
  - OpenAI-compatible API abstraction layer
  - RAG integration with local models
- **Relevance:** HIGH -- best reference for Ollama integration, but license has branding restrictions

---

## 4. AI Agent Orchestration Frameworks

### OpenAI Swarm (now Agents SDK)

- **URL:** https://github.com/openai/swarm
- **Stars:** ~18k+
- **License:** MIT
- **What it does:** Experimental, educational framework for lightweight multi-agent orchestration. Focuses on ergonomic interfaces, agent handoffs, and routines. Now superseded by OpenAI Agents SDK for production use.
- **What we can learn/reuse:**
  - **Lightweight agent handoff patterns** -- exactly what we need for multi-agent IRC chat
  - Simple abstractions: Agent + Handoff + Routine
  - Educational codebase, easy to understand
  - MIT license
- **Relevance:** HIGH -- lightweight, simple abstractions we can adapt

### Agent Squad (AWS, formerly Multi-Agent Orchestrator)

- **URL:** https://github.com/awslabs/agent-squad
- **Stars:** ~7.2k
- **License:** Apache 2.0
- **What it does:** Flexible framework for managing multiple AI agents in complex conversations. Intelligent intent-based routing, context management across agents, streaming support. Available in Python and TypeScript.
- **What we can learn/reuse:**
  - Intent classification to route messages to the right agent/model
  - Context management across multiple agents
  - Streaming response patterns
  - TypeScript implementation reference
- **Relevance:** HIGH -- agent routing and context management are directly useful

### CrewAI

- **URL:** https://github.com/crewAIInc/crewAI
- **Stars:** ~25k+
- **License:** MIT
- **What it does:** Role-based AI agent teams. Each agent has a distinct role/skillset, and they cooperate (or debate) to solve problems. Lightweight Python framework, independent of LangChain.
- **What we can learn/reuse:**
  - Role-based agent design (each "clown" could have a role)
  - Agent cooperation/debate patterns
  - Task delegation between agents
- **Relevance:** MEDIUM -- good patterns but heavier than we need

---

## 5. Multi-Agent Conversation / Debate Frameworks

### AutoGen (Microsoft)

- **URL:** https://github.com/microsoft/autogen
- **Stars:** ~40k+
- **License:** MIT (Creative Commons for docs)
- **What it does:** Framework for building multi-agent conversations. Supports group chat orchestration, multi-agent debate pattern, human-in-the-loop, customizable agents. The debate pattern has agents exchange responses and refine based on each other's input.
- **What we can learn/reuse:**
  - **Multi-agent debate pattern** -- agents take turns, exchange responses, refine
  - Group chat orchestration with coordinator/turn management
  - Human-in-the-loop patterns
  - Conversation flow management
- **Relevance:** HIGH -- debate/conversation patterns directly applicable to IRC multi-agent chat

### Multi-Agents-Debate (MAD)

- **URL:** https://github.com/Skytliang/Multi-Agents-Debate
- **Stars:** ~477
- **License:** GPLv3
- **What it does:** The first academic work exploring multi-agent debate with LLMs. Agents play roles (proponent, opponent, moderator), contributing arguments, counterarguments, and summaries. Handles turn-taking, argument logging, final verdict synthesis.
- **What we can learn/reuse:**
  - Role-based debate structure (proponent/opponent/moderator)
  - Turn-taking and argument logging
  - Verdict/consensus synthesis
  - Academic paper with theoretical framework
- **Relevance:** HIGH -- debate structure maps well to IRC channel conversations

---

## 6. LLM API Unification Layers

### LiteLLM

- **URL:** https://github.com/BerriAI/litellm
- **Stars:** ~35k+
- **License:** MIT
- **What it does:** Python SDK + Proxy Server (AI Gateway) to call 100+ LLM APIs in OpenAI-compatible format. Cost tracking, guardrails, load balancing, logging. Supports Bedrock, Azure, OpenAI, VertexAI, Cohere, Anthropic, Sagemaker, HuggingFace, vLLM, NVIDIA NIM.
- **What we can learn/reuse:**
  - **USE THIS AS OUR API LAYER** -- unified interface to all LLM providers
  - OpenAI-compatible format means any UI that speaks OpenAI can use any model
  - Cost tracking per model/user
  - Load balancing across providers
  - Proxy server we can self-host
  - MIT license
- **Relevance:** CRITICAL -- this should be our backend API gateway

### AIChat (CLI)

- **URL:** https://github.com/sigoden/aichat
- **Stars:** ~9.5k
- **License:** MIT / Apache 2.0 (dual)
- **What it does:** All-in-one LLM CLI tool. Shell assistant, Chat-REPL, RAG, AI tools & agents. Supports 20+ providers (OpenAI, Claude, Gemini, Ollama, Groq, etc.). Tab completion, multi-line input, history search, custom REPL prompts.
- **What we can learn/reuse:**
  - CLI chat UX patterns (REPL, slash commands, tab completion)
  - Multi-provider configuration patterns
  - Rust codebase -- performant reference
- **Relevance:** MEDIUM -- good CLI UX reference, but we're building a web UI

---

## 7. Retro CRT / Terminal UI Components

### cool-retro-term-webgl

- **URL:** https://github.com/remojansen/cool-retro-term-webgl
- **Stars:** Check repo
- **License:** Check repo
- **What it does:** WebGL-based CRT terminal renderer that integrates with XTerm.js. Scanlines, glow, flicker effects. Works in browsers and Electron apps.
- **What we can learn/reuse:**
  - **WebGL CRT shader effects** for our retro IRC aesthetic
  - XTerm.js integration patterns
  - Phosphor glow, scanline rendering
- **Relevance:** HIGH -- directly usable for our retro terminal look

### crt-terminal (npm)

- **URL:** https://github.com/essserrr/crt-terminal
- **Stars:** Check repo
- **License:** MIT
- **What it does:** React component for retro-styled terminal shell. Installable from npm. Turborepo-based monorepo.
- **What we can learn/reuse:**
  - **Drop-in React component** for CRT terminal styling
  - MIT licensed, can integrate directly
- **Relevance:** HIGH -- if we use React, this is a direct UI building block

### HairyDuck/terminal

- **URL:** https://github.com/HairyDuck/terminal
- **Stars:** Small
- **License:** Check repo
- **What it does:** Retro CRT terminal template with authentic effects -- flicker, scanlines, glitch animations.
- **What we can learn/reuse:**
  - CSS/JS effects for CRT look
  - Glitch animation techniques
- **Relevance:** MEDIUM -- design reference

---

## 8. DPO/RLHF Fine-Tuning Tools for Local Models

### Unsloth

- **URL:** https://github.com/unslothai/unsloth
- **Stars:** ~50k+ (rapidly growing)
- **License:** Apache 2.0
- **What it does:** Fine-tuning and RL library for LLMs that trains 2x faster with 70% less VRAM. Supports SFT, DPO, GRPO, RLHF. Works with consumer GPUs (GTX 1070 through H100). Integrates with HuggingFace TRL for DPO training. Can export to GGUF format for Ollama serving.
- **Relevance to KXKM_Clown:** **CRITICAL** -- This is the most practical path for taking DPO preference pairs collected from our chat system and actually fine-tuning local models. Supports the full pipeline: collect pairs -> DPO train with Unsloth -> export GGUF -> serve via Ollama.
- **Could replace/enhance:** The missing fine-tuning component. Our system collects DPO pairs; Unsloth consumes them.
- **Activity:** Very active, last release includes gpt-oss fine-tuning support (August 2025+).

### Hugging Face TRL (Transformer Reinforcement Learning)

- **URL:** https://github.com/huggingface/trl
- **Stars:** ~12k+
- **License:** Apache 2.0
- **What it does:** The standard library for RLHF/DPO workflows. Provides `DPOTrainer` class that directly accepts preference datasets (chosen/rejected pairs). Integrates with Unsloth for speed. Supports SFT, DPO, PPO, ORPO, KTO.
- **Relevance to KXKM_Clown:** **HIGH** -- TRL's `DPOTrainer` is the actual training loop we'd use. Our collected preference pairs map directly to TRL's expected format: `{"prompt": ..., "chosen": ..., "rejected": ...}`.
- **Could replace/enhance:** Works alongside Unsloth as the training framework layer.
- **Activity:** Very active, maintained by Hugging Face core team.

### Axolotl

- **URL:** https://github.com/axolotl-ai-cloud/axolotl
- **Stars:** ~10k+
- **License:** Apache 2.0
- **What it does:** No-code fine-tuning via YAML config files. Supports DPO (`rl: dpo` in config), LoRA, QLoRA, full fine-tuning. Has built-in merge and export commands. Popular for its simplicity -- just write a YAML file and run.
- **Relevance to KXKM_Clown:** **HIGH** -- Simplest path to DPO fine-tuning. We could auto-generate YAML configs from our collected preference data and trigger training runs.
- **Could replace/enhance:** Alternative to Unsloth+TRL. Less flexible but easier to automate.
- **Activity:** Active, recent guide from February 2026 on SFT+DPO workflows.

### LlamaFactory

- **URL:** https://github.com/hiyouga/LLaMA-Factory
- **Stars:** ~30k+
- **License:** Apache 2.0
- **What it does:** Unified fine-tuning platform for 100+ LLMs/VLMs. Has a web GUI (LlamaBoard) built on Gradio where you can select models, datasets, methods (including DPO), and parameters through dropdowns. Supports pre-training, SFT, reward modeling, PPO, DPO.
- **Relevance to KXKM_Clown:** **HIGH** -- The web GUI makes it the most user-friendly option. Could potentially integrate LlamaBoard as a "training dashboard" accessible from our admin panel.
- **Could replace/enhance:** Could serve as the entire fine-tuning UI. Export models, then import to Ollama.
- **Activity:** Very active (30k+ stars, ACL 2024 paper).

### OpenRLHF

- **URL:** https://github.com/OpenRLHF/OpenRLHF
- **Stars:** ~8k+
- **License:** Apache 2.0
- **What it does:** Production-ready RLHF framework using Ray + vLLM for distributed training. Supports PPO, DPO, DAPO, REINFORCE++. Designed for scale (multi-GPU, multi-node).
- **Relevance to KXKM_Clown:** **MEDIUM** -- Overkill for our use case (single consumer GPU), but good reference for RLHF architecture. Useful if we ever scale up training.
- **Could replace/enhance:** Reference architecture only unless scaling to multi-GPU.
- **Activity:** Very active, ProRL V2 released February 2026.

### DPO vs RLHF: Why DPO for KXKM_Clown

DPO is the clear choice for our system because:
- **No reward model needed** -- RLHF requires training a separate reward model; DPO works directly with preference pairs
- **Simpler pipeline** -- just collect (chosen, rejected) pairs from user votes in chat
- **Lower compute** -- feasible on a single consumer GPU with Unsloth
- **Same data format** -- our upvote/downvote system directly produces DPO training data

---

## 9. Ollama Fine-Tuning Pipeline & GGUF Tools

### The Complete Pipeline: Chat -> DPO -> Ollama

```
KXKM_Clown Chat UI
    |
    v  (users vote on responses)
DPO Preference Pairs (JSON/JSONL)
    |
    v  (Unsloth + TRL DPOTrainer, or Axolotl, or LlamaFactory)
Fine-Tuned LoRA Adapter
    |
    v  (merge adapter + base model)
Full Model (Safetensors/HF format)
    |
    v  (llama.cpp convert_hf_to_gguf.py)
GGUF Model File
    |
    v  (ollama create with Modelfile)
Ollama Model (ready to serve)
```

### llama.cpp (GGUF Conversion & Quantization)

- **URL:** https://github.com/ggml-org/llama.cpp
- **Stars:** ~75k+
- **License:** MIT
- **What it does:** LLM inference in C/C++. Crucially, provides `convert_hf_to_gguf.py` for converting HuggingFace models to GGUF format, and `llama-quantize` for quantizing to Q4_K_M, Q5_K_M, etc.
- **Relevance to KXKM_Clown:** **CRITICAL** -- This is the bridge between fine-tuning (PyTorch/HF) and serving (Ollama). Every fine-tuned model must pass through llama.cpp's converter.
- **Key commands:**
  ```bash
  # Convert HF model to GGUF
  python convert_hf_to_gguf.py /path/to/merged-model --outfile model.gguf --outtype f16
  # Quantize
  ./llama-quantize model.gguf model-Q4_K_M.gguf Q4_K_M
  ```

### Ollama Model Import

- **URL:** https://docs.ollama.com/import
- **What it does:** Ollama can import GGUF models and LoRA adapters directly. Create a `Modelfile` pointing to your GGUF, then `ollama create mymodel -f Modelfile`.
- **Relevance to KXKM_Clown:** **CRITICAL** -- Final step in our pipeline. Can also import LoRA adapters directly (must use same base model).
- **Key Modelfile example:**
  ```
  FROM ./model-Q4_K_M.gguf
  PARAMETER temperature 0.7
  SYSTEM "You are a witty IRC channel regular named ClownBot."
  ```
- **Quantization shortcut:** `ollama create mymodel -q Q4_K_M` can quantize FP16/FP32 models directly.

### Recommended Fine-Tuning Stack for KXKM_Clown

| Step | Tool | Why |
|------|------|-----|
| **Collect pairs** | KXKM_Clown (our system) | Users upvote/downvote in chat |
| **Export dataset** | Custom script | Convert to HF DPO format: `{prompt, chosen, rejected}` |
| **Fine-tune (DPO)** | **Unsloth + TRL** (primary) or **Axolotl** (simpler) | Consumer GPU friendly, fast |
| **Merge adapter** | Unsloth/PEFT merge | Merge LoRA into base model |
| **Convert GGUF** | **llama.cpp** `convert_hf_to_gguf.py` | Standard conversion |
| **Quantize** | **llama.cpp** `llama-quantize` or Ollama `-q` flag | Q4_K_M for speed, Q5_K_M for quality |
| **Deploy** | **Ollama** `ollama create` + Modelfile | Serve fine-tuned model locally |

---

## 10. WebSocket Chat Libraries for Node.js

### ws

- **URL:** https://github.com/websockets/ws
- **npm:** `npm i ws`
- **Stars:** ~22k+
- **Weekly downloads:** ~110M
- **License:** MIT
- **What it does:** Blazing fast, well-tested, pure WebSocket implementation for Node.js. No extra abstractions -- raw WebSocket protocol. Lightweight (~35KB).
- **Relevance to KXKM_Clown:** **HIGH** -- If we want minimal overhead and direct control over the WebSocket protocol. Best for performance-critical applications. Already the most downloaded WS library in the npm ecosystem.
- **Could replace/enhance:** If the current implementation uses Socket.IO, `ws` would be lighter but requires manual reconnection/room logic.
- **Activity:** Very active, ~110M weekly downloads.

### Socket.IO

- **URL:** https://github.com/socketio/socket.io
- **npm:** `npm i socket.io`
- **Stars:** ~62k+
- **Weekly downloads:** ~8M
- **License:** MIT
- **What it does:** Full-featured real-time engine with rooms, namespaces, auto-reconnection, multiplexing, middleware, binary streaming, and graceful fallback to HTTP long-polling.
- **Relevance to KXKM_Clown:** **HIGH** -- Built-in rooms map perfectly to IRC channels. Namespaces could separate admin/chat traffic. Auto-reconnection is crucial for a chat app. Most tutorials and examples available.
- **Could replace/enhance:** The natural choice if we want IRC-like rooms/channels with minimal custom code.
- **Activity:** Very active, 62k stars, mature ecosystem.

### uWebSockets.js

- **URL:** https://github.com/uNetworking/uWebSockets.js
- **npm:** Not on npm (installed from GitHub)
- **Stars:** ~8.7k+
- **License:** Apache 2.0
- **What it does:** The fastest WebSocket server for Node.js. Handles 5x more connections than Socket.IO at lower CPU/memory. Written in C++ with JS bindings. Can handle 150k concurrent clients per core.
- **Relevance to KXKM_Clown:** **MEDIUM** -- Massive overkill for our use case (local IRC chat), but interesting if we ever scale. Harder to use (no rooms/namespaces built-in, not on npm).
- **Could replace/enhance:** Only if performance becomes a bottleneck.
- **Activity:** Active, but smaller community.

### Recommendation for KXKM_Clown

**Socket.IO** is the best fit because:
- Built-in rooms = IRC channels
- Built-in namespaces = separate chat/admin/system channels
- Auto-reconnection = reliable chat
- Event-based API = clean message handling
- Massive ecosystem of middleware and adapters
- If pure performance matters later, `ws` is the fallback

---

## 11. IRC Protocol Libraries for Node.js

### irc-framework

- **URL:** https://github.com/kiwiirc/irc-framework
- **npm:** `npm i irc-framework`
- **Stars:** ~200+
- **License:** MIT
- **What it does:** Modern, IRCv3-compliant framework for building IRC clients and bots. Supports multiple character encodings, SASL auth, capability negotiation. Used by KiwiIRC (a popular web IRC client).
- **Relevance to KXKM_Clown:** **HIGH** -- If we want true IRC protocol compliance (so real IRC clients like mIRC, HexChat can connect to our server), this is the best client-side library. Could also be used to bridge our system to existing IRC networks.
- **Could replace/enhance:** Could add real IRC protocol support alongside WebSocket, allowing traditional IRC clients to join our channels.
- **Activity:** Last published ~1 year ago, stable.

### node-irc (matrix-org fork)

- **URL:** https://github.com/matrix-org/node-irc
- **npm:** `npm i matrix-org-irc`
- **Stars:** ~100+
- **License:** GPL-2.0
- **What it does:** TypeScript IRC client library, forked from the original node-irc and maintained by the Matrix.org team. More actively maintained than the original.
- **Relevance to KXKM_Clown:** **MEDIUM** -- Better maintained than original node-irc, but GPL license is restrictive.
- **Activity:** Last published ~1 year ago.

### irc (original)

- **URL:** https://github.com/martynsmith/node-irc
- **npm:** `npm i irc`
- **Stars:** ~800+
- **License:** GPL-2.0
- **What it does:** The original IRC client library for Node.js. Simple API but not maintained (last publish 9 years ago).
- **Relevance to KXKM_Clown:** **LOW** -- Abandoned, use irc-framework instead.

### irc-server (lsongdev)

- **URL:** https://github.com/lsongdev/node-irc
- **npm:** `npm i irc-server`
- **What it does:** IRC **server** implementation in Node.js. Creates a basic IRC server with `IRC.createServer()` on port 6667.
- **Relevance to KXKM_Clown:** **INTERESTING** -- If we want to run an actual IRC server that LLM bots and human users connect to via standard IRC clients. This would make KXKM_Clown a real IRC server with AI participants.
- **Could replace/enhance:** Could be the core of an "IRC mode" where traditional IRC clients connect alongside our web UI.

### Strategy for IRC Compliance

Two approaches:
1. **IRC-flavored WebSocket** (current approach) -- mimic IRC commands/aesthetics over WebSocket. Simpler, web-only.
2. **True IRC server + web bridge** -- run a real IRC server (irc-server), connect LLM bots via irc-framework, bridge to web via WebSocket. Allows real IRC clients like mIRC to connect. More complex but authentic.

---

## 12. Retro / Terminal CSS Frameworks

### Terminal.css

- **URL:** https://terminalcss.xyz/
- **npm:** `npm i terminal.css` (if available) or CDN
- **Stars:** ~3k+
- **License:** MIT
- **What it does:** Modern, minimal CSS framework for terminal lovers. ~3KB gzipped, no dependencies. Includes 10+ color themes (Dracula, Gruvbox, Catppuccin, Solarized, etc.). Dark/light modes. Styles semantic HTML to look terminal-native.
- **Relevance to KXKM_Clown:** **HIGH** -- Lightest option, great themes, looks like a terminal without being kitschy. Good base for an IRC aesthetic.
- **Could replace/enhance:** Drop-in base CSS for the entire chat UI.

### WebTUI

- **URL:** https://github.com/nicholasgasior/webtui (or search "WebTUI CSS")
- **License:** MIT
- **What it does:** Terminal-inspired CSS styling layer using modern CSS features (layers, custom properties). Supports theme plugins (Catppuccin, Nord). Light/dark modes. Components and utilities that evoke classic terminal UI.
- **Relevance to KXKM_Clown:** **HIGH** -- Modern approach to retro terminal styling. CSS layers make it easy to override/customize.

### Hacker.css

- **URL:** https://github.com/pshihn/hacker (or search "hacker.css")
- **License:** MIT
- **What it does:** Tiny CSS framework that makes pages look like a retro terminal -- bright green text on black, glowing elements. No CSS classes needed, styles semantic HTML directly.
- **Relevance to KXKM_Clown:** **MEDIUM** -- Very minimal, good for the "green on black" mIRC look. May need extension for full chat UI needs.

### 98.css / XP.css / 7.css

- **URLs:**
  - https://github.com/jdan/98.css (~9k stars)
  - https://github.com/botoxparty/XP.css (~3k stars)
  - https://github.com/khang-nd/7.css (~2k stars)
- **npm:** `npm i 98.css` / `npm i xp.css` / `npm i 7.css`
- **License:** MIT
- **What it does:** Faithful CSS recreations of Windows 98/XP/7 UI elements. No JavaScript. Style semantic HTML to look like classic Windows. Buttons, windows, scrollbars, tabs, trees, menus.
- **Relevance to KXKM_Clown:** **HIGH for nostalgia factor** -- 98.css in particular would give a late-90s mIRC feel. Window chrome, scrollbars, and buttons would look authentic. Could frame chat windows as Win98-style windows.
- **Could replace/enhance:** Use 98.css for window frames and controls, combine with Terminal.css for the chat text area.

### Hacker Bootstrap Theme

- **URL:** https://github.com/brobin/hacker-bootstrap
- **License:** MIT
- **What it does:** Bootstrap theme with green-on-black terminal aesthetic. All Bootstrap components restyled.
- **Relevance to KXKM_Clown:** **MEDIUM** -- If already using Bootstrap, this is a quick retheme. Otherwise, Bootstrap is heavy overhead.

### blessed / blessed-contrib (Node.js TUI)

- **URL:** https://github.com/chjj/blessed (~11k stars)
- **URL:** https://github.com/yaronn/blessed-contrib (~15k stars)
- **npm:** `npm i blessed` / `npm i blessed-contrib`
- **License:** MIT
- **What it does:** High-level terminal UI library for Node.js. Blessed provides ncurses-like widgets (windows, forms, lists, tables). Blessed-contrib adds dashboards, graphs, ASCII art, maps.
- **Relevance to KXKM_Clown:** **NICHE** -- Only relevant if we want a purely terminal-based (non-web) admin dashboard or monitoring view. Could build a CLI admin tool that shows real-time chat activity in ASCII art dashboards.

### CSS Strategy for KXKM_Clown

Recommended combination:
1. **98.css** for window chrome, scrollbars, buttons, and menus (the mIRC frame)
2. **Terminal.css** or custom CSS for the chat message area (monospace, colored nicks)
3. **Custom CRT effects** (scanlines, glow) via the cool-retro-term-webgl shaders from section 7
4. **CSS custom properties** for theme switching (classic mIRC / hacker green / Dracula / etc.)

---

## 13. Multi-Agent Chat Projects (LLMs Talking to Each Other)

### SillyTavern + ST-Multi-Model-Chat

- **URL:** https://github.com/SillyTavern/SillyTavern (~11k+ stars)
- **Extension:** https://github.com/sinnerconsort/ST-Multi-Model-Chat
- **License:** AGPL-3.0
- **What it does:** LLM frontend focused on character cards, roleplay, group chats. The Multi-Model-Chat extension lets different characters in a group chat use different AI models/APIs. Built-in "talkativeness" factor determines who speaks. Group chat simulates natural conversation flow.
- **Relevance to KXKM_Clown:** **VERY HIGH** -- This is the closest existing project to our multi-character, multi-model chat concept. Key differences: SillyTavern is RP-focused (not IRC-style), uses AGPL license, and doesn't have DPO/reinforcement learning.
- **What we can learn:** Character card format, talkativeness/turn-taking algorithm, multi-model routing per character, group chat flow management.

### SillyTavern MultiPlayer (STMP)

- **URL:** https://github.com/RossAscends/STMP
- **Stars:** ~103
- **License:** Check repo
- **What it does:** Multi-user LLM chat interface where multiple human users chat together with AI characters. Includes host moderation tools, sidebar user-only chat, WebSocket-based, supports multiple LLM backends (TabbyAPI, KoboldCPP, Aphrodite, OpenRouter). Cloudflare tunnel support for remote access.
- **Relevance to KXKM_Clown:** **VERY HIGH** -- Multi-user + multi-AI in the same chat is exactly our concept. Uses Node.js + WebSocket. Key differences: no IRC aesthetic, no DPO, no self-reinforcement loop.
- **Could replace/enhance:** Study its multi-user architecture. The host controls and moderation patterns are directly useful.

### ChatArena

- **URL:** https://github.com/Farama-Foundation/chatarena
- **Stars:** ~1.5k
- **License:** Apache 2.0
- **What it does:** Multi-agent language game environments for LLMs. Agents play characters in structured games (debates, deduction, negotiation). MDP-based framework. Web UI and CLI. Pre-built environments: Chameleon (social deduction), NLP Classroom, Rock-Paper-Scissors.
- **Relevance to KXKM_Clown:** **MEDIUM** -- Interesting multi-agent conversation patterns. Game-like structure could inspire "chat games" in our IRC channels.
- **NOTE:** **DEPRECATED** as of August 2025 due to lack of community adoption. Code is still available as reference.

### llm-convo

- **URL:** https://github.com/hugalafutro/llm-convo
- **Stars:** Small
- **License:** Check repo
- **What it does:** Let 2 AI LLMs talk to each other via OpenAI-compatible API endpoints. Uses Flask, supports Claude, GPT-4, local models (Qwen).
- **Relevance to KXKM_Clown:** **MEDIUM** -- Simple reference for LLM-to-LLM conversation. Our system does this with N agents, not just 2.

### llm_conversation

- **URL:** https://github.com/famiu/llm_conversation
- **Stars:** Small
- **License:** Check repo
- **What it does:** Python program where LLM agents play characters and talk to each other. Supports different turn-order strategies: round-robin, and a moderator agent that chooses who speaks next.
- **Relevance to KXKM_Clown:** **MEDIUM** -- The moderator-decides-who-speaks-next pattern is interesting for our turn-taking system.

---

## 14. Additional Ollama Web UIs (Lightweight)

### Hollama

- **URL:** https://github.com/fmaclen/hollama
- **Stars:** ~1.1k
- **License:** MIT
- **Tech stack:** TypeScript + Svelte
- **What it does:** Minimal LLM chat app running entirely in the browser. Supports Ollama and OpenAI servers. Multi-server support, markdown rendering, code editor, customizable system prompts. Data stored locally in browser. Desktop client available.
- **Relevance to KXKM_Clown:** **MEDIUM** -- Good reference for a lightweight Svelte-based Ollama UI. Clean codebase. But single-user, single-conversation model.

### Ollama-GUI

- **URL:** https://github.com/HelgeSverre/ollama-gui
- **License:** Check repo
- **What it does:** Simple web interface for chatting with local LLMs via the Ollama API.
- **Relevance to KXKM_Clown:** **LOW** -- Too simple, but good for understanding minimal Ollama API integration.

### text-generation-webui (oobabooga)

- **URL:** https://github.com/oobabooga/text-generation-webui
- **Stars:** ~42k+
- **License:** AGPL-3.0
- **What it does:** The most feature-rich local LLM UI. Supports multiple backends (llama.cpp, Transformers, ExLlamaV3, TensorRT-LLM). Chat modes with custom character personas. File attachments, vision capabilities. OpenAI-compatible API. 100% offline, zero telemetry. Extension system. A character voting extension lets you chat with multiple character variants and vote on best replies.
- **Relevance to KXKM_Clown:** **HIGH** -- The character voting extension is remarkably similar to our DPO collection concept. Study how they implemented preference collection in a chat UI.
- **Could replace/enhance:** The voting extension pattern could directly inform our DPO data collection UX.

---

## 15. Key Takeaways for KXKM_Clown

### Recommended Architecture Stack

| Layer | Recommendation | Why |
|-------|---------------|-----|
| **LLM API Gateway** | **LiteLLM** | Unified API to 100+ models, MIT license, self-hosted, cost tracking |
| **WebSocket Layer** | **Socket.IO** | Built-in rooms (=IRC channels), namespaces, auto-reconnect, MIT |
| **Multi-Agent Patterns** | Borrow from **AutoGen** debate pattern + **Swarm** handoffs | Turn-taking, role-based agents, lightweight |
| **IRC Protocol (optional)** | **irc-framework** + **irc-server** | True IRC compliance, allow mIRC/HexChat clients to connect |
| **DPO Fine-Tuning** | **Unsloth + TRL DPOTrainer** (primary) or **Axolotl** (simpler) | Consumer GPU, 2x faster, GGUF export |
| **GGUF Conversion** | **llama.cpp** convert + quantize | Standard pipeline to get models into Ollama |
| **Fine-Tuning GUI** | **LlamaFactory LlamaBoard** | Web UI for training, no code needed |
| **Retro UI CSS** | **98.css** (window chrome) + **Terminal.css** (chat area) + CRT shaders | Authentic mIRC-era look |
| **CRT Effects** | **cool-retro-term-webgl** | WebGL scanlines, glow, phosphor |
| **Chat UI Patterns** | Study **LibreChat** (MIT) for model switching UX | Best multi-model UX, permissive license |
| **Multi-Character Reference** | Study **SillyTavern** + **STMP** | Group chat flow, character cards, multi-model routing |

### What Makes Us Different

Most existing projects fall into three camps:
1. **Polished ChatGPT clones** (LibreChat, Open WebUI, LobeChat) -- talk to one model at a time, switch models between messages
2. **Multi-agent frameworks** (AutoGen, CrewAI, Swarm) -- agents collaborate programmatically, no real-time chat UI
3. **RP/character chat** (SillyTavern, oobabooga) -- multi-character group chat but RP-focused, no DPO loop, no IRC aesthetic

**Nobody is combining ALL of these:**
- IRC-style multi-user/multi-bot channel interface
- Multiple LLMs as distinct "characters" in the same conversation
- Retro/terminal aesthetic (mIRC-era look)
- DPO auto-reinforcement loop (users vote, models improve)
- Lightweight, local-first, self-hosted
- Full fine-tuning pipeline from chat to improved model

This is our gap. The closest projects:
- **SillyTavern + Multi-Model-Chat** -- multi-character, multi-model group chat, but RP-focused, no DPO, no IRC look
- **STMP** -- multi-user + multi-AI chat, but no IRC aesthetic, no learning loop
- **Soulshack** -- IRC + multi-LLM but no web UI, no DPO
- **oobabooga character voting** -- preference collection in chat, but single-user, no IRC

### The DPO Auto-Reinforcement Loop (Our Unique Feature)

No existing project closes the loop from chat preference collection to model fine-tuning:

```
1. Users chat with multiple LLM personas in IRC-style channels
2. Users upvote/downvote responses (like mIRC kicks/ops)
3. System collects DPO pairs: {prompt, chosen_response, rejected_response}
4. Periodically trigger fine-tuning (Unsloth+TRL or Axolotl)
5. Convert fine-tuned model to GGUF (llama.cpp)
6. Import into Ollama (ollama create)
7. Deploy updated model back into chat
8. Repeat -- models get better over time
```

This is genuinely novel. The closest existing pattern is oobabooga's character voting extension, but it doesn't close the training loop.

### License Summary

| Project | License | Can we use freely? |
|---------|---------|-------------------|
| LibreChat | MIT | Yes |
| LiteLLM | MIT | Yes |
| AnythingLLM | MIT | Yes |
| OpenAI Swarm | MIT | Yes |
| AIChat | MIT/Apache 2.0 | Yes |
| crt-terminal | MIT | Yes |
| AutoGen | MIT | Yes |
| CrewAI | MIT | Yes |
| Agent Squad | Apache 2.0 | Yes |
| Unsloth | Apache 2.0 | Yes |
| TRL | Apache 2.0 | Yes |
| Axolotl | Apache 2.0 | Yes |
| LlamaFactory | Apache 2.0 | Yes |
| llama.cpp | MIT | Yes |
| Socket.IO | MIT | Yes |
| ws | MIT | Yes |
| irc-framework | MIT | Yes |
| Terminal.css | MIT | Yes |
| 98.css | MIT | Yes |
| blessed | MIT | Yes |
| LobeChat | LobeHub Community | No (derivative work restrictions) |
| Open WebUI | Open WebUI License | No (branding restrictions) |
| SillyTavern | AGPL-3.0 | Copyleft concerns (study, don't copy) |
| oobabooga | AGPL-3.0 | Copyleft concerns (study, don't copy) |
| Jan | AGPLv3 | Copyleft concerns |
| Ollamarama-IRC | AGPL-3.0 | Copyleft concerns |
| MAD | GPLv3 | Copyleft concerns |
| Chatbox | GPLv3 | Copyleft concerns |

### Priority Actions

1. **Set up LiteLLM proxy** as our unified backend -- it handles all LLM provider complexity
2. **Implement Socket.IO rooms** as IRC channels with proper nick management
3. **Study SillyTavern's group chat algorithm** for multi-character turn-taking and talkativeness
4. **Study STMP's multi-user architecture** for how humans and AIs coexist in the same chat
5. **Build the DPO collection pipeline** -- upvote/downvote UI -> JSONL export in HF DPO format
6. **Set up Unsloth + TRL** for DPO fine-tuning on consumer GPU
7. **Automate the GGUF pipeline**: fine-tune -> merge -> convert -> quantize -> ollama create
8. **Prototype the retro UI** using 98.css (window chrome) + Terminal.css (chat area) + CRT shaders
9. **Optionally add irc-framework** for true IRC protocol support (mIRC clients can connect)
10. **Study oobabooga's character voting extension** for preference collection UX patterns

---

## Sources

### IRC-Like LLM Chat Systems
- [Soulshack](https://github.com/pkdindustries/soulshack)
- [Ollamarama-IRC](https://github.com/h1ddenpr0cess20/ollamarama-irc)
- [Franklin](https://github.com/oxagast/Franklin)

### Ollama Web UIs
- [Open WebUI](https://github.com/open-webui/open-webui)
- [Hollama](https://github.com/fmaclen/hollama)
- [LobeChat](https://github.com/lobehub/lobe-chat)
- [LibreChat](https://github.com/danny-avila/LibreChat)
- [AnythingLLM](https://anythingllm.com/)
- [Ollama-GUI](https://github.com/HelgeSverre/ollama-gui)
- [Ollama UI](https://github.com/ollama-ui/ollama-ui)
- [12 Tools to Provide a Web UI for Ollama](https://itsfoss.com/ollama-web-ui-tools/)
- [8 Open WebUI Alternatives for 2026](https://budibase.com/blog/alternatives/open-webui/)
- [Five Ollama WebUI Client Recommendations](https://lobehub.com/blog/5-ollama-web-ui-recommendation)

### Multi-Agent Chat Frameworks
- [AutoGen](https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat/)
- [CrewAI](https://github.com/crewAIInc/crewAI)
- [ChatArena](https://github.com/Farama-Foundation/chatarena) (deprecated Aug 2025)
- [ChatDev](https://github.com/OpenBMB/ChatDev)
- [Langroid](https://github.com/langroid/langroid)
- [OpenAI Swarm](https://github.com/openai/swarm)
- [Agent Squad (AWS)](https://github.com/awslabs/agent-squad)
- [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- [STMP - SillyTavern MultiPlayer](https://github.com/RossAscends/STMP)
- [ST-Multi-Model-Chat](https://github.com/sinnerconsort/ST-Multi-Model-Chat)
- [llm-convo](https://github.com/hugalafutro/llm-convo)
- [llm_conversation](https://github.com/famiu/llm_conversation)
- [TwoAI](https://github.com/Fus3n/TwoAI)

### DPO/RLHF Fine-Tuning Tools
- [Unsloth](https://github.com/unslothai/unsloth)
- [Hugging Face TRL](https://huggingface.co/docs/trl/main/en/dpo_trainer)
- [Axolotl](https://github.com/axolotl-ai-cloud/axolotl)
- [LlamaFactory](https://github.com/hiyouga/LLaMA-Factory)
- [OpenRLHF](https://github.com/OpenRLHF/OpenRLHF)
- [Complete Guide to SFT and DPO Fine-tuning with Axolotl](https://saraswatmks.github.io/2026/02/complete-guide-sft-dpo-finetuning-axolotl.html)
- [DPO Trainer Documentation](https://huggingface.co/docs/trl/main/en/dpo_trainer)
- [Fine-Tuning LLMs with Unsloth and Ollama](https://medium.com/@sbasil.ahamed/fine-tuning-llms-with-unsloth-and-ollama-a-step-by-step-guide-33c82facde51)

### WebSocket Libraries
- [Socket.IO](https://github.com/socketio/socket.io) (62k stars)
- [ws](https://github.com/websockets/ws) (22k stars, 110M weekly downloads)
- [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js)
- [WebSocket Libraries for Node.js Comparison](https://ably.com/blog/websocket-libraries-for-node)

### IRC Protocol Libraries
- [irc-framework](https://www.npmjs.com/package/irc-framework) (IRCv3 compliant)
- [node-irc (original)](https://github.com/martynsmith/node-irc)
- [matrix-org-irc](https://www.npmjs.com/package/matrix-org-irc)
- [irc-server](https://github.com/lsongdev/node-irc)

### Retro/Terminal CSS Frameworks
- [Terminal.css](https://terminalcss.xyz/)
- [98.css](https://jdan.github.io/98.css/) (9k stars)
- [XP.css](https://botoxparty.github.io/XP.css/)
- [7.css](https://khang-nd.github.io/7.css/)
- [Hacker.css](https://www.cssscript.com/retro-terminal-hacker/)
- [WebTUI](https://www.cssscript.com/terminal-web-tui/)
- [Hacker Bootstrap](https://brobin.github.io/hacker-bootstrap/)
- [blessed](https://github.com/chjj/blessed) (11k stars)
- [blessed-contrib](https://github.com/yaronn/blessed-contrib) (15k stars)
- [Retro CSS Frameworks List](https://github.com/matt-auckland/retro-css)
- [10 Retro CSS Frameworks](https://dev.to/khangnd/10-retro-css-frameworks-to-relive-your-childhood-nph)

### Ollama Fine-Tuning Pipeline
- [Ollama Model Import Documentation](https://docs.ollama.com/import)
- [llama.cpp](https://github.com/ggml-org/llama.cpp)
- [Fine-Tune SLMs: From Colab to Ollama](https://dzone.com/articles/fine-tune-lms-for-free)
- [Fine-Tuning Local LLMs with Ollama](https://markaicode.com/ollama-fine-tuning-workflow/)
- [Serve Fine-tuned LLMs with Ollama](https://www.union.ai/blog-post/serve-fine-tuned-llms-with-ollama)
- [text-generation-webui](https://github.com/oobabooga/text-generation-webui) (42k+ stars)

---

*Research compiled and expanded for the KXKM_Clown project, 2026-03-11*
