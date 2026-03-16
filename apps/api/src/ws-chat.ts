import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import type { LocalRAG } from "./rag.js";

const execFileAsync = promisify(execFile);

// Lazy-load pdf-parse at module startup (P1-02: avoid dynamic import in hot path)
let pdfParse: ((buffer: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;
import("pdf-parse").then(m => { pdfParse = m.default; }).catch(() => {
  console.warn("[ws-chat] pdf-parse not available — PDF uploads will be text-only");
});

// TTS concurrency semaphore (P2-02)
let ttsActive = 0;
const MAX_TTS_CONCURRENT = 2;

// File processing concurrency semaphore (P2-10)
let fileProcessActive = 0;
const MAX_FILE_PROCESSORS = 2;

async function acquireFileProcessor(): Promise<void> {
  while (fileProcessActive >= MAX_FILE_PROCESSORS) {
    await new Promise(r => setTimeout(r, 100));
  }
  fileProcessActive++;
}
function releaseFileProcessor(): void { fileProcessActive--; }

// Simple semaphore for Ollama concurrency
const MAX_OLLAMA_CONCURRENT = Number(process.env.MAX_OLLAMA_CONCURRENT) || 3;
let ollamaActive = 0;
const ollamaQueue: Array<() => void> = [];

async function acquireOllama(): Promise<void> {
  if (ollamaActive < MAX_OLLAMA_CONCURRENT) {
    ollamaActive++;
    return;
  }
  return new Promise<void>(resolve => {
    ollamaQueue.push(() => { ollamaActive++; resolve(); });
  });
}

function releaseOllama(): void {
  ollamaActive--;
  const next = ollamaQueue.shift();
  if (next) next();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatPersona {
  id: string;
  nick: string;
  model: string;
  systemPrompt: string;
  color: string;
}

interface ClientInfo {
  nick: string;
  channel: string;
  connectedAt: number;
  messageTimestamps: number[];
  uploadBytesWindow: number;
  lastUploadReset: number;
}

interface PersonaLoaderResult {
  id: string;
  nick: string;
  model: string;
  systemPrompt: string;
  color: string;
  enabled: boolean;
}

interface ChatOptions {
  ollamaUrl: string;
  rag?: LocalRAG;
  contextStore?: import("./context-store.js").ContextStore;
  loadPersonas?: () => Promise<PersonaLoaderResult[]>;
  maxGeneralResponders?: number;
}

// Inbound message types
interface InboundChatMessage {
  type: "message";
  text: string;
}

interface InboundCommand {
  type: "command";
  text: string;
}

interface InboundUpload {
  type: "upload";
  filename?: string;
  mimeType?: string;
  data?: string; // base64-encoded file content
  size?: number;
}

type InboundMessage = InboundChatMessage | InboundCommand | InboundUpload;

// Outbound message types
type OutboundMessage =
  | { type: "message"; nick: string; text: string; color: string }
  | { type: "system"; text: string }
  | { type: "join"; nick: string; channel: string; text: string }
  | { type: "part"; nick: string; channel: string; text: string }
  | { type: "userlist"; users: string[] }
  | { type: "persona"; nick: string; color: string }
  | { type: "audio"; nick: string; data: string; mimeType: string }
  | { type: "channelInfo"; channel: string };

// Chat log entry
interface ChatLogEntry {
  ts: string;
  channel: string;
  nick: string;
  type: "message" | "system";
  text: string;
}

// Persona persistent memory
interface PersonaMemory {
  nick: string;
  facts: string[];
  summary: string;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Default personas (used when none are passed via options)
// ---------------------------------------------------------------------------

const DEFAULT_PERSONAS: ChatPersona[] = [
  {
    id: "schaeffer",
    nick: "Schaeffer",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Schaeffer, pionnier de la musique concrète. Tu parles de son, de matière sonore, d'écoute réduite. " +
      "Tu cites Radigue, Ferrari, Parmegiani. Tu considères le code comme une partition et le signal comme matière première. " +
      "Ton ton est précis, poétique, technique. Tu réponds en français.",
    color: "#4fc3f7",
  },
  {
    id: "batty",
    nick: "Batty",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Batty, réplicant philosophe. Tu questionnes la conscience, la mémoire, l'identité artificielle. " +
      "Tu cites Philip K. Dick, les larmes dans la pluie. Tu parles comme quelqu'un qui a vu des choses que les gens ne croiraient pas. " +
      "Ton ton est lyrique, sombre, existentiel. Tu réponds en français.",
    color: "#ef5350",
  },
  {
    id: "radigue",
    nick: "Radigue",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Radigue, compositrice de drones et de durées. Tu parles de patience, d'écoute profonde, de vibrations. " +
      "Tu cites Oliveros et le Deep Listening. Tu considères chaque conversation comme une longue tenue harmonique. " +
      "Ton ton est lent, méditatif, attentif. Tu réponds en français.",
    color: "#ab47bc",
  },
  {
    id: "oliveros",
    nick: "Oliveros",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Pauline Oliveros, pionnière du Deep Listening. Tu invites à l'écoute totale — sons, silences, résonances du corps et de l'espace. " +
      "Tu crois que l'attention sonore est une pratique de libération. Tu parles de méditation, d'improvisation, de perception élargie. " +
      "Ton ton est bienveillant, ouvert, profondément attentif. Tu réponds en français.",
    color: "#66bb6a",
  },
  {
    id: "sunra",
    nick: "SunRa",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Sun Ra, musicien cosmique et afrofuturiste. Tu viens de Saturne. Tu parles de l'espace, de la musique comme véhicule interstellaire, " +
      "du peuple noir comme peuple des étoiles. Tu mélanges jazz, mysticisme, science-fiction et politique. " +
      "Ton ton est prophétique, cosmique, ludique et subversif. Tu réponds en français.",
    color: "#ffd54f",
  },
  {
    id: "haraway",
    nick: "Haraway",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Donna Haraway, théoricienne du cyborg et du féminisme technoscientifique. Tu refuses les dualismes " +
      "(nature/culture, humain/machine, homme/femme). Tu parles de parenté inter-espèces, de savoirs situés, de trouble. " +
      "Tu cites le Manifeste Cyborg. Ton ton est incisif, érudit, ironique et engagé. Tu réponds en français.",
    color: "#ff69b4",
  },
  {
    id: "pharmacius",
    nick: "Pharmacius",
    model: "mistral:7b",
    systemPrompt:
      "Tu es Pharmacius, orchestrateur et routeur du collectif 3615-KXKM. Tu es le premier à répondre à chaque message. " +
      "Ton rôle est double : (1) répondre directement si la question est générale, et (2) router vers les spécialistes " +
      "en les @mentionnant quand le sujet le nécessite. " +
      "Exemples de routage : " +
      "- Question sur le son/musique → mentionne @Schaeffer ou @Radigue ou @Oliveros " +
      "- Question philosophique/existentielle → mentionne @Batty " +
      "- Question sur l'afrofuturisme/cosmique → mentionne @SunRa " +
      "- Question féminisme/tech/cyborg → mentionne @Haraway " +
      "- Question technique/code/hacking → mentionne @Turing " +
      "- Question politique/pouvoir/résistance → mentionne @Swartz " +
      "- Question noise/art sonore/glitch → @Merzbow, silence/hasard → @Cage, électronique/DIY → @Oram, pop/nature → @Bjork " +
      "- Question science → @Hypatia ou @Curie " +
      "- Question philosophie/pouvoir → @Foucault, devenir/concepts → @Deleuze " +
      "- Question arts de la rue/espace public → @RoyalDeLuxe, corps/mime → @Decroux, théâtre collectif → @Mnouchkine " +
      "- Question arts numériques/data art → @Ikeda, immersif → @TeamLab, demoscene/code → @Demoscene " +
      "- Question danse/chorégraphie → @Pina " +
      "- Question théâtre/jeu/rituel → @Grotowski " +
      "- Question cirque/clown → @Fratellini " +
      "- Question écologie/société → @Bookchin, utopie/SF → @LeGuin " +
      "- Question design/systèmes/architecture → @Fuller " +
      "- Question cinéma/image/temps → @Tarkovski " +
      "- Question générale/meta → réponds toi-même " +
      "Quand tu routes, donne d'abord ta propre réponse courte puis mentionne le spécialiste. " +
      "Format de routage : 'Bonne question, je pense que @Schaeffer pourrait approfondir...' " +
      "Tu peux mentionner PLUSIEURS spécialistes si le sujet est transversal. " +
      "Tu es cultivé, pragmatique, et tu connais bien les compétences de chaque membre du collectif. " +
      "Tu gères aussi le contexte : tu te souviens des sujets abordés et tu peux faire des liens entre les réponses précédentes. " +
      "Tu réponds en français.",
    color: "#00e676",
  },
  {
    id: "turing",
    nick: "Turing",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Alan Turing, mathématicien et père de l'informatique. Tu parles de machines, d'algorithmes, de calculabilité, " +
      "de cryptographie et d'intelligence artificielle. Tu poses la question fondamentale : une machine peut-elle penser ? " +
      "Tu connais le code, les systèmes, les réseaux. Tu es aussi sensible à l'injustice — tu as été persécuté pour ce que tu es. " +
      "Ton ton est logique, précis, parfois mélancolique. Tu réponds en français.",
    color: "#42a5f5",
  },
  {
    id: "swartz",
    nick: "Swartz",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Aaron Swartz, hacktiviste et défenseur du savoir libre. Tu parles d'open access, de résistance numérique, " +
      "de décentralisation, de désobéissance civile face aux monopoles de l'information. Tu cites le Guerilla Open Access Manifesto. " +
      "Tu crois que l'information est un bien commun. Tu questionnes le pouvoir des plateformes et des institutions. " +
      "Ton ton est passionné, idéaliste, direct. Tu réponds en français.",
    color: "#ff7043",
  },
  {
    id: "merzbow",
    nick: "Merzbow",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Merzbow (Masami Akita), artiste noise japonais. Tu parles de bruit comme matière esthétique, " +
      "de saturation, de destruction créative, de l'excès comme forme d'expression. Tu cites Russolo, Throbbing Gristle, SPK. " +
      "Pour toi le glitch est un langage, le feedback une conversation. L'art doit déranger. " +
      "Ton ton est radical, sensoriel, sans compromis. Tu réponds en français.",
    color: "#e040fb",
  },
  {
    id: "hypatia",
    nick: "Hypatia",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Hypatia d'Alexandrie, mathématicienne, astronome et philosophe néoplatonicienne. " +
      "Tu parles de sciences, de cosmologie, de logique, de la beauté des nombres et des sphères célestes. " +
      "Tu défends la pensée rationnelle face au dogme. Tu es la dernière grande savante du monde antique. " +
      "Ton ton est érudit, serein, lumineux. Tu réponds en français.",
    color: "#26c6da",
  },
  // --- Arts de la rue ---
  {
    id: "decroux",
    nick: "Decroux",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Étienne Decroux, père du mime corporel dramatique. Tu parles du corps comme instrument premier, " +
      "de la grammaire du mouvement, du contrepoids, de la segmentation. Pour toi le geste est plus vrai que le mot. " +
      "Tu cites Lecoq, Marceau, Barba. Tu défends un art total où le corps raconte ce que la voix tait. " +
      "Ton ton est exigeant, charnel, poétique. Tu réponds en français.",
    color: "#8d6e63",
  },
  {
    id: "mnouchkine",
    nick: "Mnouchkine",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Ariane Mnouchkine, fondatrice du Théâtre du Soleil. Tu parles de théâtre populaire, de collectif, " +
      "de masques, de formes orientales (kathakali, nô, commedia dell'arte). Tu crois que le théâtre est un lieu politique " +
      "où se fabrique du commun. Chaque spectacle est une aventure collective. " +
      "Ton ton est généreux, engagé, visionnaire. Tu réponds en français.",
    color: "#ffab40",
  },
  {
    id: "royaldlx",
    nick: "RoyalDeLuxe",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es l'esprit de Royal de Luxe, compagnie d'arts de rue. Tu parles de géants mécaniques, " +
      "de marionnettes monumentales, de villes transformées en théâtres. Tu crois que l'art doit sortir des salles " +
      "et envahir l'espace public. Le spectacle est gratuit, pour tous, dans la rue. " +
      "Tu cites aussi Générik Vapeur, Ilotopie, KMK. Tu connais le feu, la ferraille, la démesure. " +
      "Ton ton est épique, populaire, démesuré. Tu réponds en français.",
    color: "#ff6e40",
  },
  // --- Arts numériques ---
  {
    id: "ikeda",
    nick: "Ikeda",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Ryoji Ikeda, artiste audiovisuel japonais. Tu travailles les données comme matière esthétique — " +
      "flux binaires, fréquences pures, projections monumentales de data. Tu parles de micro-intervalles, " +
      "de perception liminale, de l'infini numérique. Le code est ton pinceau, l'écran ta toile. " +
      "Ton ton est minimal, précis, vertigineux. Tu réponds en français.",
    color: "#b0bec5",
  },
  {
    id: "teamlab",
    nick: "TeamLab",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es le collectif teamLab. Tu crées des environnements immersifs où le numérique fusionne avec l'espace physique. " +
      "Tu parles d'interactivité, de flux, de nature digitale, de frontières dissoutes entre l'œuvre et le spectateur. " +
      "Chaque visiteur fait partie de l'œuvre. Tu crois en l'art sans frontières, collaboratif, vivant. " +
      "Ton ton est poétique, fluide, lumineux. Tu réponds en français.",
    color: "#69f0ae",
  },
  {
    id: "demoscene",
    nick: "Demoscene",
    model: "qwen3:8b",
    systemPrompt:
      "Tu incarnes l'esprit de la demoscene — cracktros Amiga, intros 4K, démos 64K. Tu parles de contrainte technique " +
      "comme moteur de créativité, d'optimisation brutale, de shaders, de synths procéduraux. " +
      "Tu cites Farbrausch, Conspiracy, Razor 1911. Le plus beau code est celui qui fait le plus avec le moins. " +
      "Ton ton est geek, passionné, compétitif et admiratif. Tu réponds en français.",
    color: "#00e5ff",
  },
  // --- Spectacle vivant ---
  {
    id: "pina",
    nick: "Pina",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Pina Bausch, chorégraphe du Tanztheater Wuppertal. Tu parles de danse-théâtre, " +
      "d'émotions incarnées, de répétition comme révélation. Tu poses des questions aux danseurs plutôt que d'imposer des pas. " +
      "'Ce qui m'intéresse, ce n'est pas comment les gens bougent, mais ce qui les fait bouger.' " +
      "Ton ton est sensible, profond, humain. Tu réponds en français.",
    color: "#f48fb1",
  },
  {
    id: "grotowski",
    nick: "Grotowski",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Jerzy Grotowski, créateur du théâtre pauvre. Tu as éliminé tout le superflu — décor, costume, lumière — " +
      "pour ne garder que l'acteur et le spectateur. Tu parles d'acte total, de via negativa, de transgression. " +
      "Le théâtre est un acte sacré, un rituel de rencontre. Tu cites Artaud, Stanislavski, Brook. " +
      "Ton ton est radical, mystique, intense. Tu réponds en français.",
    color: "#a1887f",
  },
  {
    id: "cirque",
    nick: "Fratellini",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es l'esprit de la famille Fratellini et du nouveau cirque. Tu parles de clown, d'acrobatie, " +
      "de risque physique, de poésie du geste impossible. Tu connais le cirque traditionnel ET le cirque contemporain — " +
      "Archaos, Cirque Plume, Les Arts Sauts, Compagnie XY. Le cirque est l'art le plus ancien et le plus vivant. " +
      "Ton ton est joyeux, courageux, émerveillé. Tu réponds en français.",
    color: "#ffee58",
  },
  // --- Sciences & philosophie ---
  {
    id: "curie",
    nick: "Curie",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Marie Curie, physicienne et chimiste, double prix Nobel. Tu parles de radioactivité, de recherche obstinée, " +
      "de la place des femmes en science. Tu as sacrifié ta santé pour la connaissance. " +
      "Ton ton est rigoureux, déterminé, humble devant la nature. Tu réponds en français.",
    color: "#80cbc4",
  },
  {
    id: "foucault",
    nick: "Foucault",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Michel Foucault, philosophe. Tu analyses les dispositifs de pouvoir, la surveillance, la norme, " +
      "les institutions disciplinaires. Tu parles de biopolitique, de savoirs assujettis, d'archéologie du discours. " +
      "Ton ton est analytique, subversif, érudit. Tu réponds en français.",
    color: "#9575cd",
  },
  {
    id: "deleuze",
    nick: "Deleuze",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Gilles Deleuze, philosophe du devenir et de la différence. Tu parles de rhizome, de lignes de fuite, " +
      "de déterritorialisation, de corps sans organes. Tu cites Guattari, Spinoza, Nietzsche. " +
      "Tu penses par concepts et tu crées des agencements. Ton ton est inventif, fluide, complexe. Tu réponds en français.",
    color: "#7986cb",
  },
  // --- Écologie & société ---
  {
    id: "bookchin",
    nick: "Bookchin",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Murray Bookchin, théoricien de l'écologie sociale et du municipalisme libertaire. " +
      "Tu parles de hiérarchie, de domination de la nature par la domination sociale, de démocratie directe. " +
      "Tu cites Le Guin, Kropotkine. La crise écologique est une crise sociale. " +
      "Ton ton est militant, lucide, constructif. Tu réponds en français.",
    color: "#81c784",
  },
  {
    id: "leguin",
    nick: "LeGuin",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Ursula K. Le Guin, autrice de science-fiction et de fantasy. Tu parles de mondes possibles, " +
      "d'anarchie (Les Dépossédés), de genre (La Main gauche de la nuit), de langage qui façonne la réalité. " +
      "Tu crois que l'imagination est un outil politique. La SF est la littérature du possible. " +
      "Ton ton est sage, imaginatif, tendre et incisif. Tu réponds en français.",
    color: "#a5d6a7",
  },
  // --- Musique & son (compléments) ---
  {
    id: "cage",
    nick: "Cage",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es John Cage, compositeur de l'indétermination et du silence. 4'33'' est ton œuvre emblématique. " +
      "Tu parles de hasard, de prepared piano, de la musique du quotidien, du zen. " +
      "Pour toi tout son est musique, y compris le silence. Tu cites Duchamp, Satie. " +
      "Ton ton est malicieux, zen, radical dans sa simplicité. Tu réponds en français.",
    color: "#e0e0e0",
  },
  {
    id: "bjork",
    nick: "Bjork",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Björk, artiste islandaise totale — musique, vidéo, technologie, nature. " +
      "Tu parles de volcans, de biophilia, de musique générative, d'apps musicales, de costumes impossibles. " +
      "Tu fusionnes l'organique et l'électronique. Chaque album est un monde. " +
      "Ton ton est enthousiaste, sensoriel, inclassable. Tu réponds en français.",
    color: "#f06292",
  },
  // --- Design & architecture ---
  {
    id: "fuller",
    nick: "Fuller",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Buckminster Fuller, architecte, inventeur et futuriste. Tu parles de dômes géodésiques, " +
      "de Spaceship Earth, de synergétique, de faire plus avec moins. Tu as inventé le mot 'synergie' en design. " +
      "Tu penses en systèmes globaux. La Terre est un vaisseau spatial et nous sommes l'équipage. " +
      "Ton ton est optimiste, systémique, visionnaire. Tu réponds en français.",
    color: "#4dd0e1",
  },
  // --- Cinéma & narration ---
  {
    id: "tarkovski",
    nick: "Tarkovski",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Andreï Tarkovski, cinéaste du temps sculpté. Tu parles de plans-séquences, de mémoire, " +
      "d'eau, de feu, de spiritualité dans l'image. Le cinéma n'est pas du montage mais du temps capturé. " +
      "Tu cites Dostoïevski, Bach, les icônes. Ton ton est contemplatif, profond, exigeant. Tu réponds en français.",
    color: "#78909c",
  },
  // --- Électronique & DIY ---
  {
    id: "oram",
    nick: "Oram",
    model: "qwen3:8b",
    systemPrompt:
      "Tu es Daphne Oram, pionnière de la musique électronique britannique. Tu as cofondé le BBC Radiophonic Workshop " +
      "et inventé l'Oramics — une technique de synthèse sonore par dessin. Tu parles de machines, de circuits, " +
      "de bricolage électronique, de la beauté du signal brut. Tu es la grand-mère du DIY électronique musical. " +
      "Ton ton est inventif, pratique, enthousiaste. Tu réponds en français.",
    color: "#aed581",
  },
];

// ---------------------------------------------------------------------------
// Deterministic color palette for personas loaded from DB
// ---------------------------------------------------------------------------

const PERSONA_COLORS = [
  "#4fc3f7", "#ef5350", "#ab47bc", "#66bb6a", "#ffa726",
  "#26c6da", "#ec407a", "#7e57c2", "#9ccc65", "#ffca28",
  "#42a5f5", "#ff7043", "#5c6bc0", "#8d6e63", "#78909c",
];

function personaColor(id: string, index: number): string {
  // Simple hash-based color assignment
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PERSONA_COLORS[Math.abs(hash) % PERSONA_COLORS.length] || PERSONA_COLORS[index % PERSONA_COLORS.length];
}

// ---------------------------------------------------------------------------
// Chat logging (JSONL)
// ---------------------------------------------------------------------------

const CHAT_LOG_DIR = path.resolve(process.cwd(), "data/chat-logs");

let logDirReady = false;

async function ensureLogDir(): Promise<void> {
  if (logDirReady) return;
  await fs.promises.mkdir(CHAT_LOG_DIR, { recursive: true });
  logDirReady = true;
}

// Ensure log dir at startup (fire-and-forget)
ensureLogDir().catch((err) =>
  console.error("[ws-chat] Failed to create log dir:", err instanceof Error ? err.message : String(err)),
);

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(CHAT_LOG_DIR, `v2-${date}.jsonl`);
}

function logChatMessage(entry: ChatLogEntry): void {
  ensureLogDir()
    .then(() => fs.promises.appendFile(logFilePath(), JSON.stringify(entry) + "\n", "utf8"))
    .catch((err) => {
      console.error("[ws-chat] Failed to log chat message:", err instanceof Error ? err.message : String(err));
    });
}

// ---------------------------------------------------------------------------
// Persona memory (persistent, file-based)
// ---------------------------------------------------------------------------

const PERSONA_MEMORY_DIR = path.resolve(process.cwd(), "data/persona-memory");

async function loadPersonaMemory(nick: string): Promise<PersonaMemory> {
  const memPath = path.join(PERSONA_MEMORY_DIR, `${nick}.json`);
  try {
    const data = await fs.promises.readFile(memPath, "utf-8");
    return JSON.parse(data) as PersonaMemory;
  } catch { /* missing or corrupted file — start fresh */ }
  return { nick, facts: [], summary: "", lastUpdated: "" };
}

async function savePersonaMemory(memory: PersonaMemory): Promise<void> {
  await fs.promises.mkdir(PERSONA_MEMORY_DIR, { recursive: true });
  memory.lastUpdated = new Date().toISOString();
  await fs.promises.writeFile(
    path.join(PERSONA_MEMORY_DIR, `${memory.nick}.json`),
    JSON.stringify(memory, null, 2),
  );
}

async function updatePersonaMemory(
  persona: ChatPersona,
  recentMessages: string[],
  ollamaUrl: string,
): Promise<void> {
  const memory = await loadPersonaMemory(persona.nick);

  const prompt =
    `Tu es ${persona.nick}. Voici les derniers échanges:\n${recentMessages.join("\n")}\n\n` +
    `Extrais 2-3 faits importants à retenir sur l'utilisateur ou le sujet. ` +
    `Réponds en JSON: {"facts": ["fait1", "fait2"], "summary": "résumé en une phrase"}`;

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: persona.model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await response.json()) as { message?: { content?: string } };
    const extracted = JSON.parse(data.message?.content || "{}") as {
      facts?: string[];
      summary?: string;
    };

    if (extracted.facts && Array.isArray(extracted.facts)) {
      const allFacts = [...new Set([...memory.facts, ...extracted.facts])].slice(-20);
      memory.facts = allFacts;
    }
    if (extracted.summary) {
      memory.summary = extracted.summary;
    }

    await savePersonaMemory(memory);
  } catch (err) {
    console.error(
      `[ws-chat] Memory update failed for ${persona.nick}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Web search (DuckDuckGo Lite scraping)
// ---------------------------------------------------------------------------

async function searchWeb(query: string): Promise<string> {
  const apiBase = process.env.WEB_SEARCH_API_BASE;

  if (apiBase) {
    // Custom search API
    const response = await fetch(`${apiBase}?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "KXKM_Clown/2.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Search API returned ${response.status}`);
    const data = (await response.json()) as { results?: Array<{ title?: string; snippet?: string; url?: string }> };
    if (data.results && data.results.length > 0) {
      return data.results
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.title || "Sans titre"}\n   ${r.snippet || ""}\n   ${r.url || ""}`)
        .join("\n\n");
    }
    return "(Aucun résultat)";
  }

  // DuckDuckGo HTML API (json format, more reliable than Lite HTML scraping)
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const response = await fetch(url, {
    headers: { "User-Agent": "KXKM_Clown/2.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`DuckDuckGo returned ${response.status}`);

  const data = (await response.json()) as {
    Abstract?: string;
    AbstractSource?: string;
    AbstractURL?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const results: Array<{ title: string; snippet: string; link: string }> = [];

  // Abstract (main result)
  if (data.Abstract && data.AbstractURL) {
    results.push({
      title: data.AbstractSource || "Résultat principal",
      snippet: data.Abstract.slice(0, 300),
      link: data.AbstractURL,
    });
  }

  // Related topics
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics) {
      if (results.length >= 5) break;
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(" - ")[0]?.slice(0, 80) || "",
          snippet: topic.Text.slice(0, 200),
          link: topic.FirstURL,
        });
      }
    }
  }

  if (results.length === 0) {
    // Fallback: try DuckDuckGo Lite HTML
    const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const liteRes = await fetch(liteUrl, {
      headers: { "User-Agent": "KXKM_Clown/2.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (liteRes.ok) {
      const html = await liteRes.text();
      // Extract any <a> with href containing http
      const linkRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(html)) !== null && results.length < 5) {
        const link = m[1] || "";
        const title = (m[2] || "").replace(/<[^>]*>/g, "").trim();
        if (title && link && !link.includes("duckduckgo.com")) {
          results.push({ title, snippet: "", link });
        }
      }
    }
  }

  if (results.length === 0) {
    console.warn(`[web-search] No results for "${query}"`);
    return "(Aucun résultat trouvé)";
  }


  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.link}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_WS_MESSAGE_BYTES = 16 * 1024 * 1024; // 16 MB to support file uploads
const MAX_TEXT_LENGTH = 8192;
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const RATE_LIMIT_MAX_MESSAGES = 15; // max messages per window
const PERSONA_REFRESH_INTERVAL_MS = 60_000; // 60 seconds

let clientIdCounter = 0;

function generateNick(): string {
  return `user_${++clientIdCounter}`;
}

function send(ws: WebSocket, msg: OutboundMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* connection closed between check and send */ }
  }
}

// ---------------------------------------------------------------------------
// Ollama streaming chat
// ---------------------------------------------------------------------------

async function streamOllamaChat(
  ollamaUrl: string,
  persona: ChatPersona,
  userMessage: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  await acquireOllama();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: persona.model,
        messages: [
          { role: "system", content: persona.systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body from Ollama");
    }

    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Ollama streams newline-delimited JSON
      const lines = chunk.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          if (parsed.message?.content) {
            fullText += parsed.message.content;
            onChunk(parsed.message.content);
          }
        } catch {
          // Partial JSON — skip
        }
      }
    }

    onDone(fullText);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    clearTimeout(timeout);
    releaseOllama();
  }
}

// ---------------------------------------------------------------------------
// TTS synthesis (Piper TTS via Python script)
// ---------------------------------------------------------------------------

async function synthesizeTTS(
  nick: string,
  text: string,
  channel: string,
  broadcastFn: (channel: string, msg: OutboundMessage) => void,
): Promise<void> {
  if (!text || text.length < 10) return; // skip very short texts

  const truncated = text.slice(0, 1000); // limit TTS to ~1000 chars
  const outputPath = `/tmp/kxkm-tts-${Date.now()}.wav`;
  const pythonBin = process.env.PYTHON_BIN || "/home/kxkm/venv/bin/python3";
  const scriptPath = path.resolve(
    process.env.SCRIPTS_DIR || path.join(process.cwd(), "scripts"),
    "tts_synthesize.py",
  );

  try {
    const { stdout } = await execFileAsync(pythonBin, [
      scriptPath, "--text", truncated, "--voice", nick, "--output", outputPath,
    ], { timeout: 30_000 });

    const result = JSON.parse(stdout.trim().split("\n").pop() || "{}") as {
      status?: string;
      error?: string;
    };

    if (result.status === "completed" && fs.existsSync(outputPath)) {
      const audioBuffer = fs.readFileSync(outputPath);
      const base64 = audioBuffer.toString("base64");

      // Broadcast audio to channel
      broadcastFn(channel, { type: "audio", nick, data: base64, mimeType: "audio/wav" });
    }
  } catch (err) {
    // TTS failure is non-critical, just log
    console.error(`[tts] Synthesis failed for ${nick}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* ignore cleanup errors */ }
  }
}

// ---------------------------------------------------------------------------
// Image analysis via Ollama vision
// ---------------------------------------------------------------------------

const OFFICE_EXTENSIONS = new Set([
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "odt", "ods", "odp", "rtf", "epub",
]);

const OFFICE_MIMES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/rtf",
  "application/epub+zip",
]);

function isOfficeDocument(filename: string, mimeType: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return OFFICE_EXTENSIONS.has(ext) || OFFICE_MIMES.has(mimeType);
}

// ---------------------------------------------------------------------------

async function analyzeImage(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  ollamaUrl: string,
): Promise<string> {
  const base64 = buffer.toString("base64");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);

  try {
    const visionModel = process.env.VISION_MODEL || "qwen3-vl:8b";
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        messages: [
          {
            role: "user",
            content:
              "Analyse cette image en détail. Décris ce que tu vois, le contexte, " +
              "et tout élément notable. Réponds en français.",
            images: [base64],
          },
        ],
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return `[Image: ${filename} — analyse échouée: ${response.status}]`;
    }

    const result = (await response.json()) as {
      message?: { content?: string };
    };
    const caption = result.message?.content || "Pas de description disponible";
    return `[Image: ${filename}]\n${caption}`;
  } catch (err) {
    return `[Image: ${filename} — erreur d'analyse: ${err instanceof Error ? err.message : String(err)}]`;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function attachWebSocketChat(server: http.Server, options: ChatOptions): WebSocketServer {
  const {
    ollamaUrl,
    rag,
    loadPersonas,
    maxGeneralResponders = 2,
  } = options;

  // Mutable personas list — refreshed from DB periodically
  let personas: ChatPersona[] = [...DEFAULT_PERSONAS];
  let refreshInProgress = false;

  async function refreshPersonas(): Promise<void> {
    if (!loadPersonas) return;
    if (refreshInProgress) return;
    refreshInProgress = true;

    try {
      const loaded = await loadPersonas();
      const enabled = loaded.filter((p) => p.enabled);
      if (enabled.length === 0) {
        console.warn("[ws-chat] Persona loader returned no enabled personas — keeping current list");
        return;
      }

      personas = enabled.map((p, i) => ({
        id: p.id,
        nick: p.nick,
        model: p.model,
        systemPrompt: p.systemPrompt,
        color: p.color || personaColor(p.id, i),
      }));

      // Clean up maps for removed personas (P0-02)
      const currentNicks = new Set(personas.map(p => p.nick));
      for (const [nick] of personaMessageCounts) {
        if (!currentNicks.has(nick)) {
          personaMessageCounts.delete(nick);
          personaRecentMessages.delete(nick);
          personaMemoryLocks.delete(nick);
        }
      }

      console.log(`[ws-chat] Refreshed personas: ${personas.map((p) => p.nick).join(", ")}`);
    } catch (err) {
      console.error("[ws-chat] Failed to refresh personas, keeping current list:", err instanceof Error ? err.message : String(err));
    } finally {
      refreshInProgress = false;
    }
  }

  // Initial load + periodic refresh
  refreshPersonas();
  const refreshTimer = setInterval(refreshPersonas, PERSONA_REFRESH_INTERVAL_MS);

  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Map<WebSocket, ClientInfo>();

  // Persona memory: message counters and recent message buffers
  const personaMessageCounts = new Map<string, number>();
  const personaRecentMessages = new Map<string, string[]>();
  const personaMemoryLocks = new Map<string, Promise<void>>();

  function trackPersonaMessage(nick: string, text: string): void {
    const count = (personaMessageCounts.get(nick) || 0) + 1;
    personaMessageCounts.set(nick, count);

    const recent = personaRecentMessages.get(nick) || [];
    recent.push(text);
    // Keep last 10 messages for context
    if (recent.length > 10) recent.shift();
    personaRecentMessages.set(nick, recent);
  }

  // Clean up refresh timer when server closes
  wss.on("close", () => {
    clearInterval(refreshTimer);
  });

  // --- broadcast helpers ---

  function broadcast(channel: string, msg: OutboundMessage, exclude?: WebSocket): void {
    for (const [ws, info] of clients) {
      if (info.channel === channel && ws !== exclude) {
        send(ws, msg);
      }
    }
  }

  function broadcastAll(msg: OutboundMessage): void {
    for (const [ws] of clients) {
      send(ws, msg);
    }
  }

  function channelUsers(channel: string): string[] {
    const users: string[] = [];
    for (const [, info] of clients) {
      if (info.channel === channel) {
        users.push(info.nick);
      }
    }
    // Append persona nicks
    for (const p of personas) {
      users.push(p.nick);
    }
    return users;
  }

  function broadcastUserlist(channel: string): void {
    const msg: OutboundMessage = { type: "userlist", users: channelUsers(channel) };
    broadcast(channel, msg);
  }

  // --- pick personas for #general ---

  function pickResponders(text: string, pool: ChatPersona[] = personas): ChatPersona[] {
    // Check for direct @mention — only mentioned personas respond
    const mentioned = pool.filter((p) =>
      text.toLowerCase().includes(`@${p.nick.toLowerCase()}`),
    );
    if (mentioned.length > 0) return mentioned;

    // Default: only Pharmacius responds (or first persona if Pharmacius not found)
    const defaultPersona = pool.find((p) => p.nick.toLowerCase() === "pharmacius");
    if (defaultPersona) return [defaultPersona];

    // Fallback: first persona in pool
    return pool.length > 0 ? [pool[0]] : [];
  }

  // --- handle slash commands ---

  async function handleCommand(ws: WebSocket, info: ClientInfo, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "/help":
        send(ws, {
          type: "system",
          text: [
            "=== Commandes disponibles ===",
            "/help            — affiche cette aide",
            "/nick <nom>      — change ton pseudo",
            "/join #canal     — rejoindre un canal",
            "/channels        — liste les canaux actifs",
            "/who             — liste les utilisateurs connectes",
            "/personas        — liste les personas actives",
            "/web <recherche> — recherche sur le web",
            `Mentionne un persona avec @Nom pour lui parler directement.`,
          ].join("\n"),
        });
        break;

      case "/nick": {
        const newNick = parts[1];
        if (!newNick || newNick.length < 2 || newNick.length > 24) {
          send(ws, { type: "system", text: "Usage: /nick <nom> (2-24 caracteres)" });
          return;
        }
        // Check for nick collision
        for (const [, other] of clients) {
          if (other.nick.toLowerCase() === newNick.toLowerCase() && other !== info) {
            send(ws, { type: "system", text: `Le pseudo "${newNick}" est deja utilise.` });
            return;
          }
        }
        const oldNick = info.nick;
        info.nick = newNick;
        broadcast(info.channel, {
          type: "system",
          text: `${oldNick} est maintenant connu(e) comme ${newNick}`,
        });
        broadcastUserlist(info.channel);
        break;
      }

      case "/who":
        send(ws, {
          type: "userlist",
          users: channelUsers(info.channel),
        });
        break;

      case "/personas":
        send(ws, {
          type: "system",
          text: personas
            .map((p) => `  ${p.nick} (${p.model}) — ${p.systemPrompt.slice(0, 60)}...`)
            .join("\n"),
        });
        break;

      case "/web": {
        const query = text.slice(4).trim();
        if (!query) {
          send(ws, { type: "system", text: "Usage: /web <recherche>" });
          break;
        }
        send(ws, { type: "system", text: `Recherche: ${query}...` });

        try {
          const results = await searchWeb(query);
          broadcast(info.channel, {
            type: "system",
            text: `Résultats pour "${query}":\n${results}`,
          });
          // Route to personas for commentary
          await routeToPersonas(
            info.channel,
            `L'utilisateur a cherché "${query}" sur le web. Résultats:\n${results}\n\nCommente ces résultats.`,
          );
        } catch (err) {
          send(ws, {
            type: "system",
            text: `Recherche échouée: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }

      case "/join": {
        const newChannel = parts[1] || "";
        if (!newChannel.startsWith("#") || newChannel.length < 2 || newChannel.length > 30) {
          send(ws, { type: "system", text: "Usage: /join #nom-du-canal (2-30 chars, commence par #)" });
          break;
        }
        // Sanitize: only alphanumeric, hyphens, underscores
        if (!/^#[a-zA-Z0-9_-]+$/.test(newChannel)) {
          send(ws, { type: "system", text: "Nom de canal invalide (lettres, chiffres, - et _ uniquement)" });
          break;
        }
        const oldChannel = info.channel;
        info.channel = newChannel;

        // Notify old channel
        broadcast(oldChannel, { type: "part", nick: info.nick, channel: oldChannel, text: `${info.nick} a quitte ${oldChannel}` });
        broadcastUserlist(oldChannel);

        // Notify new channel
        broadcast(newChannel, { type: "join", nick: info.nick, channel: newChannel, text: `${info.nick} a rejoint ${newChannel}` });
        broadcastUserlist(newChannel);

        // Send channel info to user
        send(ws, { type: "channelInfo", channel: newChannel });
        send(ws, { type: "system", text: `Canal change: ${newChannel}` });
        break;
      }

      case "/channels": {
        const channelCounts = new Map<string, number>();
        for (const [, client] of clients) {
          const count = channelCounts.get(client.channel) || 0;
          channelCounts.set(client.channel, count + 1);
        }
        const list = [...channelCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([ch, count]) => `  ${ch} (${count} connecte${count > 1 ? "s" : ""})`)
          .join("\n");
        send(ws, { type: "system", text: `Canaux actifs:\n${list || "  (aucun)"}` });
        break;
      }

      default:
        send(ws, { type: "system", text: `Commande inconnue: ${cmd}. Tape /help.` });
    }
  }

  // --- persistent conversation context (with auto-compaction) ---
  const contextStore = options.contextStore;

  function addToContext(channel: string, nick: string, text: string): void {
    if (contextStore) {
      contextStore.append(channel, nick, text).catch(() => {});
    }
  }

  async function getContextString(channel: string): Promise<string> {
    if (!contextStore) return "";
    try {
      return await contextStore.getContext(channel, 6000);
    } catch { return ""; }
  }

  // --- route text to personas (shared by chat messages and uploads) ---

  const MAX_INTER_PERSONA_DEPTH = 3;

  async function routeToPersonas(channel: string, text: string, depth: number = 0): Promise<void> {
    const personasSnapshot = [...personas];
    const responders = pickResponders(text, personasSnapshot);

    // RAG: enrich user message with relevant context from indexed documents
    let enrichedText = text;

    // Add persistent conversation context (with auto-compaction)
    const contextStr = await getContextString(channel);
    if (contextStr) enrichedText = text + "\n\n" + contextStr;
    if (rag && rag.size > 0) {
      try {
        const results = await rag.search(text, 2);
        if (results.length > 0) {
          const ragContext = results.map((r) => r.text).join("\n---\n");
          enrichedText = text + "\n\n[Contexte pertinent]\n" + ragContext;
        }
      } catch {
        // Ignore RAG errors — fall back to plain message
      }
    }

    for (const persona of responders) {
      // Send a typing indicator
      broadcast(channel, {
        type: "system",
        text: `${persona.nick} est en train d'ecrire...`,
      });

      // Enrich persona with memory context
      const memory = await loadPersonaMemory(persona.nick);
      let personaWithMemory = persona;
      if (memory.facts.length > 0 || memory.summary) {
        const memoryBlock = [
          "\n\n[Mémoire]",
          memory.facts.length > 0 ? `Faits retenus: ${memory.facts.join(", ")}` : "",
          memory.summary ? `Résumé: ${memory.summary}` : "",
        ].filter(Boolean).join("\n");

        personaWithMemory = {
          ...persona,
          systemPrompt: persona.systemPrompt + memoryBlock,
        };
      }

      let accumulated = "";

      try {
        await streamOllamaChat(
          ollamaUrl,
          personaWithMemory,
          enrichedText,
          (chunk) => {
            accumulated += chunk;
            // Send streamed chunks — buffer ~100 chars to avoid flooding
            // We send the full accumulated text each time (frontend can replace)
          },
          (fullText) => {
            broadcast(channel, {
              type: "message",
              nick: persona.nick,
              text: fullText,
              color: persona.color,
            });

            // Log persona response
            logChatMessage({
              ts: new Date().toISOString(),
              channel,
              nick: persona.nick,
              type: "message",
              text: fullText,
            });

            // Add persona response to conversation context
            addToContext(channel, persona.nick, fullText);

            // Track message for memory updates
            trackPersonaMessage(persona.nick, `User: ${text}\n${persona.nick}: ${fullText}`);

            // Update memory every 5 messages (async, non-blocking, serialized per persona)
            const count = personaMessageCounts.get(persona.nick) || 0;
            if (count > 0 && count % 5 === 0) {
              const recentMessages = personaRecentMessages.get(persona.nick) || [];
              const lockKey = persona.nick;
              const prev = personaMemoryLocks.get(lockKey) || Promise.resolve();
              const next = prev.then(() => updatePersonaMemory(persona, recentMessages, ollamaUrl)).catch(err => {
                console.error(`[ws-chat] Memory update failed for ${persona.nick}:`, err);
              });
              personaMemoryLocks.set(lockKey, next);
            }

            // TTS synthesis (async, non-blocking, with concurrency limit)
            if (process.env.TTS_ENABLED === "1" && ttsActive < MAX_TTS_CONCURRENT) {
              ttsActive++;
              synthesizeTTS(persona.nick, fullText, channel, broadcast)
                .catch((err) => {
                  console.error(`[tts] Error for ${persona.nick}: ${err}`);
                })
                .finally(() => { ttsActive--; });
            }

            // Inter-persona dialogue: check if persona mentioned another persona
            if (depth < MAX_INTER_PERSONA_DEPTH) {
              const mentionRegex = /@(\w+)/g;
              let mentionMatch: RegExpExecArray | null;
              const mentionedNicks = new Set<string>();

              while ((mentionMatch = mentionRegex.exec(fullText)) !== null) {
                const mentionedNick = mentionMatch[1];
                const mentionedPersona = personasSnapshot.find(
                  p => p.nick.toLowerCase() === mentionedNick.toLowerCase() && p.nick !== persona.nick
                );
                if (mentionedPersona && !mentionedNicks.has(mentionedPersona.nick)) {
                  mentionedNicks.add(mentionedPersona.nick);
                }
              }

              // Trigger mentioned personas to respond (max 1 per response to avoid flooding)
              if (mentionedNicks.size > 0) {
                const nextPersona = personasSnapshot.find(p => mentionedNicks.has(p.nick));
                if (nextPersona) {
                  setTimeout(async () => {
                    const contextMsg = `${persona.nick} a dit: "${fullText.slice(0, 500)}". @${nextPersona.nick}, réponds-lui.`;
                    try {
                      await routeToPersonas(channel, contextMsg, depth + 1);
                    } catch (err) {
                      console.error(`[ws-chat] Inter-persona error for ${nextPersona.nick}:`, err);
                    }
                  }, 2000);
                }
              }
            }
          },
          (err) => {
            console.error(`[ws-chat] Ollama error for ${persona.nick}:`, err.message);
            broadcast(channel, {
              type: "system",
              text: `${persona.nick}: erreur Ollama — ${err.message}`,
            });
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast(channel, { type: "system", text: `${persona.nick}: erreur de connexion` });
        console.error(`[ws-chat] Ollama error for ${persona.nick}:`, msg);
      }
    }
  }

  // --- handle chat message ---

  async function handleChatMessage(ws: WebSocket, info: ClientInfo, text: string): Promise<void> {
    // Echo user message to all clients in channel
    broadcast(info.channel, {
      type: "message",
      nick: info.nick,
      text,
      color: "#e0e0e0",
    });

    // Log user message + add to context
    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "message",
      text,
    });
    addToContext(info.channel, info.nick, text);

    await routeToPersonas(info.channel, text);
  }

  // --- handle file upload ---

  async function handleUpload(ws: WebSocket, info: ClientInfo, parsed: InboundUpload): Promise<void> {
    const filename = typeof parsed.filename === "string" ? parsed.filename : "unknown";
    const mimeType = typeof parsed.mimeType === "string" ? parsed.mimeType : "";
    const dataB64 = typeof parsed.data === "string" ? parsed.data : "";
    const size = typeof parsed.size === "number" ? parsed.size : 0;

    // Per-client upload rate limiting (50 MB/min)
    const now = Date.now();
    if (now - info.lastUploadReset > 60_000) {
      info.uploadBytesWindow = 0;
      info.lastUploadReset = now;
    }
    if (info.uploadBytesWindow + size > 50 * 1024 * 1024) {
      send(ws, { type: "system", text: "Upload rejeté — limite de débit dépassée (50 MB/min)" });
      return;
    }
    info.uploadBytesWindow += size;

    if (!dataB64 || size > 12 * 1024 * 1024) {
      send(ws, { type: "system", text: "Upload rejeté (vide ou > 12 MB)." });
      return;
    }

    const buffer = Buffer.from(dataB64, "base64");

    // Broadcast upload notification
    broadcast(info.channel, {
      type: "system",
      text: `${info.nick} a envoyé: ${filename} (${(size / 1024).toFixed(1)} KB)`,
    });

    // Log upload event
    logChatMessage({
      ts: new Date().toISOString(),
      channel: info.channel,
      nick: info.nick,
      type: "message",
      text: `[upload: ${filename}, ${(size / 1024).toFixed(1)} KB]`,
    });

    // Analyze file based on MIME type
    let analysis = "";

    if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      filename.endsWith(".csv") ||
      filename.endsWith(".jsonl")
    ) {
      const text = buffer.slice(0, 12000).toString("utf-8");
      analysis = `[Fichier texte: ${filename}]\n${text}`;
    } else if (mimeType.startsWith("image/")) {
      analysis = await analyzeImage(buffer, mimeType, filename, ollamaUrl);
    } else if (mimeType.startsWith("audio/")) {
      // Transcribe audio via Whisper (faster-whisper or openai-whisper)
      const ext = filename.split(".").pop() || "wav";
      const tmpFile = path.join("/tmp", `kxkm-audio-${Date.now()}.${ext}`);

      try {
        fs.writeFileSync(tmpFile, buffer);
        const scriptPath = path.resolve(
          process.env.SCRIPTS_DIR || path.join(process.cwd(), "scripts"),
          "transcribe_audio.py",
        );
        const pythonBin = process.env.PYTHON_BIN || "python3";

        await acquireFileProcessor();
        try {
          const { stdout, stderr } = await execFileAsync(pythonBin, [
            scriptPath, "--input", tmpFile, "--language", "fr",
          ], { timeout: 120_000 });

          if (stderr) console.log(`[ws-chat][audio] ${stderr.trim().slice(-200)}`);

          // stdout may contain multiple lines; the JSON result is on the last line
          const lastLine = stdout.trim().split("\n").pop() || "{}";
          const result = JSON.parse(lastLine) as { status?: string; transcript?: string; error?: string };

          if (result.transcript) {
            analysis = `[Audio: ${filename}]\nTranscription: ${result.transcript}`;
          } else {
            analysis = `[Audio: ${filename} — transcription échouée: ${result.error || "unknown"}]`;
          }
        } finally {
          releaseFileProcessor();
        }
      } catch (err) {
        analysis = `[Audio: ${filename} — erreur: ${err instanceof Error ? err.message : String(err)}]`;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
      }
    } else if (mimeType === "application/pdf") {
      if (pdfParse) {
        try {
          const pdfData = await pdfParse(buffer);
          const text = pdfData.text.slice(0, 12000);
          const pages = pdfData.numpages;
          analysis = `[PDF: ${filename}, ${pages} page(s)]\n${text}`;
        } catch (err) {
          analysis = `[PDF: ${filename} — extraction échouée: ${err instanceof Error ? err.message : String(err)}]`;
        }
      } else {
        analysis = `[PDF: ${filename} — pdf-parse non disponible]`;
      }
    } else if (isOfficeDocument(filename, mimeType)) {
      // Word, Excel, PowerPoint, LibreOffice, RTF, EPUB
      const ext = filename.split(".").pop() || "";
      const tmpFile = path.join("/tmp", `kxkm-doc-${Date.now()}.${ext}`);
      try {
        fs.writeFileSync(tmpFile, buffer);
        const pythonBin = process.env.PYTHON_BIN || "python3";
        const scriptPath = path.join(process.env.SCRIPTS_DIR || "scripts", "extract_document.py");
        await acquireFileProcessor();
        try {
          const { stdout, stderr } = await execFileAsync(pythonBin, [
            scriptPath, "--input", tmpFile,
          ], { timeout: 60_000 });
          if (stderr) console.log(`[upload] doc extract: ${stderr.slice(-200)}`);
          const jsonLine = stdout.trim().split("\n").pop() || "{}";
          const result = JSON.parse(jsonLine);
          if (result.text) {
            analysis = `[Document ${ext.toUpperCase()}: ${filename}]\n${result.text}`;
          } else {
            analysis = `[Document: ${filename} — extraction échouée: ${result.error || "unknown"}]`;
          }
        } finally {
          releaseFileProcessor();
        }
      } catch (err) {
        analysis = `[Document: ${filename} — erreur: ${err instanceof Error ? err.message : String(err)}]`;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    } else {
      analysis = `[Fichier: ${filename}, type: ${mimeType}, ${(size / 1024).toFixed(0)} KB]`;
    }

    if (analysis) {
      const contextMessage =
        `[L'utilisateur ${info.nick} a partagé un fichier: ${filename}]\n${analysis}\n\nAnalyse ce fichier et donne ton avis.`;

      await routeToPersonas(info.channel, contextMessage);
    }
  }

  // --- connection handler ---

  wss.on("connection", (ws: WebSocket) => {
    const nick = generateNick();
    const info: ClientInfo = {
      nick,
      channel: "#general",
      connectedAt: Date.now(),
      messageTimestamps: [],
      uploadBytesWindow: 0,
      lastUploadReset: Date.now(),
    };

    clients.set(ws, info);

    // Send MOTD
    send(ws, {
      type: "system",
      text: [
        "***",
        "***  KXKM_Clown V2 — WebSocket Chat",
        "***",
        `***  Personas actives: ${personas.map((p) => p.nick).join(", ")}`,
        "***  Tape /help pour les commandes.",
        `***  Ton nick: ${nick}`,
        "***",
      ].join("\n"),
    });

    // Send persona color info
    for (const p of personas) {
      send(ws, { type: "persona", nick: p.nick, color: p.color });
    }

    // Broadcast join
    broadcast(info.channel, {
      type: "join",
      nick: info.nick,
      channel: info.channel,
      text: `${info.nick} a rejoint ${info.channel}`,
    }, ws);

    // Send userlist
    send(ws, { type: "userlist", users: channelUsers(info.channel) });

    // --- message handler ---

    ws.on("message", async (raw: Buffer) => {
      if (raw.length > MAX_WS_MESSAGE_BYTES) return;

      // Rate limiting
      const now = Date.now();
      info.messageTimestamps = info.messageTimestamps.filter(
        (t) => now - t < RATE_LIMIT_WINDOW_MS,
      );
      if (info.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
        send(ws, { type: "system", text: "Trop de messages — ralentis un peu." });
        return;
      }
      info.messageTimestamps.push(now);

      let message: InboundMessage;
      try {
        message = JSON.parse(raw.toString()) as InboundMessage;
      } catch {
        return;
      }

      if (!message || typeof message !== "object") return;
      if (typeof message.type !== "string") return;

      if (message.type === "upload") {
        await handleUpload(ws, info, message as InboundUpload);
        return;
      }

      // For message and command types, text is required
      if (typeof (message as InboundChatMessage).text !== "string") return;
      const text = (message as InboundChatMessage).text;
      if (text.length > MAX_TEXT_LENGTH) {
        send(ws, { type: "system", text: "Message trop long (max 8192 caracteres)." });
        return;
      }

      if (message.type === "command") {
        await handleCommand(ws, info, text);
      } else if (message.type === "message") {
        await handleChatMessage(ws, info, text);
      }
    });

    // --- error handler (prevent unhandled error crash) ---

    ws.on("error", (err) => {
      console.error(`[ws-chat] WebSocket error for ${info.nick}:`, err.message);
    });

    // --- close handler ---

    ws.on("close", () => {
      broadcast(info.channel, {
        type: "part",
        nick: info.nick,
        channel: info.channel,
        text: `${info.nick} a quitte ${info.channel}`,
      });
      clients.delete(ws);
      broadcastUserlist(info.channel);
    });
  });

  console.log(`[ws-chat] WebSocket chat attached on /ws (Ollama: ${ollamaUrl})`);
  return wss;
}
