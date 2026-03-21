export interface Track {
  id: number;
  name: string;
  prompt: string;
  style: string;
  duration: number;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  type: "music" | "voice" | "noise";
  color: string;
  startOffset: number;
  audioData?: string;
  audioMime?: string;
  fxCount?: number;
  recordArmed?: boolean;
  expanded?: boolean;
}

export interface DAWState {
  compId: string;
  compName: string;
  bpm: number;
  tracks: Track[];
  playing: boolean;
  position: number;
  zoom: number;
  selectedTrack: number | null;
  status: string;
  generating: boolean;
  editingName: number | null;
  fxOpen: number | null;
  prompt: string;
  style: string;
  duration: number;
  contextMenu: { x: number; y: number; trackIdx: number } | null;
  dragging: { trackIdx: number; mode: "move" | "resize"; startX: number; origOffset: number; origDuration: number } | null;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  tool: "select" | "move" | "trim" | "split";
  panelCollapsed: boolean;
  recording: boolean;
  timeDisplay: "time" | "bars";
  signature: [number, number];
}

export type DAWAction =
  | { type: "SET_TRACKS"; tracks: Track[] }
  | { type: "ADD_TRACK"; track: Track }
  | { type: "UPDATE_TRACK"; index: number; updates: Partial<Track> }
  | { type: "REMOVE_TRACK"; index: number }
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "SET_POSITION"; position: number }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_SELECTED"; index: number | null }
  | { type: "SET_STATUS"; status: string }
  | { type: "SET_GENERATING"; generating: boolean }
  | { type: "SET_BPM"; bpm: number }
  | { type: "SET_NAME"; name: string }
  | { type: "SET_COMP_ID"; id: string }
  | { type: "SET_EDITING_NAME"; index: number | null }
  | { type: "SET_FX_OPEN"; index: number | null }
  | { type: "SET_PROMPT"; prompt: string }
  | { type: "SET_STYLE"; style: string }
  | { type: "SET_DURATION"; duration: number }
  | { type: "SET_CONTEXT_MENU"; menu: DAWState["contextMenu"] }
  | { type: "SET_DRAGGING"; dragging: DAWState["dragging"] }
  | { type: "SET_LOOP"; enabled: boolean; start?: number; end?: number }
  | { type: "SET_TOOL"; tool: DAWState["tool"] }
  | { type: "SET_PANEL_COLLAPSED"; collapsed: boolean }
  | { type: "SET_RECORDING"; recording: boolean }
  | { type: "SET_TIME_DISPLAY"; mode: "time" | "bars" }
  | { type: "SET_SIGNATURE"; signature: [number, number] };

export function dawReducer(state: DAWState, action: DAWAction): DAWState {
  switch (action.type) {
    case "SET_TRACKS": return { ...state, tracks: action.tracks };
    case "ADD_TRACK": return { ...state, tracks: [...state.tracks, action.track] };
    case "UPDATE_TRACK": return { ...state, tracks: state.tracks.map((t, i) => i === action.index ? { ...t, ...action.updates } : t) };
    case "REMOVE_TRACK": return { ...state, tracks: state.tracks.filter((_, i) => i !== action.index) };
    case "SET_PLAYING": return { ...state, playing: action.playing };
    case "SET_POSITION": return { ...state, position: action.position };
    case "SET_ZOOM": return { ...state, zoom: Math.max(2, Math.min(60, action.zoom)) };
    case "SET_SELECTED": return { ...state, selectedTrack: action.index };
    case "SET_STATUS": return { ...state, status: action.status };
    case "SET_GENERATING": return { ...state, generating: action.generating };
    case "SET_BPM": return { ...state, bpm: Math.max(20, Math.min(300, action.bpm)) };
    case "SET_NAME": return { ...state, compName: action.name };
    case "SET_COMP_ID": return { ...state, compId: action.id };
    case "SET_EDITING_NAME": return { ...state, editingName: action.index };
    case "SET_FX_OPEN": return { ...state, fxOpen: action.index };
    case "SET_PROMPT": return { ...state, prompt: action.prompt };
    case "SET_STYLE": return { ...state, style: action.style };
    case "SET_DURATION": return { ...state, duration: action.duration };
    case "SET_CONTEXT_MENU": return { ...state, contextMenu: action.menu };
    case "SET_DRAGGING": return { ...state, dragging: action.dragging };
    case "SET_LOOP": return { ...state, loopEnabled: action.enabled, loopStart: action.start ?? state.loopStart, loopEnd: action.end ?? state.loopEnd };
    case "SET_TOOL": return { ...state, tool: action.tool };
    case "SET_PANEL_COLLAPSED": return { ...state, panelCollapsed: action.collapsed };
    case "SET_RECORDING": return { ...state, recording: action.recording };
    case "SET_TIME_DISPLAY": return { ...state, timeDisplay: action.mode };
    case "SET_SIGNATURE": return { ...state, signature: action.signature };
    default: return state;
  }
}

export const COLORS = ["#e06030","#2ea060","#8855ee","#10907a","#c07020","#3060e0","#d03070","#1080a0","#a050f0","#e03030","#10b080","#e0a020"];

export const STYLES = [
  { group: "Electronique", items: ["experimental","ambient","drone","noise","glitch","industrial","techno","minimal","synthwave","idm","breakbeat","drum-n-bass","dubstep","house"] },
  { group: "Concrete", items: ["concrete","electroacoustique","acousmatic","field-recording","tape-music"] },
  { group: "Jazz/Classique", items: ["jazz","free-jazz","classical","cinematic","orchestral","chamber","opera"] },
  { group: "Rock/Urbain", items: ["post-rock","metal","punk","hip-hop","lo-fi","trap","garage"] },
  { group: "World/Dark", items: ["folk","world","dark","dark-ambient","ritual","tribal"] },
];

export const FX_LIST = [
  { label: "Reverse", cmd: "reverse", special: "" },
  { label: "Reverb", cmd: "reverb", special: "" },
  { label: "Echo", cmd: "echo", special: "" },
  { label: "Distortion", cmd: "distortion", special: "" },
  { label: "Stutter x8", cmd: "stutter", special: "/stutter {i} 8" },
  { label: "Pitch +3", cmd: "pitch 3", special: "" },
  { label: "Pitch -3", cmd: "pitch -3", special: "" },
  { label: "Fade In 3s", cmd: "fade-in 3", special: "" },
  { label: "Fade Out 3s", cmd: "fade-out 3", special: "" },
  { label: "Normalize", cmd: "normalize", special: "/normalize {i}" },
  { label: "Speed +20%", cmd: "speed 1.2", special: "" },
  { label: "Speed -20%", cmd: "speed 0.8", special: "" },
];

export const CTX_ACTIONS = [
  { label: "Copy", fn: (i: number) => "/dup " + i },
  { label: "Delete", fn: (i: number) => "/delete " + i },
  { label: "Duplicate", fn: (i: number) => "/dup " + i },
  { label: "Reverse", fn: (i: number) => "/fx " + i + " reverse" },
  { label: "Reverb", fn: (i: number) => "/fx " + i + " reverb" },
  { label: "Echo", fn: (i: number) => "/fx " + i + " echo" },
  { label: "Distortion", fn: (i: number) => "/fx " + i + " distortion" },
  { label: "Normalize", fn: (i: number) => "/normalize " + i },
];

export function typeIcon(t: Track): string {
  return t.type === "voice" ? "\u266A" : t.type === "noise" ? "\u223F" : "\u266B";
}

export function formatBars(sec: number, bpm: number, sig: [number, number]): string {
  const beatDur = 60 / bpm;
  const barDur = beatDur * sig[0];
  const bar = Math.floor(sec / barDur) + 1;
  const beat = Math.floor((sec % barDur) / beatDur) + 1;
  return String(bar) + "." + String(beat);
}

export function volToDb(vol: number): string {
  if (vol <= 0) return "-inf";
  const db = 20 * Math.log10(vol / 100);
  return db >= 0 ? "+" + db.toFixed(1) : db.toFixed(1);
}
