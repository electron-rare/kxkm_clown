import { useState, useRef, useCallback, useEffect } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

interface FXNode {
  id: string;
  type: "reverb" | "delay" | "distortion" | "chorus" | "pitch" | "filter" | "compressor" | "bitcrusher";
  enabled: boolean;
  params: Record<string, number>;
}

const DEFAULT_FX: FXNode[] = [
  { id: "1", type: "filter", enabled: true, params: { frequency: 2000, Q: 1, type: 0 } },
  { id: "2", type: "distortion", enabled: false, params: { amount: 50 } },
  { id: "3", type: "delay", enabled: false, params: { time: 0.3, feedback: 0.4, mix: 0.3 } },
  { id: "4", type: "reverb", enabled: false, params: { decay: 2, mix: 0.3 } },
  { id: "5", type: "compressor", enabled: true, params: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 } },
  { id: "6", type: "bitcrusher", enabled: false, params: { bits: 8, rate: 0.5 } },
  { id: "7", type: "pitch", enabled: false, params: { semitones: 0 } },
];

export default function LiveFXPage() {
  const [active, setActive] = useState(false);
  const [fx, setFx] = useState<FXNode[]>(DEFAULT_FX);
  const [inputLevel, setInputLevel] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodesRef = useRef<AudioNode[]>([]);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  function rebuildChain(ctx: AudioContext, source: AudioNode, chain: FXNode[]) {
    // Disconnect old
    nodesRef.current.forEach(n => { try { n.disconnect(); } catch {} });
    try { source.disconnect(); } catch {}
    nodesRef.current = [];

    let current: AudioNode = source;

    for (const node of chain) {
      if (!node.enabled) continue;
      let audioNode: AudioNode | null = null;

      switch (node.type) {
        case "filter": {
          const f = ctx.createBiquadFilter();
          f.type = (["lowpass", "highpass", "bandpass"][node.params.type || 0]) as BiquadFilterType;
          f.frequency.value = node.params.frequency || 2000;
          f.Q.value = node.params.Q || 1;
          audioNode = f;
          break;
        }
        case "distortion": {
          const ws = ctx.createWaveShaper();
          const amount = node.params.amount || 50;
          const curve = new Float32Array(ctx.sampleRate);
          for (let i = 0; i < curve.length; i++) {
            const x = (i * 2) / curve.length - 1;
            curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
          }
          ws.curve = curve;
          audioNode = ws;
          break;
        }
        case "delay": {
          const delay = ctx.createDelay(5);
          delay.delayTime.value = node.params.time || 0.3;
          const feedback = ctx.createGain();
          feedback.gain.value = node.params.feedback || 0.4;
          const mix = ctx.createGain();
          mix.gain.value = node.params.mix || 0.3;
          const dry = ctx.createGain();
          dry.gain.value = 1 - (node.params.mix || 0.3);
          current.connect(dry);
          current.connect(delay);
          delay.connect(feedback);
          feedback.connect(delay);
          delay.connect(mix);
          const merger = ctx.createGain();
          dry.connect(merger);
          mix.connect(merger);
          nodesRef.current.push(delay, feedback, mix, dry, merger);
          current = merger;
          continue;
        }
        case "reverb": {
          const convolver = ctx.createConvolver();
          const rate = ctx.sampleRate;
          const decay = node.params.decay || 2;
          const length = rate * decay;
          const impulse = ctx.createBuffer(2, length, rate);
          for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
              data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
            }
          }
          convolver.buffer = impulse;
          const wet = ctx.createGain();
          wet.gain.value = node.params.mix || 0.3;
          const dry = ctx.createGain();
          dry.gain.value = 1 - (node.params.mix || 0.3);
          current.connect(dry);
          current.connect(convolver);
          convolver.connect(wet);
          const merger = ctx.createGain();
          dry.connect(merger);
          wet.connect(merger);
          nodesRef.current.push(convolver, wet, dry, merger);
          current = merger;
          continue;
        }
        case "compressor": {
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = node.params.threshold || -24;
          comp.ratio.value = node.params.ratio || 4;
          comp.attack.value = node.params.attack || 0.003;
          comp.release.value = node.params.release || 0.25;
          audioNode = comp;
          break;
        }
        case "bitcrusher": {
          const bits = node.params.bits || 8;
          const sp = ctx.createScriptProcessor(4096, 1, 1);
          sp.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);
            const step = Math.pow(0.5, bits);
            for (let i = 0; i < input.length; i++) {
              output[i] = step * Math.floor(input[i] / step + 0.5);
            }
          };
          audioNode = sp;
          break;
        }
        default:
          continue;
      }

      if (audioNode) {
        current.connect(audioNode);
        nodesRef.current.push(audioNode);
        current = audioNode;
      }
    }

    // Connect to output
    current.connect(ctx.destination);

    // Also connect source to analyser for metering
    if (analyserRef.current) {
      source.connect(analyserRef.current);
    }
  }

  const start = useCallback(async () => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // Level meter
    const analyser = ctx.createAnalyser();
    analyserRef.current = analyser;

    // Build FX chain
    rebuildChain(ctx, source, fx);
    setActive(true);

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let max = 0;
      for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i] - 128));
      setInputLevel(max / 128);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [fx]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close();
    ctxRef.current = null;
    sourceRef.current = null;
    nodesRef.current = [];
    setActive(false);
    setInputLevel(0);
  }, []);

  const toggleFX = (id: string) => {
    setFx(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  };

  const updateParam = (id: string, param: string, value: number) => {
    setFx(prev => prev.map(f => f.id === id ? { ...f, params: { ...f.params, [param]: value } } : f));
  };

  // Rebuild chain when FX change (only if active)
  useEffect(() => {
    if (active && ctxRef.current && sourceRef.current) {
      rebuildChain(ctxRef.current, sourceRef.current, fx);
    }
  }, [fx, active]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const FX_COLORS: Record<string, string> = {
    filter: "#2196f3", distortion: "#f44336", delay: "#ff9800", reverb: "#9c27b0",
    compressor: "#4caf50", bitcrusher: "#e91e63", pitch: "#00bcd4", chorus: "#ffc107",
  };

  return (
    <div className="livefx-page">
      <VideotexPageHeader title="LIVE AUDIO FX" subtitle="Micro → Effets → Sortie" color="pink" />

      <div className="livefx-controls">
        <button className={`livefx-toggle ${active ? "livefx-active" : ""}`} onClick={active ? stop : start}>
          {active ? "STOP" : "START MICRO"}
        </button>
        {active && (
          <div className="livefx-meters">
            <div className="livefx-meter">
              <span>IN</span>
              <div className="livefx-meter-bar" style={{ width: `${inputLevel * 100}%`, background: inputLevel > 0.8 ? "#f44" : "#4caf50" }} />
            </div>
          </div>
        )}
      </div>

      <div className="livefx-chain">
        {fx.map(node => (
          <div key={node.id} className={`livefx-node ${node.enabled ? "livefx-node-on" : ""}`} style={{ borderColor: node.enabled ? FX_COLORS[node.type] : undefined }}>
            <button className="livefx-node-toggle" onClick={() => toggleFX(node.id)} style={{ color: FX_COLORS[node.type] }}>
              {node.enabled ? "●" : "○"} {node.type.toUpperCase()}
            </button>
            {node.enabled && (
              <div className="livefx-params">
                {Object.entries(node.params).map(([key, val]) => (
                  <label key={key} className="livefx-param">
                    <span>{key}</span>
                    <input type="range" min={0} max={key === "frequency" ? 10000 : key === "threshold" ? 0 : key === "ratio" ? 20 : key === "bits" ? 16 : key === "semitones" ? 24 : key === "decay" ? 5 : 1}
                      step={key === "frequency" ? 10 : 0.01} value={val}
                      onChange={e => updateParam(node.id, key, parseFloat(e.target.value))}
                      style={{ accentColor: FX_COLORS[node.type] }}
                    />
                    <span className="livefx-param-val">{typeof val === "number" ? val.toFixed(key === "frequency" ? 0 : 2) : val}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
