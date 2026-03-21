import { useState, useCallback } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

const AI_BRIDGE = "/api/v2/ai-bridge";

interface GeneratedTrack {
  id: string;
  type: "music" | "voice" | "noise";
  prompt: string;
  blobUrl: string;
  duration: number;
  createdAt: number;
}

type GenStatus = "idle" | "generating" | "error";

export default function DawAIPanel() {
  const [tracks, setTracks] = useState<GeneratedTrack[]>([]);
  const [status, setStatus] = useState<GenStatus>("idle");
  const [error, setError] = useState("");

  // Music generation
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicDuration, setMusicDuration] = useState(30);
  const [musicStyle, setMusicStyle] = useState("experimental");

  // Voice generation
  const [voiceText, setVoiceText] = useState("");
  const [voicePersona, setVoicePersona] = useState("pharmacius");

  // Noise generation
  const [noiseType, setNoiseType] = useState("pink");
  const [noiseDuration, setNoiseDuration] = useState(10);

  const PERSONAS = [
    "pharmacius", "schaeffer", "merzbow", "cage", "radigue",
    "sunra", "haraway", "batty", "deleuze", "turing",
  ];
  const NOISE_TYPES = ["white", "pink", "brown", "sine", "drone"];
  const STYLES = ["experimental", "ambient", "electronic", "classical", "jazz", "industrial", "drone", "glitch"];

  const generateTrack = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>,
    type: "music" | "voice" | "noise",
    prompt: string,
    duration: number,
  ) => {
    setStatus("generating");
    setError("");
    try {
      const resp = await fetch(`${AI_BRIDGE}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const track: GeneratedTrack = {
        id: crypto.randomUUID(),
        type,
        prompt,
        blobUrl,
        duration,
        createdAt: Date.now(),
      };
      setTracks(prev => [track, ...prev]);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const handleMusic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!musicPrompt.trim()) return;
    generateTrack("generate/music", { prompt: musicPrompt, duration: musicDuration, style: musicStyle }, "music", `${musicPrompt} (${musicStyle})`, musicDuration);
  };

  const handleVoice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!voiceText.trim()) return;
    generateTrack("generate/voice", { text: voiceText, persona: voicePersona }, "voice", `${voicePersona}: "${voiceText}"`, 10);
  };

  const handleNoise = (e: React.FormEvent) => {
    e.preventDefault();
    generateTrack("generate/noise", { type: noiseType, duration: noiseDuration }, "noise", `${noiseType} ${noiseDuration}s`, noiseDuration);
  };

  const downloadTrack = (track: GeneratedTrack) => {
    const a = document.createElement("a");
    a.href = track.blobUrl;
    a.download = `${track.type}-${track.id.slice(0, 8)}.wav`;
    a.click();
  };

  const removeTrack = (id: string) => {
    setTracks(prev => {
      const t = prev.find(t => t.id === id);
      if (t) URL.revokeObjectURL(t.blobUrl);
      return prev.filter(t => t.id !== id);
    });
  };

  return (
    <div className="daw-ai-panel">
      <VideotexPageHeader title="DAW AI ASSISTANT" subtitle="openDAW + AI Bridge" color="cyan" />

      <div className="daw-ai-link">
        <a href="/daw/" target="_blank" rel="noopener" className="daw-ai-open-btn">
          OUVRIR openDAW
        </a>
        <span className="daw-ai-hint">Generez des pistes ici, puis importez-les dans openDAW</span>
      </div>

      {/* GENERATORS */}
      <div className="daw-ai-generators">
        {/* MUSIC */}
        <form onSubmit={handleMusic} className="daw-ai-gen-card">
          <div className="daw-ai-gen-title">MUSIQUE</div>
          <input
            value={musicPrompt}
            onChange={e => setMusicPrompt(e.target.value)}
            placeholder="ambient drone with metallic textures..."
            className="daw-ai-input"
            maxLength={200}
          />
          <div className="daw-ai-row">
            <select value={musicStyle} onChange={e => setMusicStyle(e.target.value)} className="daw-ai-select">
              {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="number" min={5} max={120} value={musicDuration}
              onChange={e => setMusicDuration(parseInt(e.target.value) || 30)}
              className="daw-ai-num"
            />
            <span className="daw-ai-unit">s</span>
          </div>
          <button type="submit" className="daw-ai-btn daw-ai-btn-music" disabled={status === "generating" || !musicPrompt.trim()}>
            {status === "generating" ? "..." : "Generer"}
          </button>
        </form>

        {/* VOICE */}
        <form onSubmit={handleVoice} className="daw-ai-gen-card">
          <div className="daw-ai-gen-title">VOIX</div>
          <input
            value={voiceText}
            onChange={e => setVoiceText(e.target.value)}
            placeholder="Bienvenue dans le chaos sonore..."
            className="daw-ai-input"
            maxLength={500}
          />
          <select value={voicePersona} onChange={e => setVoicePersona(e.target.value)} className="daw-ai-select">
            {PERSONAS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button type="submit" className="daw-ai-btn daw-ai-btn-voice" disabled={status === "generating" || !voiceText.trim()}>
            {status === "generating" ? "..." : "Synthetiser"}
          </button>
        </form>

        {/* NOISE */}
        <form onSubmit={handleNoise} className="daw-ai-gen-card">
          <div className="daw-ai-gen-title">TEXTURE</div>
          <div className="daw-ai-row">
            <select value={noiseType} onChange={e => setNoiseType(e.target.value)} className="daw-ai-select">
              {NOISE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              type="number" min={1} max={120} value={noiseDuration}
              onChange={e => setNoiseDuration(parseInt(e.target.value) || 10)}
              className="daw-ai-num"
            />
            <span className="daw-ai-unit">s</span>
          </div>
          <button type="submit" className="daw-ai-btn daw-ai-btn-noise" disabled={status === "generating"}>
            {status === "generating" ? "..." : "Generer"}
          </button>
        </form>
      </div>

      {error && <div className="daw-ai-error">{error}</div>}

      {/* GENERATED TRACKS */}
      {tracks.length > 0 && (
        <div className="daw-ai-tracks">
          <div className="daw-ai-tracks-title">PISTES GENEREES ({tracks.length})</div>
          {tracks.map(t => (
            <div key={t.id} className={`daw-ai-track daw-ai-track-${t.type}`}>
              <div className="daw-ai-track-info">
                <span className="daw-ai-track-type">{t.type.toUpperCase()}</span>
                <span className="daw-ai-track-prompt">{t.prompt}</span>
                <span className="daw-ai-track-dur">{t.duration}s</span>
              </div>
              <div className="daw-ai-track-controls">
                <audio src={t.blobUrl} controls preload="none" className="daw-ai-audio" />
                <button onClick={() => downloadTrack(t)} className="daw-ai-dl-btn" title="Telecharger WAV">DL</button>
                <button onClick={() => removeTrack(t.id)} className="daw-ai-rm-btn" title="Supprimer">X</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
