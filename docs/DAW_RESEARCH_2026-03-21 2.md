# DAW & Audio Editing — Web OSS Research

> Date: 2026-03-21
> Context: Improve kxkm_clown Compose page (currently single-track generation + `<audio>` playback)
> Goal: Multi-track timeline, waveform display, mix with offsets, export

---

## 1. Full Web-Based DAWs (Open Source)

### openDAW
- **URL:** https://github.com/andremichelle/openDAW
- **Stars:** ~1.4k
- **License:** AGPL v3 / commercial dual
- **Stack:** TypeScript, Turbo monorepo, ffmpeg.wasm, Sass
- **Key features:** 18+ built-in audio devices (synths, drum machine, effects), AI stem splitting, no signup/tracking/ads philosophy
- **Relevance:** HIGH — same monorepo architecture as kxkm_clown (Turbo). The ffmpeg.wasm integration is directly relevant for server-side-free audio mixing. AGPL license is compatible with our stack but would require careful isolation if we borrow code.
- **Integration recommendation:** Study their audio routing graph and ffmpeg.wasm export pipeline. Do NOT embed the full DAW — too heavy and AGPL-viral. Cherry-pick patterns for track scheduling and canvas waveform rendering.

### GridSound
- **URL:** https://github.com/gridsound/daw
- **Stars:** ~1.8k
- **License:** AGPL-3.0
- **Stack:** Vanilla JS, CSS, HTML5, Web Audio API
- **Key features:** Browser DAW with synths, drum machine, LFO, cloud save, service worker offline
- **Relevance:** MEDIUM — good reference architecture for a timeline UI grid, but vanilla JS (no React) and AGPL make direct reuse impractical.
- **Integration recommendation:** Use as visual/UX reference only. Their grid-based timeline layout is a solid design pattern for our Compose page multi-track view.

---

## 2. Waveform Display Libraries

### wavesurfer.js
- **URL:** https://github.com/katspaugh/wavesurfer.js
- **Stars:** ~10.2k
- **License:** BSD-3-Clause
- **Stack:** TypeScript, Web Audio API, Shadow DOM
- **Key features:** Interactive waveform rendering, official React wrapper (`@wavesurfer/react`), plugins (Regions, Timeline, Minimap, Envelope, Spectrogram, Record), pre-decoded peaks support
- **Latest:** v7.12.4 (March 2026), very actively maintained, used by 15.6k projects
- **Relevance:** VERY HIGH — most popular, most maintained, BSD license, official React hooks, plugin ecosystem covers all our needs (timeline ruler, regions for clips, minimap for overview).
- **Integration recommendation:** PRIMARY CHOICE for waveform display. Use `@wavesurfer/react` with Timeline plugin for the ruler and Regions plugin for clip boundaries. One wavesurfer instance per track in the multi-track view. Lightweight enough to instantiate 5-10 instances on a page.

### peaks.js (BBC)
- **URL:** https://github.com/bbc/peaks.js (moved to https://codeberg.org/chrisn/peaks.js)
- **Stars:** ~3.4k
- **License:** LGPL-2.0
- **Stack:** JavaScript, HTML Canvas, Konva.js dependency, waveform-data.js
- **Key features:** Zoom/scroll waveform, point/segment markers, multi-channel, pre-computed waveform data (server-side via `audiowaveform` CLI), keyboard/mouse/touch interaction
- **Relevance:** HIGH — BBC-grade, designed for long-form audio editing (radio), excellent marker/segment system. Heavier than wavesurfer due to Konva dependency. Pre-computed waveform data is great for large files.
- **Integration recommendation:** ALTERNATIVE to wavesurfer if we need server-side waveform pre-computation (useful for long 120s generated tracks). The `audiowaveform` CLI tool could run on kxkm-ai server post-generation to create waveform data files, avoiding client-side decoding. Consider if performance becomes an issue with wavesurfer on mobile.

---

## 3. Web Audio Frameworks

### Tone.js
- **URL:** https://github.com/Tonejs/Tone.js
- **Stars:** ~14.7k
- **License:** MIT
- **Stack:** TypeScript, Web Audio API
- **Key features:** Global Transport (like a DAW arrangement view), sample-accurate scheduling, synths, effects, signal automation, time notation ("4n", "8t", "1m"), loop/sequence/part abstractions
- **Relevance:** VERY HIGH — the de facto standard for Web Audio scheduling. The Transport abstraction is exactly what we need for multi-track playback with offsets. MIT license, massive community.
- **Integration recommendation:** USE as the audio engine layer. `Tone.Transport` manages master timeline. Each generated track becomes a `Tone.Player` with a `.start(offset)` call to position it on the timeline. Effects (reverb, EQ) can be applied per-track via Tone's effect chain. Already a peer dependency of waveform-playlist.

### Reactronica
- **URL:** https://reactronica.com/
- **Stars:** ~800 (est.)
- **License:** MIT
- **Stack:** React, Tone.js wrapper
- **Key features:** Declarative React components for audio (`<Song>`, `<Track>`, `<Instrument>`, `<Effect>`), built on Tone.js
- **Relevance:** MEDIUM — nice declarative API but focused on MIDI/synth composition, not audio file playback and mixing. May be too opinionated for our use case.
- **Integration recommendation:** Reference for API design inspiration (declarative audio in React), but use Tone.js directly for more control over audio file scheduling.

---

## 4. Multi-Track Editors (Ready-Made)

### waveform-playlist
- **URL:** https://github.com/naomiaro/waveform-playlist
- **Stars:** ~1.6k
- **License:** MIT
- **Stack:** React, TypeScript, Tone.js, @dnd-kit, Canvas, Web Audio API
- **Key features:** Multi-track drag-to-move and trim, canvas waveform rendering with zoom, 20+ audio effects (reverb, delay, filters), AudioWorklet recording, WAV export with effects, time-synced annotations, MIDI piano roll, dark/light themes
- **Latest:** v10.2.0 (March 2026), actively maintained, modular monorepo (7 core + 6 optional packages)
- **Relevance:** EXTREMELY HIGH — this is essentially what we want to build. React + Tone.js + Canvas waveforms + drag-and-drop + WAV export. MIT license. Same tech stack as kxkm_clown.
- **Integration recommendation:** STRONGEST CANDIDATE for direct integration. Install `waveform-playlist` as a dependency and wrap it in our Minitel-themed ComposePage. The modular package structure means we can import only what we need (core + effects + export). This would give us: multi-track timeline, drag clips with offsets, per-track effects, and WAV mix export — all out of the box. Customize the CSS to match our phosphor/VIDEOTEX aesthetic.

### react-video-editor-timeline
- **URL:** https://github.com/akshay-092/react-video-editor-timeline
- **Stars:** ~50 (est.)
- **License:** Unknown
- **Key features:** Customizable timeline component for video/audio, playback control
- **Relevance:** LOW — video-focused, small community, unclear maintenance.

### react-audio-timeline
- **URL:** https://github.com/uetchy/react-audio-timeline
- **Stars:** 1
- **License:** MIT
- **Key features:** React Hooks + Web Audio API
- **Relevance:** VERY LOW — essentially abandoned, 1 star.

---

## 5. Server-Side Mixing (ffmpeg)

### ffmpeg adelay + amix pattern
- **Key technique:** Apply `adelay` filter per input to set time offset, then `amix` to combine
- **Syntax:**
```bash
ffmpeg -i track1.wav -i track2.wav -i track3.wav \
  -filter_complex \
  "[0]adelay=0|0[a0]; \
   [1]adelay=5000|5000[a1]; \
   [2]adelay=12000|12000[a2]; \
   [a0][a1][a2]amix=inputs=3:duration=longest" \
  output.wav
```
- **Delay values:** milliseconds, pipe-separated for L|R channels
- **Volume control:** Add `volume` filter before amix: `[0]adelay=0|0,volume=0.8[a0]`
- **Gotcha:** Use `asetpts=PTS-STARTPTS` after `adelay` if sync drifts
- **Relevance:** VERY HIGH — this is how we export the final mix server-side. The API already has access to generated WAV files in `data/audio/`. A `/compose/mix` endpoint could accept track IDs + offsets and run this ffmpeg command.
- **Integration recommendation:** Add a `mixTracks()` function in the API that takes `Array<{trackId, offsetMs, volume}>`, resolves WAV paths from media-store, builds the ffmpeg filter_complex string, and returns the mixed WAV. Use either ffmpeg CLI (already likely available on kxkm-ai) or ffmpeg.wasm for client-side preview mixing.

**Sources:**
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html)
- [adelay + amix example](https://gist.github.com/adrienjoly/e5b2db9c9a61f454ed08f56c32999f17)
- [VideoHelp Forum: merge with time offset](https://forum.videohelp.com/threads/387710-how-to-merge-multiple-audio-with-time-offset-to-one-audio-file)

---

## 6. Web Audio API Architecture Notes

### AudioWorklet for performance
- Custom DSP runs in a dedicated real-time audio thread (not main thread)
- WebAssembly in AudioWorklet eliminates GC pauses — critical for glitch-free playback
- All major browsers support AudioWorklet since 2022

### Web Audio Modules (WAM) 2.0
- **URL:** https://www.webaudiomodules.com/
- Plugin standard for Web Audio (like VST for browsers)
- Enables DAW <-> plugin communication in the audio thread
- Relevance: LOW for now (we don't need plugins), but interesting for future if we add real-time effects UI

### Performance tips
- Use typed arrays (Float32Array), reuse buffers
- Keep audio thread code monomorphic (no polymorphic dispatch)
- Pre-decode audio files with `decodeAudioData()` before playback
- For waveform display: compute peaks server-side if files are large

**Source:** [HdM Stuttgart — Web Audio API Performance Tips](https://blog.mi.hdm-stuttgart.de/index.php/2021/02/24/web-audio-api-tips-for-performance/)

---

## 7. Commercial Web DAW Reference

### BandLab
- Cloud-based social music platform, acquired Cakewalk
- "Pass the ball" collaboration model (not simultaneous editing)
- Tight integration with hardware audio interfaces
- Relevance: Their UX for simple music creation (non-pro users) is a good reference for our target audience (artists/performers, not audio engineers)

### Soundtrap (Spotify)
- Freemium, runs on Chromebooks to Mac Pro
- Real-time simultaneous collaboration
- Built-in Antares Auto-Tune
- Relevance: Their simple, responsive interface philosophy matches our Minitel aesthetic goal — keep it minimal

**Source:** [macprovideo — Top 4 Browser Based DAWs](https://macprovideo.com/article/audio-software/the-top-4-browser-based-daws)

---

## 8. Recommended Architecture for kxkm_clown Compose v2

### Option A: waveform-playlist integration (recommended)
```
┌─────────────────────────────────────────────────────┐
│ ComposePage.tsx (Minitel theme)                      │
│ ┌─────────────────────────────────────────────────┐ │
│ │ waveform-playlist (React)                       │ │
│ │  ├─ Track 1: [====ambient drone========]        │ │
│ │  ├─ Track 2:      [===bass pulse===]            │ │
│ │  ├─ Track 3:           [==vocal chop==]         │ │
│ │  └─ Timeline ruler (seconds)                    │ │
│ └─────────────────────────────────────────────────┘ │
│ [Generate] [Add to timeline] [Mix & Export]         │
└─────────────────────────────────────────────────────┘
         │                              │
         │ WS /compose                  │ POST /compose/mix
         ▼                              ▼
    ws-commands.ts               mix-endpoint.ts
    (existing)                   (new: ffmpeg adelay+amix)
```

**Pros:** Out-of-the-box multi-track, drag, trim, effects, export. MIT license. Same stack (React + Tone.js). Active maintenance.
**Cons:** CSS customization needed for Minitel theme. Bundle size (~200KB gzipped est.).
**Effort:** ~3-5 lots

### Option B: Custom build with wavesurfer.js + Tone.js
```
wavesurfer.js   → waveform display per track (BSD-3)
Tone.js         → audio scheduling + effects (MIT)
Custom React    → timeline grid, drag/drop, transport controls
ffmpeg (server) → final mix export
```

**Pros:** Full control, lighter bundle, exact Minitel aesthetic.
**Cons:** Significantly more code to write (drag, trim, zoom, export).
**Effort:** ~8-12 lots

### Recommendation

**Go with Option A (waveform-playlist)** for the initial multi-track Compose v2. It covers 90% of needs out of the box. Layer the Minitel CSS on top. Add the server-side ffmpeg mix endpoint for final WAV export. If waveform-playlist proves too rigid or heavy, fall back to Option B using wavesurfer.js + Tone.js as building blocks.

### Immediate next steps
1. `npm i waveform-playlist tone @dnd-kit/react` in apps/web
2. Prototype a `<MultiTrackCompose>` component wrapping waveform-playlist
3. Add `POST /api/compose/mix` endpoint with ffmpeg adelay+amix
4. Theme the waveform-playlist CSS to match Minitel phosphor aesthetic
5. Wire generated tracks from existing `/compose` flow into the timeline

---

## Sources

- [openDAW](https://github.com/andremichelle/openDAW)
- [GridSound](https://github.com/gridsound/daw)
- [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) — [React wrapper](https://www.npmjs.com/package/@wavesurfer/react)
- [peaks.js (BBC)](https://github.com/bbc/peaks.js)
- [Tone.js](https://github.com/Tonejs/Tone.js)
- [Reactronica](https://reactronica.com/)
- [waveform-playlist](https://github.com/naomiaro/waveform-playlist) — [Demo](https://naomiaro.github.io/waveform-playlist/)
- [react-video-editor-timeline](https://github.com/akshay-092/react-video-editor-timeline)
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html)
- [ffmpeg adelay gist](https://gist.github.com/adrienjoly/e5b2db9c9a61f454ed08f56c32999f17)
- [Web Audio API Performance Tips](https://blog.mi.hdm-stuttgart.de/index.php/2021/02/24/web-audio-api-tips-for-performance/)
- [Web Audio Modules 2.0](https://www.webaudiomodules.com/)
- [MDN Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MDN AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [WAM-studio paper (INRIA)](https://inria.hal.science/hal-04335612/file/3587987_authorVersion.pdf)
- [macprovideo — Browser DAWs](https://macprovideo.com/article/audio-software/the-top-4-browser-based-daws)
