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

## 16. V2 References retained

These are the references retained for the V2 refactor direction:

- **ComfyUI**: reference for node graph ergonomics, typed nodes, workflow docs, artifacts.
- **Letta**: reference for layered memory and agent/persona memory separation.
- **LibreChat**: reference for private multi-user chat shell, agents and MCP integration patterns.
- **Flowise**: reference for graph-first LLM workflow UX and low-code orchestration.
- **n8n**: reference for operator-facing queue/retry/log ergonomics.
- **LangGraph**: reference for stateful orchestration around long-running agent workflows.

What we keep for KXKM_Clown:
- node graph and artifact literacy from ComfyUI
- memory layering from Letta
- private chat/admin shell patterns from LibreChat
- operator workflow visibility from Flowise / n8n
- explicit state transitions and resumability from LangGraph

What we do not copy:
- generic SaaS UI language
- public-cloud-first assumptions
- opaque black-box agent orchestration

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

---

## Addendum 2026-03-16 — Pipeline, Node Editors, Ollama SDK

### Pipeline / DAG Orchestration

| Projet | Stars | License | Notes |
|--------|-------|---------|-------|
| **Node-RED** | 22.9k | Apache 2.0 | Flow-based, visual editor, embeddable Node.js, v4.1.7 mars 2026 |
| **Agenda** | 9.6k | MIT | Job scheduling Node.js, persistence Mongo/PG/Redis, retry, distribué |
| **HyperFlow** | 68 | — | Workflow scientifique DAG, actif mars 2026 |

### Visual Node/Graph Editors

| Projet | Stars | License | Notes |
|--------|-------|---------|-------|
| **Rete.js v2** | 11.9k | MIT | Framework node editor, dataflow+control flow, multi-framework |
| **Drawflow** | 6k+ | Permissive | Vanilla JS, léger, drag-drop, zoom, modules — déjà dans le projet |
| **maxGraph** | 1.1k | Apache 2.0 | Successeur mxGraph, TypeScript, layout auto, pipeline-ready |

### Ollama Integration

| Projet | Stars | License | Notes |
|--------|-------|---------|-------|
| **ollama-js** (officiel) | 4.1k | MIT | SDK officiel : streaming, tool calling, LoRA, embeddings, model mgmt |

### Matrice de décision refonte

| Besoin | Solution actuelle | Upgrade recommandée | Priorité |
|--------|-------------------|---------------------|----------|
| Client Ollama | `ollama.js` custom HTTP | `ollama-js` officiel | **Haute** |
| Queue/scheduling | `node-engine-queue.js` custom | OK pour l'instant, Agenda en fallback | Basse |
| Node editor visuel | JSON textarea | Drawflow (déjà dispo) puis Rete.js v2 | Moyenne |
| Pipeline DAG | `node-engine-runner.js` custom | OK, inspiré Node-RED patterns | Basse |
| Admin UI | Vanilla JS custom | Garder vanilla, enrichir composants | Basse |

---

## 2026-03-16 — Veille OSS mise à jour

Mise à jour ciblée sur 6 projets directement pertinents pour KXKM_Clown : SDK Ollama, éditeurs de noeuds visuels, queues de jobs, orchestration LLM, flow builders, et alternatives d'inférence locale.

### Vue d'ensemble

| Projet | Version | Stars | License | Langage principal |
|--------|---------|-------|---------|-------------------|
| **ollama-js** | v0.6.3 (nov 2025) | 4.1k | MIT | TypeScript |
| **Rete.js v2** | v2.0.6 (juin 2025) | 11.9k | MIT | TypeScript (97%) |
| **BullMQ** | v5.71.0 (mars 2026) | 8.6k | MIT | TypeScript |
| **LangChain.js** | v1.2.32 (mars 2026) | 17.2k | MIT | TypeScript (96%) |
| **Flowise** | v3.0.13 (fév 2026) | 50.8k | Apache 2.0 | TypeScript/JS |
| **LocalAI** | v3.10.0 (jan 2026) | 43.7k | MIT | Go |

### Analyse par projet

#### 1. ollama-js — SDK officiel Ollama

- **URL :** https://github.com/ollama/ollama-js
- **Version :** v0.6.3
- **Fonctionnalités clés :**
  - Streaming via `AsyncGenerator` (stream: true)
  - Chat & génération de texte
  - Gestion de modèles (pull, push, create, delete, copy, list, show)
  - Embeddings via `embed()`
  - Tool calling / function calling
  - Support navigateur (import browser module)
  - Web search & web fetch pour modèles nécessitant internet
  - Accès modèles cloud Ollama
  - Process management (`ps()`, abort streaming)
- **Pertinence KXKM_Clown :** Remplacement direct de notre client HTTP custom. Apporte streaming natif, tool calling, et gestion de modèles sans code boilerplate.
- **Recommandation :** **Migration prioritaire** — remplacer `ollama.js` custom par le SDK officiel.

#### 2. Rete.js v2 — Framework éditeur de noeuds visuel

- **URL :** https://github.com/retejs/rete
- **Version :** v2.0.6
- **Fonctionnalités clés :**
  - Framework complet de programmation visuelle
  - Support React, Vue, Angular, Svelte (via Rete Kit)
  - Processing de graphes : dataflow ET control flow
  - Visualisation intégrée multi-framework
  - 84 releases, 1000+ dependants, écosystème mature
- **Pertinence KXKM_Clown :** Alternative plus puissante à Drawflow pour l'éditeur de noeuds du node engine. Supporte nativement dataflow + control flow, ce qui correspond exactement à notre DAG pipeline.
- **Recommandation :** **Évaluer pour v2 du node editor** — Drawflow suffit pour le MVP, mais Rete.js offre plus de flexibilité pour les pipelines complexes.

#### 3. BullMQ — Queue de jobs Redis

- **URL :** https://github.com/taskforcesh/bullmq
- **Version :** v5.71.0 (très actif, dernière release 11 mars 2026)
- **Fonctionnalités clés :**
  - Queue distribuée Redis, atomicité garantie
  - Dépendances parent-enfant, job flows
  - Jobs différés, jobs répétables
  - Rate limiting et contrôle de concurrence
  - Priorités de jobs, déduplication (debounce/throttle)
  - Pause/Resume, workers sandboxés
  - UI intégrée pour monitoring
  - Événements globaux
  - 24.8k dependants, utilisé par Microsoft, NestJS, Langfuse
- **Pertinence KXKM_Clown :** Remplacement robuste de `node-engine-queue.js` si la charge augmente. Les job flows parent-enfant correspondent naturellement aux DAG pipelines.
- **Recommandation :** **Garder en réserve** — notre queue custom suffit pour l'instant, mais BullMQ devient pertinent dès qu'on a besoin de persistance, retry distribué, ou monitoring.

#### 4. LangChain.js — Framework d'orchestration LLM

- **URL :** https://github.com/langchain-ai/langchainjs
- **Version :** v1.2.32 (très actif)
- **Fonctionnalités clés :**
  - Orchestration agents & chains via LangGraph
  - Interopérabilité multi-providers (swap LLM transparent)
  - Intégration données : vector stores, retrievers, tools
  - Streaming natif
  - Multi-environnement : Node.js, Cloudflare Workers, Vercel, navigateur, Deno, Bun
  - Monitoring via LangSmith
- **Pertinence KXKM_Clown :** Pourrait remplacer/enrichir notre logique de chaînes dans le node engine. L'abstraction multi-provider faciliterait l'ajout de backends non-Ollama. LangGraph offre un modèle d'orchestration d'agents plus mature.
- **Recommandation :** **Évaluer sélectivement** — adopter les abstractions utiles (Ollama provider, tool calling) sans embarquer tout le framework. Trop lourd pour un remplacement complet.

#### 5. Flowise — LLM Flow Builder visuel

- **URL :** https://github.com/FlowiseAI/Flowise
- **Version :** v3.0.13
- **Fonctionnalités clés :**
  - Interface visuelle drag-and-drop pour workflows AI
  - Intégration LangChain et multi-providers
  - Low-code / no-code
  - RAG (Retrieval-Augmented Generation)
  - Support multi-agents
  - Chatbot et workflows agentiques
  - Architecture : backend Node.js + frontend React + composants tiers
- **Pertinence KXKM_Clown :** Source d'inspiration directe pour l'UX de notre éditeur de noeuds. Leur architecture (backend Node.js + éditeur visuel) est similaire à la nôtre. Pas un remplacement car trop centré sur LangChain.
- **Recommandation :** **Étudier l'UX et les patterns** — s'inspirer de leur éditeur visuel et de leur gestion de chatflows, mais garder notre architecture custom.

#### 6. LocalAI — Alternative locale à OpenAI

- **URL :** https://github.com/mudler/LocalAI
- **Version :** v3.10.0
- **Fonctionnalités clés :**
  - API REST compatible OpenAI (drop-in replacement)
  - Supporte GGUF, transformers, diffusers
  - Download depuis HuggingFace, Ollama registry, galleries
  - CPU + GPU (CUDA, ROCm, oneAPI, Metal, Vulkan)
  - TTS/STT, génération d'images, embeddings, vision/multimodal
  - Model Context Protocol (MCP) pour capacités agentiques
  - Inférence distribuée P2P
  - API temps réel, détection d'activité vocale, WebUI intégrée
  - Support API Anthropic (nouveau v3.10)
- **Pertinence KXKM_Clown :** Alternative ou complément à Ollama, surtout pour les fonctionnalités avancées (TTS, images, P2P distribué). L'API compatible OpenAI facilite l'intégration.
- **Recommandation :** **Surveiller** — Ollama reste plus simple pour notre cas d'usage, mais LocalAI devient intéressant si on veut du multimodal (voix, images) ou de l'inférence distribuée.

### Matrice de décision

| Besoin KXKM_Clown | Module actuel | Projet OSS | Action recommandée | Priorité |
|--------------------|---------------|------------|---------------------|----------|
| Client Ollama | `ollama.js` HTTP custom | **ollama-js** v0.6.3 | **Migrer** vers SDK officiel | Haute |
| Queue de jobs | `node-engine-queue.js` | **BullMQ** v5.71.0 | Garder custom, BullMQ en fallback | Basse |
| Éditeur de noeuds | Drawflow | **Rete.js** v2.0.6 | Évaluer pour v2 du node editor | Moyenne |
| Orchestration LLM | Node engine custom | **LangChain.js** v1.2.32 | Adopter abstractions sélectives | Moyenne |
| Flow builder UX | Admin dashboard | **Flowise** v3.0.13 | S'inspirer de l'UX | Basse |
| Inférence locale | Ollama | **LocalAI** v3.10.0 | Surveiller pour multimodal | Basse |

### Points saillants

1. **ollama-js est mature** — v0.6.3 couvre tous nos besoins (streaming, tools, embeddings, model mgmt). Migration prioritaire.
2. **BullMQ est le standard** — 8.6k stars, 24.8k dependants, activement maintenu. Si notre queue custom montre ses limites, c'est le choix évident.
3. **Rete.js v2 vs Drawflow** — Rete offre plus de puissance (dataflow + control flow natifs) mais Drawflow reste plus simple. Transition à envisager quand les pipelines deviennent complexes.
4. **LangChain.js est massif** — 17.2k stars, très actif, mais risque de vendor lock-in. Préférer des imports ciblés aux dépendances complètes.
5. **Flowise confirme le pattern** — 50.8k stars valident l'approche "visual LLM flow builder". Notre architecture est sur la bonne voie.
6. **LocalAI progresse vite** — 43.7k stars, support MCP, API Anthropic. Option sérieuse si on dépasse le cadre texte-only.

*Recherche effectuée le 2026-03-16.*

---

## 2026-03-16 — Veille complémentaire (WS, DAG viz, fine-tuning, persona AI)

Recherche complémentaire couvrant quatre axes non traités en profondeur : bibliothèques WebSocket React pour le frontend V2, visualisation DAG pour le Node Engine, toolkits de fine-tuning LLM, et systèmes de persona/character AI.

### Vue d'ensemble

| Projet | Version | Stars | License | Catégorie |
|--------|---------|-------|---------|-----------|
| **react-use-websocket** | v4.0.0 | 1.9k | MIT | WebSocket React hooks |
| **reconnecting-websocket** | v4.4.0 | 1.3k | MIT | WebSocket client léger |
| **dagre** | v2.0.0 | 5.6k | MIT | DAG layout algorithm |
| **React Flow (@xyflow/react)** | v0.0.75 (system) | 35.6k | MIT | Node-based graph editor |
| **TRL** | v0.29.0 | 17.7k | Apache 2.0 | Fine-tuning (SFT, DPO, GRPO) |
| **Unsloth** | latest | 54k | Multiple | Fast LoRA fine-tuning |
| **a16z companion-app** | — | 5.9k | MIT | AI companion / persona |
| **SillyTavern** | v1.16.0 | 24.4k | AGPL-3.0 | Multi-persona LLM frontend |

---

### 1. WebSocket pour React (frontend V2 chat)

#### react-use-websocket

- **URL :** https://github.com/robtaussig/react-use-websocket
- **Version :** v4.0.0 (React 18+ requis ; v3.0.0 pour React < 18)
- **Stars :** 1.9k
- **License :** MIT
- **Fonctionnalités clés :**
  - Hook React `useWebSocket` avec reconnexion automatique configurable
  - Instances partagées entre composants (ref counting + cleanup auto)
  - Heartbeat / ping-pong intégré
  - File d'attente de messages avant connexion (message queuing)
  - Helpers JSON (`sendJsonMessage`, `lastJsonMessage`)
  - Support SSE / EventSource
  - TypeScript natif
  - API : `sendMessage()`, `sendJsonMessage()`, `lastMessage`, `readyState`, `getWebSocket()`
- **Pertinence KXKM_Clown :** Solution idéale pour le frontend V2 React. Le hook gère reconnexion, heartbeat et partage de socket — exactement ce qu'il faut pour un chat live multi-canal.
- **Recommandation :** **Adopter** pour le frontend React V2. Remplace le code WebSocket boilerplate par un hook propre et testé.

#### reconnecting-websocket

- **URL :** https://github.com/pladaria/reconnecting-websocket
- **Version :** v4.4.0 (stable depuis fév. 2020)
- **Stars :** 1.3k
- **License :** MIT
- **Fonctionnalités clés :**
  - API compatible WebSocket standard (Level 0 & Level 2)
  - Reconnexion automatique avec backoff exponentiel (facteur 1.3x)
  - Zero dépendances
  - Multi-plateforme : browser, Worker, Node.js, React Native
  - URL dynamique (string, function, async function)
  - Buffer de messages pendant déconnexion
  - Configurable : `maxReconnectionDelay` (10s), `minReconnectionDelay` (1-5s), `connectionTimeout` (4s), `maxRetries` (illimité par défaut)
- **Pertinence KXKM_Clown :** Alternative légère si on ne veut pas de hook React. Utile aussi côté Node.js pour les connexions WS inter-services. Mature et stable malgré l'âge.
- **Recommandation :** **Garder en option** — utile comme couche de transport si on n'utilise pas React, ou pour des connexions WS côté serveur (ex : node-engine vers service externe).

#### Synthèse WebSocket

| Critère | react-use-websocket | reconnecting-websocket |
|---------|---------------------|------------------------|
| React hooks | Oui (natif) | Non (wrapper requis) |
| Reconnexion auto | Oui | Oui |
| Heartbeat | Oui | Non |
| Zero deps | Non (React peer) | Oui |
| TypeScript | Oui | Oui |
| Cas d'usage | Frontend React V2 | Transport bas niveau / Node.js |

**Verdict :** Utiliser `react-use-websocket` côté frontend React, garder `reconnecting-websocket` en réserve pour usages non-React.

---

### 2. DAG Visualization (Node Engine graph editor)

#### dagre — Algorithme de layout DAG

- **URL :** https://github.com/dagrejs/dagre
- **Version :** v2.0.0 (nov. 2025)
- **Stars :** 5.6k
- **License :** MIT
- **Fonctionnalités clés :**
  - Algorithme de positionnement automatique pour graphes dirigés
  - Layout côté client en JavaScript pur
  - 61.6k dependants npm — standard de facto pour le layout DAG
  - Seul l'organisation DagreJs maintient la version à jour
- **Pertinence KXKM_Clown :** Algorithme de layout pour positionner automatiquement les noeuds du pipeline dans l'éditeur visuel. Se combine avec React Flow ou Drawflow pour le rendu.
- **Recommandation :** **Adopter comme algorithme de layout** — dagre calcule les positions, React Flow ou Drawflow gère le rendu et l'interaction.

#### React Flow (@xyflow/react) — Éditeur de graphes React

- **URL :** https://github.com/xyflow/xyflow
- **Package React :** `@xyflow/react`
- **Version :** @xyflow/system v0.0.75 (fév. 2026)
- **Stars :** 35.6k
- **License :** MIT
- **Fonctionnalités clés :**
  - Bibliothèque React pour UIs node-based (workflows, pipelines, diagrammes)
  - Composants intégrés : MiniMap, Controls, Background
  - Drag-and-drop de connexions entre noeuds
  - TypeScript natif
  - Support React et Svelte
  - Infiniment customisable (noeuds, edges, handles personnalisés)
  - 369+ releases, 6053 commits — très activement maintenu
  - Écosystème mature : utilisé par Stripe, Shopify, et de nombreux outils AI (Flowise, Langflow)
- **Pertinence KXKM_Clown :** Concurrent direct de Drawflow et Rete.js, mais avec un écosystème beaucoup plus large (35.6k stars vs 6k/12k). L'intégration native React est un atout pour le frontend V2. Dagre peut être plugué pour le layout automatique.
- **Recommandation :** **Adopter pour le frontend V2** — React Flow est le standard pour les éditeurs de noeuds React. Supérieur à Drawflow (vanilla JS) pour un frontend React. Combiner avec dagre pour le layout automatique des pipelines.

#### Comparaison éditeurs de noeuds

| Critère | Drawflow | Rete.js v2 | React Flow |
|---------|----------|------------|------------|
| Stars | 6k | 12k | 35.6k |
| Framework | Vanilla JS | Multi (React, Vue...) | React / Svelte |
| TypeScript | Non | Oui | Oui |
| Layout auto | Non | Plugin | Via dagre |
| Complexité | Simple | Élevée | Moyenne |
| Écosystème | Petit | Moyen | Très large |
| Cas d'usage | MVP / vanilla | Pipelines complexes | Frontend React V2 |

**Verdict :** Drawflow pour le MVP actuel (vanilla JS), React Flow + dagre pour le frontend V2 (React).

---

### 3. LLM Fine-Tuning Toolkits (pipeline d'entraînement)

#### TRL — Transformer Reinforcement Learning (HuggingFace)

- **URL :** https://github.com/huggingface/trl
- **Version :** v0.29.0 (fév. 2026)
- **Stars :** 17.7k
- **License :** Apache 2.0
- **Fonctionnalités clés :**
  - **SFT** (Supervised Fine-Tuning) — entraînement supervisé classique
  - **DPO** (Direct Preference Optimization) — alignement par préférences
  - **GRPO** (Group Relative Policy Optimization) — nouveau, alternative à PPO
  - **RewardTrainer** — entraînement de modèles de récompense
  - CLI intégré pour entraîner sans code (`trl sft`, `trl dpo`)
  - Support distribué via Accelerate, DeepSpeed, DDP
  - Intégration PEFT pour LoRA/QLoRA sur gros modèles
  - 2527 commits, 475 contributeurs, 76 releases — très activement maintenu
- **Pertinence KXKM_Clown :** Bibliothèque de référence pour le pipeline DPO. Les données de préférence collectées via l'UI (upvote/downvote) alimentent directement le DPOTrainer. La CLI permet de lancer des entraînements sans code Python custom.
- **Recommandation :** **Utiliser** pour le pipeline de fine-tuning. TRL + Unsloth est la combinaison standard pour DPO sur GPU consumer.

#### Unsloth — Fast LoRA Fine-Tuning

- **URL :** https://github.com/unslothai/unsloth
- **Stars :** 54k
- **License :** Multiple (COPYING + LICENSE)
- **Fonctionnalités clés :**
  - **2x plus rapide** et **70% moins de VRAM** que les approches standard
  - Support full fine-tuning + modes 4-bit, 16-bit, FP8
  - Zero perte de précision (méthodes exactes, pas d'approximation)
  - Modèles supportés : OpenAI gpt-oss, DeepSeek, Qwen, Llama, multimodal, TTS, embeddings
  - Export GGUF, vLLM, SgLang
  - Multi-GPU
  - RL avec 80% moins de VRAM
  - Support hardware : NVIDIA (7.0+), AMD, Intel — Linux, WSL, Windows
- **Benchmarks :**
  - gpt-oss (20B) : 2x plus rapide, 70% moins VRAM
  - Qwen3.5 (4B) : 1.5x plus rapide, 60% moins VRAM
  - Llama 3.1 (8B) : 2x plus rapide, 70% moins VRAM
- **Pertinence KXKM_Clown :** Accélérateur essentiel pour le fine-tuning sur GPU consumer. L'export GGUF direct facilite le pipeline Unsloth -> GGUF -> Ollama. Compatible TRL pour DPO accéléré.
- **Recommandation :** **Utiliser** — combinaison Unsloth + TRL pour le pipeline : collecte préférences -> DPO/SFT accéléré -> export GGUF -> `ollama create`.

#### SDK Node.js pour gestion de jobs d'entraînement

Pas de SDK Node.js dédié identifié pour orchestrer des jobs de fine-tuning. Options :

| Approche | Description | Recommandation |
|----------|-------------|----------------|
| **HuggingFace Inference API** | API REST, pas de fine-tuning custom local | Non pertinent (cloud only) |
| **Child process** | `child_process.spawn('python', ['train.py', ...])` | Simple, suffisant pour MVP |
| **BullMQ + spawn** | Queue Redis + lancement scripts Python | Pour production, monitoring, retry |
| **API REST custom** | Wrapper Express/Fastify autour des scripts Python | Plus de contrôle, mais plus de code |

**Verdict pipeline fine-tuning :** Node.js orchestre (BullMQ ou child_process), Python exécute (TRL + Unsloth). Pas besoin de SDK Node.js spécifique — un simple spawn suffit pour le MVP.

---

### 4. Persona / Character AI (systèmes multi-persona)

#### a16z companion-app — AI Companion Starter

- **URL :** https://github.com/a16z-infra/companion-app
- **Stars :** 5.9k
- **License :** MIT
- **Tech stack :** Next.js, Clerk (auth), Pinecone/Supabase pgvector, LangChain.js, Upstash (historique), Fly.io, Twilio (SMS)
- **Fonctionnalités clés :**
  - Vector DB + similarity search pour conversations contextuelles
  - Mémoire conversationnelle via message queue
  - Personnalités customisables avec backstories
  - Support multi-persona via répertoire `companions/` + `companions.json`
  - Export vers Character.ai
  - Multi-modèles : ChatGPT, Vicuna (Replicate)
  - Canal SMS via Twilio
- **Pertinence KXKM_Clown :** Architecture de référence pour la gestion de personas. Le pattern `companions/` (fichiers de personnalité + config JSON) est directement applicable à notre système de personas. L'intégration vector DB pour la mémoire contextuelle est pertinente pour des personas qui "se souviennent".
- **Recommandation :** **Étudier le pattern de définition de personas** — s'inspirer de la structure companions/ pour notre propre registre de personas. L'architecture vector DB est intéressante mais secondaire pour le MVP.

#### SillyTavern — LLM Frontend Multi-Persona

- **URL :** https://github.com/SillyTavern/SillyTavern
- **Version :** v1.16.0 (fév. 2026)
- **Stars :** 24.4k
- **License :** AGPL-3.0 (copyleft — étudier, ne pas copier le code)
- **Tech stack :** Node.js, JavaScript (85.8%), HTML, CSS, Webpack
- **Fonctionnalités clés :**
  - Support massif de backends LLM (KoboldAI, OpenAI, Claude, Mistral, Ollama...)
  - "Visual Novel Mode" pour interactions immersives
  - WorldInfo / lorebook pour gestion de contexte
  - Group chat multi-personnages avec algorithme de turn-taking et talkativeness
  - Auto-traduction
  - Extensions tierces
  - 11 490 commits, 300+ contributeurs, 100+ releases — extrêmement actif
- **Pertinence KXKM_Clown :** Référence absolue pour le chat multi-persona. L'algorithme de group chat (turn-taking, talkativeness variable par personnage) est directement pertinent. Le système WorldInfo/lorebook est un modèle pour la mémoire contextuelle des personas.
- **Recommandation :** **Étudier en profondeur** (sans copier le code AGPL). Priorités :
  1. Algorithme de group chat et turn-taking
  2. Format de définition de personnages (character cards)
  3. Système WorldInfo pour contexte partagé
  4. Gestion de la talkativeness par personnage

---

### Matrice de décision complémentaire

| Besoin KXKM_Clown | Module actuel | Projet OSS recommandé | Action | Priorité |
|--------------------|---------------|------------------------|--------|----------|
| WebSocket React hooks | — (pas de frontend React) | **react-use-websocket** v4.0.0 | Adopter pour frontend V2 | Haute (V2) |
| WS reconnexion bas niveau | ws + custom | **reconnecting-websocket** v4.4.0 | Option si besoin non-React | Basse |
| DAG layout automatique | Manuel | **dagre** v2.0.0 | Adopter pour node editor | Moyenne |
| Node editor React | Drawflow (vanilla) | **React Flow** @xyflow/react | Adopter pour frontend V2 | Haute (V2) |
| Fine-tuning DPO/SFT | Scripts manuels | **TRL** v0.29.0 | Utiliser | Haute |
| Accélération fine-tuning | — | **Unsloth** (54k stars) | Utiliser avec TRL | Haute |
| Orchestration training Node.js | — | **BullMQ** + child_process | Implémenter | Moyenne |
| Définition de personas | JSON custom | **companion-app** patterns | S'inspirer | Moyenne |
| Multi-persona group chat | Custom | **SillyTavern** (étude) | Étudier l'algorithme | Haute |

### Points saillants

1. **React Flow domine** les éditeurs de noeuds React (35.6k stars). Pour le frontend V2, c'est le choix évident combiné avec dagre pour le layout automatique.
2. **react-use-websocket** est le hook React standard pour WebSocket — reconnexion, heartbeat, partage de socket, tout est inclus.
3. **TRL + Unsloth** reste la combinaison de référence pour le fine-tuning DPO sur GPU consumer. TRL v0.29.0 ajoute GRPO, une alternative à PPO plus stable.
4. **SillyTavern** (24.4k stars, AGPL) est la meilleure source d'inspiration pour le multi-persona group chat, mais le code ne peut pas être copié (licence copyleft).
5. **companion-app** offre un bon pattern MIT pour la structure de personas (fichiers de personnalité + vector DB pour mémoire contextuelle).
6. **Pas de SDK Node.js** pour orchestrer le fine-tuning — l'approche `child_process.spawn` + BullMQ est la plus pragmatique.

*Recherche complémentaire effectuée le 2026-03-16.*

---

## Veille 2026-03-16 — Lot 11

Veille élargie couvrant 6 axes : frameworks multi-persona/multi-agent chat, orchestration LLM (DAG/workflow), écosystème Ollama, pipeline de fine-tuning LoRA/QLoRA, outils DPO/RLHF, et composants React chat UI. Focus sur les évolutions 2025-2026 et les projets non encore couverts.

### Vue d'ensemble

| Projet | Stars | License | Catégorie | Statut |
|--------|-------|---------|-----------|--------|
| **AutoGen** (Microsoft) | 55.7k | MIT | Multi-agent chat/orchestration | Très actif, v0.4+, Magentic-One |
| **LangGraph** | 26.5k | MIT | DAG orchestration, stateful agents | Très actif, CLI v0.4.18 |
| **Flowise** | 50.8k | Apache 2.0 | Visual DAG workflow builder | Très actif, v3.0.13 |
| **n8n** | 179k | Sustainable Use License | Workflow automation, AI-native | Très actif, TypeScript |
| **Haystack** (deepset) | 24.5k | Apache 2.0 | Pipeline AI composable | Très actif, enterprise tier |
| **AutoGPT** | 182k | Polyform Shield (new) / MIT (legacy) | Agent platform, workflow builder | Très actif, plateforme |
| **AG-UI** | 12.5k | MIT | Protocole agent-UI | Nouveau, prometteur |
| **Ollama** | 165k | MIT | LLM local serving | Très actif, nouveaux modèles |
| **llamafile** | 23.8k | Apache 2.0 | LLM single-file executable | Actif, niche |
| **Open WebUI** | 127k | Open WebUI License | Ollama frontend avancé | Très actif, pipelines, enterprise |
| **vLLM** | 73.2k | Apache 2.0 | LLM inference haute perf | Très actif, v0.17.1 |
| **Letta** (ex-MemGPT) | 21.6k | Apache 2.0 | Agent memory management | Actif, v0.16.6 |
| **ComfyUI** | 106k | GPL-3.0 | Node graph visual workflows | Très actif, référence UX |
| **TRL** (HuggingFace) | 17.7k | Apache 2.0 | DPO/SFT/GRPO fine-tuning | Très actif, v0.29.0 |
| **Unsloth** | 54k | Apache 2.0 | Fast LoRA fine-tuning | Très actif, GRPO vision |
| **LLaMA-Factory** | 68.5k | Apache 2.0 | Fine-tuning platform + GUI | Très actif, multimodal |
| **NeMo RL** (NVIDIA) | 1.4k | OSS | RLHF/DPO/GRPO à grande échelle | Actif, v0.5.0, successeur NeMo-Aligner |
| **dstack** | 2.1k | MPL-2.0 | GPU orchestration / infra training | Actif, v0.20.13 |
| **Prefect** | 21.9k | Apache 2.0 | Workflow orchestration DAG | Très actif, ML-friendly |
| **Vercel AI SDK** | 22.7k | OSS | React AI chat hooks + multi-provider | Très actif |
| **chatscope/chat-ui-kit-react** | 1.7k | MIT | React chat UI components | Actif, v2.1.1 |
| **Chatbot UI** | 33.1k | MIT | Next.js chat app reference | Actif, TypeScript |

---

### 1. Multi-Persona / Multi-Agent Chat — Nouveautés

#### AutoGen — v0.4+, Magentic-One, AutoGen Studio

- **URL :** https://github.com/microsoft/autogen
- **Stars :** 55.7k (hausse depuis 40k+ en mars 2026)
- **License :** MIT
- **Nouveautés 2025-2026 :**
  - **Architecture 3 couches** : Core API (message passing), AgentChat API (patterns haut niveau), Extensions API (intégrations)
  - **Magentic-One** : équipe multi-agent SOTA pour web browsing, exécution de code, opérations fichiers
  - **AutoGen Studio** : GUI no-code pour construire des workflows multi-agent
  - **AgentTool** : composition d'agents spécialisés (math, chimie, etc.) qui collaborent
  - **Support MCP** (Model Context Protocol) pour capacités étendues
  - Office hours hebdomadaires, communauté très active (454 issues ouvertes, 222 PRs)
- **Pertinence KXKM_Clown :** L'architecture 3 couches est un bon modèle pour structurer notre propre système multi-agent. AutoGen Studio pourrait inspirer l'UX de notre admin panel pour configurer les interactions entre personas. Magentic-One montre comment orchestrer des agents spécialisés — pattern applicable à nos "clowns" avec rôles distincts.
- **Recommandation :** **Étudier l'architecture** — le pattern AgentChat (two-agent chat, group chat) est directement applicable. MIT, librement réutilisable.

#### AG-UI — Protocole Agent-to-UI

- **URL :** https://github.com/ag-ui-protocol/ag-ui
- **Stars :** 12.5k
- **License :** MIT
- **Ce que c'est :** Protocole ouvert, léger et event-based qui standardise comment les agents AI se connectent aux applications utilisateur. Complète MCP (tools pour agents) et A2A (agent-to-agent) en couvrant la couche agent-vers-UI.
- **Fonctionnalités clés :**
  - ~16 types d'événements standard
  - Chat agentic temps réel avec streaming
  - Synchronisation d'état bidirectionnelle agent-UI
  - Generative UI et messages structurés
  - Human-in-the-loop
  - Support SSE, WebSockets, webhooks
- **Pertinence KXKM_Clown :** Très pertinent pour standardiser la communication entre nos personas (agents) et le frontend chat. Le protocole event-based est compatible avec notre architecture WebSocket. Pourrait remplacer notre format de messages custom par un standard émergent.
- **Recommandation :** **Évaluer pour adoption** — si AG-UI devient un standard, l'adopter tôt nous donne de l'interopérabilité avec d'autres outils. MIT, aucun risque licence.

---

### 2. LLM Orchestration / DAG Workflow — Nouveautés

#### LangGraph — Orchestration stateful à base de graphes

- **URL :** https://github.com/langchain-ai/langgraph
- **Stars :** 26.5k
- **License :** MIT
- **Version :** CLI v0.4.18 (mars 2026)
- **Fonctionnalités clés :**
  - **Durable Execution** — les agents persistent à travers les échecs, reprennent exactement où ils se sont arrêtés
  - **Human-in-the-loop** — inspection et modification de l'état de l'agent à tout moment
  - **Mémoire complète** — mémoire de travail court terme + mémoire persistante long terme
  - Inspiré par Pregel et Apache Beam, interface publique dérivée de NetworkX
  - Intégration LangSmith pour visualisation, debugging, infra scalable
  - Utilisé par 36.7k projets
- **Pertinence KXKM_Clown :** Le modèle de durable execution est pertinent pour notre Node Engine — les pipelines de training longs doivent pouvoir reprendre après échec. La mémoire dual (court/long terme) est applicable aux personas qui doivent se souvenir des conversations.
- **Recommandation :** **S'inspirer des patterns** — durable execution et resumability pour le node engine. Pas de remplacement complet (trop couplé à LangChain), mais les concepts sont transférables.

#### n8n — Workflow Automation AI-Native

- **URL :** https://github.com/n8n-io/n8n
- **Stars :** 179k
- **License :** Sustainable Use License (fair-code, source visible, self-hosted OK)
- **Fonctionnalités clés :**
  - 400+ connecteurs pré-construits
  - JavaScript/Python custom avec packages npm
  - Workflows agents LangChain intégrés
  - Self-hosted ou cloud, support entreprise (SSO, air-gapped)
  - 900+ templates prêts à l'emploi
  - TypeScript (91.4%), Vue frontend
- **Pertinence KXKM_Clown :** Référence pour l'UX opérateur — queue, retry, logs, monitoring de workflows. Les patterns de n8n (visual flow + custom code) valident notre approche node engine. L'intégration LangChain-native montre que les workflows AI sont mainstream.
- **Recommandation :** **Étudier l'UX opérateur** — s'inspirer des patterns de monitoring, retry et logging. Licence fair-code acceptable pour étude.

#### Haystack — Pipelines AI composables

- **URL :** https://github.com/deepset-ai/haystack
- **Stars :** 24.5k
- **License :** Apache 2.0
- **Fonctionnalités clés :**
  - Architecture composant-based avec contrôle explicite sur retrieval, ranking, filtering, routing
  - Model-agnostic (OpenAI, Anthropic, Ollama, HuggingFace, etc.)
  - Pipelines customisables avec boucles, branches et logique conditionnelle
  - Utilisé par Apple, Meta, NVIDIA, Airbus, Netflix
- **Pertinence KXKM_Clown :** L'architecture composant-based avec routing explicite est un bon modèle pour notre node engine. Le pattern "context engineering" (contrôle explicite de ce qui arrive au LLM) est pertinent pour les personas.
- **Recommandation :** **Référence architecturale** — étudier le modèle de composants et pipelines. Apache 2.0, librement réutilisable.

#### AutoGPT — Évolution vers plateforme

- **URL :** https://github.com/Significant-Gravitas/AutoGPT
- **Stars :** 182k
- **License :** Polyform Shield (nouveau) / MIT (legacy)
- **Évolution :** AutoGPT s'est transformé d'agent autonome en plateforme complète avec :
  - **Agent Builder** : construction low-code via blocs connectés (chaque bloc = une action)
  - Workflow management, optimisation, monitoring
  - Bibliothèque d'agents pré-configurés
  - Self-hosted gratuit ou cloud beta
- **Pertinence KXKM_Clown :** Le pivot d'AutoGPT vers une plateforme workflow confirme la direction de notre node engine. Le pattern "blocs connectés" est exactement notre approche DAG. Attention : la nouvelle licence Polyform Shield est restrictive.
- **Recommandation :** **Surveiller** — valide notre direction mais licence problématique pour réutilisation de code.

#### Prefect — Orchestration de workflows ML

- **URL :** https://github.com/PrefectHQ/prefect
- **Stars :** 21.9k
- **License :** Apache 2.0
- **Fonctionnalités clés :**
  - Flows et tasks via décorateurs Python
  - Gestion automatique des dépendances et exécution DAG
  - Retry intégré, scheduling cron, déclenchement événementiel
  - Dashboard monitoring (self-hosted ou cloud)
  - Caching, event-based automations
  - 200M+ tâches mensuelles en production (Progressive, Cash App)
- **Pertinence KXKM_Clown :** Pertinent pour orchestrer les pipelines de training (DPO/SFT). Un pipeline Prefect pourrait enchaîner : export données -> fine-tune -> merge -> convert GGUF -> import Ollama. Plus robuste que notre child_process.spawn pour la production.
- **Recommandation :** **Évaluer pour pipeline de training** — Prefect comme orchestrateur Python des jobs de fine-tuning, déclenché depuis Node.js via BullMQ. Apache 2.0.

---

### 3. Écosystème Ollama — Nouveautés

#### Ollama — 165k stars, écosystème élargi

- **URL :** https://github.com/ollama/ollama
- **Stars :** 165k (hausse massive depuis ~100k)
- **Nouveautés 2025-2026 :**
  - Support de nouveaux modèles : Kimi-K2.5, GLM-5, MiniMax, DeepSeek, gpt-oss, Qwen, Gemma
  - Intégrations officielles : Claude Code, Codex, OpenCode
  - SDK multi-langages (Python, JavaScript officiels)
  - API REST enrichie avec chat et streaming
- **Pertinence KXKM_Clown :** Ollama reste notre backend d'inférence principal. L'écosystème s'élargit rapidement, confirmant notre choix. Les nouveaux modèles (gpt-oss, Kimi-K2.5) élargissent les options pour nos personas.

#### Open WebUI — 127k stars, Pipelines, Enterprise

- **URL :** https://github.com/open-webui/open-webui
- **Stars :** 127k (hausse depuis ~18k, croissance explosive)
- **License :** Open WebUI License (BSD-3 base, restrictions branding)
- **Nouveautés 2025-2026 :**
  - **Pipelines Plugin Framework** : logique Python custom intégrée (function calling, rate limiting, monitoring)
  - **9 vector DBs** supportées : ChromaDB, PGVector, Qdrant, Milvus...
  - **Enterprise auth** : LDAP, SCIM 2.0, SSO via trusted headers
  - **OpenTelemetry** intégré pour observabilité production
  - **Scalabilité horizontale** : sessions Redis, WebSocket multi-worker/multi-node
- **Pertinence KXKM_Clown :** Le Pipelines Plugin Framework est intéressant — pattern pour étendre notre système avec de la logique custom. L'architecture Redis + WebSocket multi-worker est un bon modèle pour la scalabilité future.
- **Recommandation :** **Étudier les Pipelines** — s'inspirer du pattern d'extension. Licence restrictive, ne pas copier le code.

#### llamafile — LLM en fichier unique

- **URL :** https://github.com/Mozilla-Ocho/llamafile
- **Stars :** 23.8k
- **License :** Apache 2.0
- **Ce que c'est :** Distribue et exécute des LLMs via un seul fichier exécutable. Combine llama.cpp + Cosmopolitan Libc pour créer un binaire cross-platform sans installation.
- **Pertinence KXKM_Clown :** Alternative à Ollama pour la distribution de modèles fine-tunés. Un modèle custom pourrait être packagé comme un llamafile autonome pour déploiement ultra-simple. Complémentaire à Ollama, pas un remplacement.
- **Recommandation :** **Garder en option** — intéressant pour distribuer des modèles fine-tunés à des utilisateurs non-techniques.

#### vLLM — Inférence haute performance

- **URL :** https://github.com/vllm-project/vllm
- **Stars :** 73.2k
- **License :** Apache 2.0
- **Version :** v0.17.1 (mars 2026)
- **Fonctionnalités clés :**
  - PagedAttention pour gestion mémoire efficace
  - Batching continu, kernels CUDA optimisés, FlashAttention
  - Quantization : GPTQ, AWQ, INT4/INT8, FP8
  - Inférence distribuée : tensor, pipeline, data, expert parallelism
  - API compatible OpenAI, streaming, **multi-LoRA**
  - Speculative decoding, prefix caching, chunked prefill
- **Pertinence KXKM_Clown :** Le support **multi-LoRA** est très pertinent — permet de servir plusieurs adaptateurs LoRA (un par persona) sur un seul modèle de base, sans multiplier la VRAM. Alternative à Ollama quand on a besoin de servir 10+ personas avec des adaptateurs différents.
- **Recommandation :** **Évaluer pour production multi-persona** — vLLM multi-LoRA pourrait remplacer N instances Ollama par un seul serveur vLLM avec N adaptateurs. Gain VRAM significatif.

#### Letta — Mémoire persistante pour agents

- **URL :** https://github.com/letta-ai/letta
- **Stars :** 21.6k
- **License :** Apache 2.0
- **Version :** v0.16.6 (mars 2026)
- **Fonctionnalités clés :**
  - Agents stateful avec mémoire persistante qui apprennent et s'améliorent
  - Blocs de mémoire customisables (attributs "human" et "persona")
  - Skills intégrées et sub-agents pour apprentissage continu
  - SDKs Python et TypeScript
- **Pertinence KXKM_Clown :** Le pattern de blocs de mémoire (séparation human/persona) est directement applicable à notre système de personas. Chaque clown pourrait avoir ses propres blocs de mémoire persistante, créant une vraie continuité de personnalité.
- **Recommandation :** **S'inspirer du modèle mémoire** — pattern de memory blocks pour nos personas. Apache 2.0, librement réutilisable.

---

### 4. Training Pipeline / Fine-Tuning — Nouveautés

#### TRL v0.29.0 — OpenEnv, GRPO, CLI

- **URL :** https://github.com/huggingface/trl
- **Stars :** 17.7k
- **Version :** v0.29.0 (fév. 2026)
- **Nouveautés :**
  - **OpenEnv** : intégration du framework Meta pour RL environments dans workflows agentiques
  - **GRPO** (Group Relative Policy Optimization) : alternative à PPO, utilisé pour Llama 3
  - **CLI intégré** : `trl sft`, `trl dpo` — entraînement sans code Python
  - **GRPOTrainer** : nouveau trainer dédié
  - Scaling via Accelerate (single GPU -> multi-node)
  - Support multimodal et multi-architectures
- **Pertinence KXKM_Clown :** Le CLI intégré (`trl dpo --model ... --dataset ...`) simplifie énormément l'intégration avec Node.js via child_process. Plus besoin de scripts Python custom pour lancer un entraînement DPO.
- **Recommandation :** **Utiliser le CLI TRL** pour simplifier le pipeline Node.js -> Python. Un simple `spawn('trl', ['dpo', ...])` suffit.

#### Unsloth — GRPO, Vision RL, contexte 500K

- **URL :** https://github.com/unslothai/unsloth
- **Stars :** 54k
- **Nouveautés 2025-2026 :**
  - **Vision RL (VLM GRPO)** : RL sur modèles vision sur GPU consumer
  - **FP8 quantization + RL** combinés
  - **Contexte 500K tokens** sur GPU 80GB
  - **3x plus rapide** via nouveaux Triton kernels et padding-free packing
  - **MoE** : 12x plus rapide, 35% moins de VRAM pour les modèles MoE
  - **RL 50% moins de VRAM** via batching algorithmique
  - Support : Qwen3.5, GPT-oss, Gemma 3, TTS, embeddings
  - Docker officiel, support AMD, Intel, multi-GPU
- **Pertinence KXKM_Clown :** Le support GRPO + Vision ouvre la possibilité de fine-tuner des modèles multimodaux pour des personas qui comprennent les images. Les kernels Triton améliorent encore les temps d'entraînement sur GPU consumer.
- **Recommandation :** **Continuer à utiliser** — Unsloth reste le meilleur accélérateur pour fine-tuning sur hardware limité.

#### LLaMA-Factory — 68.5k stars, multimodal, optimiseurs avancés

- **URL :** https://github.com/hiyouga/LLaMA-Factory
- **Stars :** 68.5k (hausse depuis 30k+)
- **Nouveautés 2025-2026 :**
  - **Optimiseurs avancés** : Muon (avril 2025), OFT/OFTv2 (août 2025), APOLLO (jan 2025)
  - **Support "Day-N"** pour les nouveaux modèles : Qwen3, DeepSeek-R1, Gemma 3, GLM-4.5, InternLM 3
  - **Backend Megatron-core** via mcore_adapter (oct 2025) pour training distribué
  - **Backend SGLang** pour inférence (mars 2025)
  - **Training multimodal** : audio, vidéo, vision
  - **Quantization étendue** : 2/3/4/5/6/8-bit QLoRA
  - LlamaBoard GUI maintenu (Gradio, zero-code)
- **Pertinence KXKM_Clown :** LlamaBoard reste la meilleure option GUI pour lancer des entraînements sans code. Le support multimodal ouvre la voie à des personas qui traitent images/audio. La croissance explosive (30k -> 68.5k) confirme sa position de référence.
- **Recommandation :** **LlamaBoard comme dashboard de training** intégrable via iframe ou API Gradio dans l'admin panel.

#### NeMo RL — Successeur de NeMo-Aligner

- **URL :** https://github.com/NVIDIA/NeMo-RL
- **Stars :** 1.4k
- **License :** OSS
- **Version :** v0.5.0 (jan 2026)
- **Fonctionnalités clés :**
  - GRPO, GSPO, DAPO, DPO, SFT avec LoRA
  - Distillation on-policy
  - Backends : DTensor (PyTorch-native) et Megatron Core pour training, vLLM et Megatron pour génération
  - Conçu pour scale multi-GPU / multi-node
- **Pertinence KXKM_Clown :** Overkill pour GPU consumer, mais pertinent si on scale. NeMo-Aligner est désormais déprécié (mai 2025), NeMo RL est le successeur officiel.
- **Recommandation :** **Surveiller** — référence NVIDIA pour RLHF à grande échelle.

#### dstack — Orchestration GPU pour training

- **URL :** https://github.com/dstackai/dstack
- **Stars :** 2.1k
- **License :** MPL-2.0
- **Version :** v0.20.13 (mars 2026)
- **Fonctionnalités clés :**
  - Control plane pour provisioning GPU (cloud, Kubernetes, on-prem)
  - Support NVIDIA, AMD, TPU, Intel Gaudi, Tenstorrent
  - Config YAML : fleets, dev environments, tasks, services, volumes
  - Auto-scaling, job queuing, gestion des échecs, port-forwarding
- **Pertinence KXKM_Clown :** Intéressant si on veut lancer des jobs de training sur des GPU cloud à la demande plutôt que sur du hardware local. L'approche YAML est compatible avec notre pattern de config.
- **Recommandation :** **Garder en réserve** — pertinent quand on voudra scaler le training au-delà du GPU local.

---

### 5. DPO/RLHF — Synthèse état de l'art 2026

L'écosystème DPO/RLHF a mûri significativement :

| Outil | Méthodes | GPU consumer | Production | CLI |
|-------|----------|--------------|------------|-----|
| **TRL** v0.29.0 | SFT, DPO, GRPO, PPO | Oui (via PEFT) | Oui (Accelerate) | `trl dpo` |
| **Unsloth** | SFT, DPO, GRPO | Optimisé (2x faster) | Multi-GPU | Via TRL |
| **LLaMA-Factory** | SFT, DPO, PPO, ORPO, KTO | Oui (QLoRA 2-8bit) | Megatron-core | GUI LlamaBoard |
| **Axolotl** | SFT, DPO | Oui | Config YAML | CLI |
| **NeMo RL** | GRPO, DPO, SFT, DAPO | Non (multi-GPU) | Oui | Non |
| **OpenRLHF** | PPO, DPO, DAPO, REINFORCE++ | Non (multi-GPU) | Ray + vLLM | Non |

**Tendances 2025-2026 :**
- **GRPO remplace PPO** — plus stable, moins coûteux, utilisé pour Llama 3 et DeepSeek-R1
- **Vision RL** émerge — Unsloth supporte GRPO sur modèles multimodaux
- **CLI-first** — TRL et Axolotl permettent le fine-tuning sans code Python
- **NeMo-Aligner est mort** — remplacé par NeMo RL (mai 2025)

**Recommandation pipeline KXKM_Clown :** TRL CLI + Unsloth reste la combinaison optimale. Le CLI TRL (`trl dpo`) simplifie l'intégration Node.js. GRPO à explorer comme alternative à DPO pour les cas où on veut du RL reward-based.

---

### 6. React Chat UI — Composants et Références

#### Vercel AI SDK — Hooks React pour chat AI

- **URL :** https://github.com/vercel/ai
- **Stars :** 22.7k
- **License :** OSS
- **Fonctionnalités clés :**
  - Package `@ai-sdk/react` avec hooks pour chatbots et interfaces génératives
  - Provider-agnostic (OpenAI, Anthropic, Google, etc.)
  - Streaming natif, structured data avec validation schema
  - Support agents autonomes avec tools
  - Multi-framework : Next.js, React, Svelte, Vue, Angular
  - Vision capabilities, task management
- **Pertinence KXKM_Clown :** Le hook `useChat()` fournit une base solide pour le frontend React V2. L'approche provider-agnostic est compatible avec notre backend multi-persona. Le streaming natif est essentiel pour l'UX chat.
- **Recommandation :** **Évaluer @ai-sdk/react** pour le frontend V2 — les hooks useChat/useCompletion accélèreraient le développement. Attention : conçu pour un seul agent à la fois, adaptation nécessaire pour multi-persona.

#### chatscope/chat-ui-kit-react — Composants chat React

- **URL :** https://github.com/chatscope/chat-ui-kit-react
- **Stars :** 1.7k
- **License :** MIT
- **Version :** v2.1.1 (mai 2025)
- **Composants :**
  - MainContainer, ChatContainer, MessageList, Message, MessageInput
  - Sticky scrollbars, contentEditable, responsiveness gérés nativement
  - ESM + UMD, TypeScript typings
  - Storybook complet sur chatscope.io
- **Pertinence KXKM_Clown :** Composants de base réutilisables pour le chat. Résout les problèmes classiques (sticky scroll, input contentEditable) sans réinventer la roue. Le MessageList avec auto-scroll est directement utilisable pour l'IRC-style.
- **Recommandation :** **Adopter pour le frontend V2** — gain de temps significatif sur les composants chat de base. MIT, librement intégrable. Customiser le style avec notre CSS retro/IRC.

#### Chatbot UI — Référence Next.js

- **URL :** https://github.com/mckaywrigley/chatbot-ui
- **Stars :** 33.1k
- **License :** MIT
- **Ce que c'est :** App chat Next.js complète avec support multi-modèle (OpenAI, Azure, Ollama), Supabase backend, attachments.
- **Pertinence KXKM_Clown :** Bon modèle architectural pour un frontend React/Next.js. TypeScript (95.7%), structure propre (components, contexts, types). Pas des composants réutilisables, mais une référence d'architecture.
- **Recommandation :** **Étudier l'architecture** — s'inspirer de la structure du code pour notre frontend V2.

---

### Matrice de décision — Lot 11

| Besoin KXKM_Clown | Déjà couvert | Nouveau projet identifié | Action | Priorité |
|--------------------|--------------|--------------------------|--------|----------|
| Multi-agent orchestration | AutoGen (patterns) | **AG-UI** protocole | Évaluer AG-UI pour standardisation messages | Moyenne |
| Stateful agent memory | Letta (concepts) | **Letta** v0.16.6 SDK TypeScript | Intégrer memory blocks pour personas | Moyenne |
| DAG durable execution | Node engine custom | **LangGraph** patterns | S'inspirer de durable execution / resumability | Haute |
| Workflow monitoring UX | Admin panel | **n8n** patterns UX | S'inspirer des patterns opérateur | Basse |
| Multi-LoRA serving | Ollama (1 modèle = 1 instance) | **vLLM** multi-LoRA | Évaluer pour production multi-persona | Haute |
| Training pipeline orchestration | child_process.spawn | **Prefect** + **TRL CLI** | Prefect orchestre, TRL CLI exécute | Moyenne |
| GPU infra scaling | Local only | **dstack** | Garder en réserve pour scale cloud | Basse |
| React chat hooks | — | **Vercel AI SDK** @ai-sdk/react | Évaluer useChat() pour V2 | Haute (V2) |
| React chat components | — | **chatscope/chat-ui-kit-react** | Adopter pour V2 | Haute (V2) |
| DPO method | TRL DPOTrainer | **TRL CLI** `trl dpo` | Simplifier intégration via CLI | Haute |
| GRPO alternative | — | **TRL** GRPOTrainer + **Unsloth** | Explorer comme alternative DPO | Basse |

### Points saillants — Lot 11

1. **vLLM multi-LoRA est un game-changer** — servir N adaptateurs LoRA (un par persona) sur un seul modèle de base, au lieu de N instances Ollama. Gain VRAM majeur pour production multi-persona. A évaluer en priorité.

2. **AG-UI émerge comme standard** (12.5k stars en peu de temps) — protocole event-based agent-to-UI qui pourrait devenir le standard pour les interfaces chat avec agents. Compatible avec notre WebSocket. A surveiller.

3. **TRL CLI simplifie le pipeline** — `trl dpo --model X --dataset Y` élimine le besoin de scripts Python custom. Intégration Node.js via child_process beaucoup plus simple.

4. **LangGraph durable execution** — pattern de resumability après échec pertinent pour les pipelines de training longs. A intégrer dans notre node engine.

5. **chatscope/chat-ui-kit-react** — composants chat React MIT prêts à l'emploi. Sticky scroll, message list, input gérés. Base solide pour le frontend V2, customisable avec CSS retro.

6. **Unsloth + GRPO + Vision** — le fine-tuning multimodal sur GPU consumer est maintenant possible. Ouvre la voie à des personas qui comprennent les images.

7. **Prefect pour orchestration training** — plus robuste que child_process pour les pipelines de production. DAG natif, retry, monitoring, scheduling.

8. **NeMo-Aligner est mort, NeMo RL est le successeur** — à noter pour la veille NVIDIA.

9. **Open WebUI à 127k stars** — l'écosystème Ollama explose. Le Pipelines Plugin Framework est un pattern d'extension intéressant.

10. **Ollama à 165k stars** — confirme massivement notre choix de backend d'inférence.

### Licence — Nouveaux projets

| Projet | License | Réutilisation libre ? |
|--------|---------|----------------------|
| AG-UI | MIT | Oui |
| LangGraph | MIT | Oui |
| Haystack | Apache 2.0 | Oui |
| Prefect | Apache 2.0 | Oui |
| vLLM | Apache 2.0 | Oui |
| Letta | Apache 2.0 | Oui |
| chatscope | MIT | Oui |
| Chatbot UI | MIT | Oui |
| Vercel AI SDK | OSS | Oui |
| llamafile | Apache 2.0 | Oui |
| dstack | MPL-2.0 | Oui (copyleft faible) |
| NeMo RL | OSS | Oui |
| n8n | Sustainable Use | Étude OK, restrictions commerciales |
| AutoGPT (new) | Polyform Shield | Non (étude seulement) |
| ComfyUI | GPL-3.0 | Copyleft (étude seulement) |
| Open WebUI | Open WebUI License | Non (branding restrictions) |

*Veille Lot 11 effectuée le 2026-03-16.*

---

## 2026-03-16 — Veille testing, CI/CD, monorepo tooling

### 1. Testing frameworks pour APIs Node.js

#### node:test (built-in test runner)

- **URL:** https://nodejs.org/api/test.html
- **Intégré dans:** Node.js v18.0.0+ (stable depuis v20.0.0)
- **Stars (Node.js):** ~116k
- **Licence:** MIT
- **Fonctionnalités clés:**
  - APIs familières : `test()`, `describe()`, `it()`, `suite()`
  - Hooks : `before()`, `after()`, `beforeEach()`, `afterEach()`
  - Mocking complet : fonctions, méthodes, timers, dates, modules
  - Code coverage V8 intégré (`--experimental-test-coverage`)
  - Watch mode (`--test --watch`)
  - Snapshot testing (stable depuis v22.3.0)
  - Reporters multiples : TAP, Spec, Dot, jUnit, LCOV
  - Filtrage par pattern : `--test-name-pattern`, `--test-skip-pattern`
  - API programmatique via `run()` pour intégration custom
  - Global setup/teardown (v24.0.0+)
  - Exécution directe : `node --test`
- **Verdict pour KXKM_Clown:** Choix idéal pour les smoke tests et tests d'intégration du backend. Zéro dépendance externe, supporte async/await nativement, coverage intégrée. Suffisant pour tester les routes Express + WebSocket sans ajouter Jest ou Vitest côté serveur.

#### Supertest

- **URL:** https://github.com/ladjs/supertest
- **Stars:** ~14.3k
- **Licence:** MIT
- **Fonctionnalités clés:**
  - Abstraction haut-niveau pour tester les APIs HTTP
  - Accepte un `http.Server` ou une app Express directement
  - Bind automatique sur port éphémère (pas de conflit de port)
  - API fluide : `.get()`, `.post()`, `.expect()`, `.end()`
  - Support HTTP/2 via `{ http2: true }`
  - Styles multiples : callbacks, promises, async/await
  - `request.agent()` pour maintenir les sessions/cookies entre requêtes
  - Support multipart/upload de fichiers
- **Patterns recommandés:**
  - Les assertions s'exécutent dans l'ordre de définition
  - Avec `.end()`, les erreurs passent par callback (pas de throw)
  - Agent réutilisable pour tester les workflows d'authentification
- **Verdict pour KXKM_Clown:** Compagnon parfait de `node:test` pour tester les routes Express de `http-api.js`. Combinaison `node:test` + `supertest` = stack de test backend complète sans framework lourd.

#### Vitest

- **URL:** https://github.com/vitest-dev/vitest
- **Stars:** ~16.1k
- **Licence:** MIT
- **Version:** v4.1.0 (12 mars 2026)
- **Prérequis:** Vite >= 6.0.0, Node >= 20.0.0
- **Fonctionnalités clés:**
  - Utilise la config, transformers, resolvers et plugins de Vite
  - API compatible Jest (migration facile)
  - Snapshot testing intégré
  - Assertions Chai built-in
  - Watch mode instantané (HMR-like)
  - Code coverage native (v8 ou Istanbul)
  - Browser Mode pour tests de composants React dans un vrai navigateur
  - Support React, Vue, Svelte, Lit, Marko
- **Verdict pour KXKM_Clown:** Réservé au frontend V2 React. Pour le backend Node.js pur, `node:test` + `supertest` est plus léger et sans dépendance Vite.

#### Best practices : tester Express sans framework externe

```
// Avec node:test + supertest uniquement :
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server.js';

describe('API /api/personas', () => {
  let app;
  before(() => { app = createApp(); });

  it('GET /api/personas returns 200', async () => {
    const res = await request(app).get('/api/personas');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body));
  });
});
```

- Pas besoin de Jest, Mocha, ou Vitest côté serveur
- `node --test --experimental-test-coverage` pour la couverture
- `node --test --watch` pour le développement

---

### 2. WebSocket testing tools

#### ws (WebSocket library)

- **URL:** https://github.com/websockets/ws
- **Stars:** ~22.7k
- **Licence:** MIT
- **Fonctionnalités clés:**
  - Implémentation WebSocket client + serveur pour Node.js
  - Passe la suite de tests Autobahn complète
  - Support compression permessage-deflate
  - Fonctionne avec serveurs HTTP/HTTPS
  - Modules optionnels de performance (bufferutil, utf-8-validate)

#### Patterns de test WebSocket avec node:test + ws

```
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server.js';

describe('WebSocket chat', () => {
  let server, port;

  before((_, done) => {
    server = createServer();
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  after((_, done) => { server.close(done); });

  it('connects and receives welcome', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const msg = await new Promise((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data)));
    });
    assert.strictEqual(msg.type, 'welcome');
    ws.close();
  });
});
```

- **Pas de bibliothèque de test WS spécifique nécessaire** — le client `ws` lui-même suffit pour écrire les tests
- Créer le serveur sur port 0 (éphémère) pour éviter les conflits
- Utiliser des Promises pour wrapper les événements WS dans des tests async
- Tester : connexion, envoi/réception de messages, déconnexion, reconnexion, broadcast

---

### 3. React testing (frontend V2)

#### React Testing Library

- **URL:** https://github.com/testing-library/react-testing-library
- **Stars:** ~19.6k
- **Licence:** MIT
- **Version:** v13+ (requiert React 18)
- **Fonctionnalités clés:**
  - Utilitaires légers au-dessus de `react-dom` et `react-dom/test-utils`
  - Philosophie : "Plus vos tests ressemblent à la façon dont votre logiciel est utilisé, plus ils vous donnent confiance"
  - Queries par rôle/label plutôt que par implémentation
  - Simulation d'événements via `fireEvent`
  - Détection async via `screen.findBy*`
  - Matchers custom via `@testing-library/jest-dom`
  - Framework-agnostic (fonctionne avec Jest, Vitest, etc.)
- **Ordre de préférence des queries:**
  1. `screen.getByRole()` (accessible)
  2. `screen.getByLabelText()` (formulaires)
  3. `screen.getByText()` (contenu visible)
  4. `screen.getByTestId()` (dernier recours)

#### Stack recommandée pour le frontend V2

| Outil | Rôle |
|-------|------|
| **Vitest** | Test runner (intégré à Vite) |
| **React Testing Library** | Rendu + queries de composants |
| **@testing-library/jest-dom** | Matchers DOM étendus |
| **@testing-library/user-event** | Simulation d'interactions utilisateur réalistes |
| **jsdom** (via Vitest) | Environnement DOM pour tests unitaires |
| **Vitest Browser Mode** | Tests de composants dans un vrai navigateur (Playwright/WebDriverIO) |

#### Exemple Vitest + React Testing Library

```
// composant.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import ChatInput from './ChatInput';

test('envoie un message au submit', async () => {
  const onSend = vi.fn();
  render(<ChatInput onSend={onSend} />);

  await userEvent.type(screen.getByRole('textbox'), 'Hello');
  await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

  expect(onSend).toHaveBeenCalledWith('Hello');
});
```

---

### 4. CI/CD pour monorepo

#### Changesets

- **URL:** https://github.com/changesets/changesets
- **Stars:** ~11.5k
- **Licence:** MIT
- **Version:** @changesets/cli@2.30.0 (3 mars 2026)
- **Fonctionnalités clés:**
  - Gestion de versioning et changelogs pour multi-package repos
  - Déclaration d'intent de release avec type de bump semver
  - Mise à jour automatique des versions, changelogs, et dépendances internes
  - Aplatit plusieurs changesets en une seule release par package
  - Intégration CI/CD :
    - Validation PR : bot changeset ou `yarn changeset status`
    - Publication automatisée : GitHub Action dédiée pour version PRs + publish
- **Verdict pour KXKM_Clown:** Utile si le monorepo publie des packages npm séparés. Pour un projet déployé comme une unité, c'est overkill. A considérer quand `packages/` contiendra des modules réutilisables.

#### Turborepo

- **URL:** https://github.com/vercel/turborepo
- **Stars:** ~30k
- **Licence:** MIT
- **Version:** v2.8.17 (13 mars 2026)
- **Fonctionnalités clés:**
  - Build system haute performance pour codebases JS/TS, écrit en Rust
  - Cache intelligent : ne re-build que ce qui a changé
  - Remote caching : partage du cache entre CI et développeurs
  - Task pipelines : définition déclarative des dépendances entre tâches
  - Exécution parallèle maximale
  - Pruned subsets : `turbo prune` pour isoler un workspace et ses dépendances
  - Compatible npm, yarn, pnpm workspaces
- **Verdict pour KXKM_Clown:** Excellent choix pour orchestrer build, test, lint sur `apps/`, `packages/`, `ops/`. Le cache Rust accélère significativement les CI. Recommandé pour structurer le `turbo.json` avec les pipelines de build du monorepo V2.

#### GitHub Actions — patterns monorepo

| Pattern | Description |
|---------|-------------|
| **Path filters** | `on.push.paths: ['apps/frontend/**']` pour ne déclencher que les jobs affectés |
| **Matrix strategy** | `matrix.package: [frontend, backend, ops-tui]` pour tester chaque package en parallèle |
| **Turborepo cache** | `actions/cache` sur `.turbo/` + remote cache Vercel pour partager entre runs |
| **Changesets action** | `changesets/action@v1` pour automatiser les PRs de version |
| **Concurrency groups** | `concurrency: { group: ${{ github.ref }} }` pour annuler les runs obsolètes |

#### Exemple workflow GitHub Actions

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npx turbo run lint test build --cache-dir=.turbo
```

---

### 5. Synthèse et recommandations pour KXKM_Clown

#### Stack de test recommandée

| Couche | Outil | Justification |
|--------|-------|---------------|
| **Backend smoke tests** | `node:test` + `supertest` | Zéro dépendance framework, intégré à Node.js |
| **Backend WS tests** | `node:test` + `ws` client | Le client ws suffit pour tester les connexions |
| **Frontend unit tests** | `Vitest` + `React Testing Library` | Intégration native avec Vite, API Jest-compatible |
| **Frontend component tests** | `Vitest Browser Mode` + Playwright | Tests dans un vrai navigateur |
| **Monorepo orchestration** | `Turborepo` | Cache Rust, pipelines déclaratives, pruning |
| **CI/CD** | GitHub Actions + Turborepo cache | Path filters + parallélisme + cache partagé |
| **Versioning** (optionnel) | `Changesets` | Quand les packages seront publiés séparément |

#### Priorité d'implémentation

1. **Immédiat :** `node:test` + `supertest` pour les smoke tests existants (`scripts/smoke.js`)
2. **Court terme :** Tests WebSocket avec `ws` client dans `node:test`
3. **Avec V2 frontend :** `Vitest` + `React Testing Library`
4. **Avec monorepo mature :** `Turborepo` + GitHub Actions pipeline

*Recherche effectuée le 2026-03-16.*

## Addendum 2026-03-17 — Deep veille OSS actionnable

### Projets analyses (web)

| Projet | Positionnement | Ce qui est reutilisable pour KXKM | Priorite |
|---|---|---|---|
| Open WebUI | plateforme self-hosted Ollama/OpenAI avec RBAC et RAG | patterns d'integration Ollama, RAG docs + web search, options de deploiement | Haute |
| LibreChat | chat multi-providers avec agents, MCP, multi-user auth | patterns MCP/tooling, resumable streams, UX de switch provider | Haute |
| LangGraph | orchestration d'agents stateful longue duree | modelisation workflow agentique et sous-graphes pour Node Engine | Moyenne |
| SearXNG | metasearch self-hosted privacy-first | remplacement DuckDuckGo lite pour `/web` en mode souverain | Haute |
| Docling | extraction documentaire multi-format + MCP server | remplacement progressif de `pdf-parse`, pipeline document richer | Haute |

### Decisions proposees
1. Integrer `SearXNG` dans docker compose V2 et basculer `/web` dessus par defaut.
2. Ajouter une option Docling dans pipeline document pour PDF/Docx/HTML.
3. S'inspirer de LibreChat pour la reprise de stream et la robustesse multi-session.
4. Evaluer LangGraph comme reference conceptuelle, sans couplage direct au runtime actuel.

### Risques et garde-fous
- Licences: verifier contraintes de redistribution pour chaque composant non MIT.
- Complexite ops: activer chaque brique derriere feature flags.
- Stabilite: pas d'integration en masse sans smoke tests dedies.