# openDAW Research Notes — 2026-03-21

Reference: https://github.com/andremichelle/openDAW

## Project Overview

- **Author**: Andre Michelle (creator of Audiotool)
- **Stars**: ~1360, 98 forks, very active (last update: 2026-03-21)
- **Language**: TypeScript (100%)
- **License**: AGPL v3 (README) / LGPL-3.0-or-later (SDK packages)
- **Node**: >= 23 required
- **Build**: Turborepo + Lerna monorepo, Vite, Sass, Vitest

## Architecture — Key Patterns

### Monorepo Structure (packages/)

```
packages/
  app/
    studio/        — Main DAW web app (Vite + custom JSX)
    lab/           — Audio experiments/playground
    nam-test/      — Neural amp modeling test
  lib/
    box/           — Reactive data model (graph, pointers, sync, serialization)
    box-forge/     — Schema-based box code generation
    dsp/           — Pure DSP library (FFT, biquad, ADSR, convolver, resampler, tempo, PPQN...)
    fusion/        — Live-stream reactive system (flags, streams)
    dom/           — DOM utilities
    jsx/           — Custom JSX runtime (no React, no framework)
    midi/          — MIDI parsing/generation
    runtime/       — Runtime utilities
    std/           — Standard library (collections, math, etc.)
    xml/           — XML parser (for DAWproject import/export)
    dawproject/    — DAWproject format import/export
  studio/
    core/          — Engine: AudioWorklet processors, offline engine, FFmpeg workers
    core-processors/ — AudioWorklet processor implementations
    core-workers/  — Web Worker implementations
    adapters/      — Box-to-engine adapter layer (device adapters, parameter adapters)
    boxes/         — Data model definitions (box schemas for all studio entities)
    enums/         — Shared enumerations
    forge-boxes/   — Generated box code from schemas
    sdk/           — Public SDK for external use
    scripting/     — User scripting support
  server/
    yjs-server/    — Y.js WebSocket server for real-time collaboration
  config/
    eslint/, typescript/ — Shared configs
```

### Audio Engine

- **Web Audio API** with **AudioWorklet** processors (not ScriptProcessorNode)
- Custom DSP in `@opendaw/lib-dsp`: FFT, biquad filters, convolver, resampler, ADSR, LFO, waveshaper, noise, limiter, compressor (CTAGDRC port), delay, reverb (Dattorro)
- Offline rendering engine (`offline-engine.js`) for bouncing/export
- FFmpeg WASM for audio decoding/encoding
- Neural Amp Modeling via `@opendaw/nam-wasm`
- PPQN-based timing (pulses per quarter note) for precise MIDI/audio scheduling
- Tempo automation via `VaryingTempoMap` and `ConstantTempoMap`

### Multi-Track Timeline

- **Box model**: All project data stored in a reactive graph (`@opendaw/lib-box`). Boxes are typed nodes with fields, pointers, and graph edges.
- **Adapters layer**: `@opendaw/studio-adapters` maps box data to engine state. Each device/track has a BoxAdapter that manages its lifecycle and parameter sync.
- Key adapters: `AudioUnitBoxAdapter`, `AudioBusBoxAdapter`, `AudioUnitTracks`, `ClipSequencing`, `ClipNotifications`
- Audio regions with pitch/time-stretch, warp markers, transient detection
- Recording support with loop takes
- Automation tracks (tempo, signature, parameters)
- Clip-based sequencing on timeline

### UI Framework

- **Custom JSX runtime** (`@opendaw/lib-jsx`) — no React, no Vue, no framework
- Depends only on `@opendaw/lib-dom` and `@opendaw/lib-std`
- Sass for styling
- Vite for dev/build
- Zero framework dependencies — radical minimalism

### Collaboration

- **Y.js** for CRDT-based real-time sync
- `y-websocket` for transport
- Box model has `sync-source.ts` / `sync-target.ts` for Y.js integration
- Dropbox SDK for cloud storage

### External Dependencies (minimal)

- jszip (project bundles)
- markdown-it (help pages)
- d3-force (graph debug viz)
- soundfont2 (SoundFont loading)
- zod (schema validation)
- ffmpeg.wasm (audio codec)
- yjs + y-websocket (collab)
- dropbox SDK (cloud storage)

## Stock Plugins/Devices

**Instruments**: Vaporisateur (subtractive synth), Playfield (drum machine), Nano (sampler), Tape (audio regions), Soundfont player, MIDI Output, Apparat
**Audio FX**: Stereo Tool, Delay, Crusher, Reverb (Cheap + Dattorro), Revamp (EQ+spectrum), Fold (waveshaper), Tidal (rhythm shaper), Compressor (CTAGDRC), Gate, Maximizer, Neural Amp, Werkstatt
**MIDI FX**: Arpeggio, Pitch, Velocity, Zeitgeist (time transform)

## License Analysis

- **AGPL v3** on the repository overall
- **LGPL-3.0-or-later** on SDK/library packages (dsp, box, fusion, jsx, etc.)
- Ported plugins excluded from commercial license
- **For kxkm_clown**: We CANNOT copy code (AGPL copyleft). We CAN study architecture patterns, naming conventions, and DSP algorithms as reference. LGPL libs could theoretically be used as dependencies if we comply with LGPL terms, but safer to just reference patterns.

## Patterns Applicable to kxkm_clown DAW

### 1. Reactive Box Model (data layer)
The `box` library is a typed reactive graph for all project data. Each entity is a "box" with typed fields, pointers to other boxes, and graph edges. This is similar to an ECS but graph-oriented. We could adopt a similar pattern with our own implementation for the DAW project state.

### 2. Adapter Pattern (data <-> engine bridge)
BoxAdapters bridge the data model to the audio engine. Each device/track type has its own adapter. This clean separation means the data model is independent of the audio engine. Worth replicating.

### 3. Custom JSX without React
Their `lib-jsx` proves you can build a DAW UI with a minimal custom JSX runtime. For our Minitel-themed TUI/web hybrid, this validates avoiding heavy frameworks.

### 4. DSP as Pure Library
`lib-dsp` is framework-agnostic pure TypeScript DSP. We could build our own equivalent or reference their implementations for filters, FFT, ADSR, etc.

### 5. AudioWorklet-First Architecture
All audio processing runs in AudioWorklet processors, not on the main thread. Essential for low-latency DAW work. Our DAW should follow the same pattern.

### 6. PPQN Timing
PPQN-based scheduling is the standard for precise musical timing. Their implementation in `lib-dsp/ppqn.ts` and tempo maps is a good reference.

### 7. Monorepo with Clean Package Boundaries
Turborepo + npm workspaces with clear package boundaries (lib/ vs studio/ vs app/). Good model for our own package structure.

### 8. DAWproject Import/Export
They implement the open DAWproject format for interop with other DAWs. Worth considering for our export pipeline.

## Roadmap Insights

- 2026/Q3 target for 1.0 launch
- Future: modular synth system, more synths/effects
- Active areas needing help: Y.js collab, Tauri desktop wrapper, PWA, timeline track management

## Sources

- [GitHub repo](https://github.com/andremichelle/openDAW)
- [openDAW headless SDK](https://github.com/andremichelle/opendaw-headless)
- [VJ Union article](https://vjun.io/vdmo/opendaw-theres-a-new-free-daw-in-town-31k4)
- [Polarity Music / Patreon](https://www.patreon.com/posts/introducing-121729983)
- [Gearspace discussion](https://gearspace.com/board/new-products-coming-soon/1442716-opendaw-new-open-source-daw.html)
