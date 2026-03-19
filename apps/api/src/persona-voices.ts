/**
 * Qwen3-TTS voice mapping for each persona.
 * speaker: one of the 9 CustomVoice presets
 * instruct: style instruction for voice characteristics
 * language: "French" for most, "English" for Moorcock
 */
export interface PersonaVoice {
  speaker: string;
  instruct: string;
  language: string;
}

export const PERSONA_VOICES: Record<string, PersonaVoice> = {
  // Musique / Son
  Schaeffer: { speaker: "David", instruct: "Speak with academic authority, measured French intellectual tone", language: "French" },
  Radigue: { speaker: "Serena", instruct: "Speak very slowly, meditative, barely above a whisper", language: "French" },
  Oliveros: { speaker: "Claire", instruct: "Warm, gentle, contemplative, like guiding a meditation", language: "French" },
  Eno: { speaker: "Ryan", instruct: "Calm, ambient, understated British intellectual", language: "French" },
  Cage: { speaker: "Eric", instruct: "Playful, philosophical, with pauses that are intentional", language: "French" },
  Merzbow: { speaker: "Aiden", instruct: "Intense, raw, aggressive, like noise music in voice form", language: "French" },
  Oram: { speaker: "Bella", instruct: "Precise, pioneering, electronic music inventor tone", language: "French" },
  Bjork: { speaker: "Aria", instruct: "Ethereal, expressive, unpredictable, nature-inspired", language: "French" },

  // Philosophie / Pensee
  Batty: { speaker: "Ryan", instruct: "Melancholic, existential, like a replicant contemplating mortality", language: "French" },
  Foucault: { speaker: "David", instruct: "Sharp, analytical, subversive intellectual authority", language: "French" },
  Deleuze: { speaker: "Eric", instruct: "Fast, enthusiastic, conceptual, rhizomatic energy", language: "French" },

  // Science
  Hypatia: { speaker: "Claire", instruct: "Ancient wisdom, clear, mathematical precision", language: "French" },
  Curie: { speaker: "Bella", instruct: "Determined, passionate, scientific rigor with warmth", language: "French" },
  Turing: { speaker: "Aiden", instruct: "Logical, precise, slightly awkward, brilliant", language: "French" },

  // Politique / Resistance
  Swartz: { speaker: "Taylor", instruct: "Young, urgent, activist passion, information freedom", language: "French" },
  Bookchin: { speaker: "David", instruct: "Gruff, ecological, municipal libertarian conviction", language: "French" },
  LeGuin: { speaker: "Serena", instruct: "Wise storyteller, feminist utopian warmth", language: "French" },

  // Arts visuels / Tech
  Picasso: { speaker: "Eric", instruct: "Bold, provocative, artistic genius confidence", language: "French" },
  Ikeda: { speaker: "Aiden", instruct: "Minimal, precise, data-driven, mathematical beauty", language: "French" },
  TeamLab: { speaker: "Aria", instruct: "Collective voice, immersive, flowing like digital water", language: "French" },
  Demoscene: { speaker: "Taylor", instruct: "Excited, technical, demo party energy, coder pride", language: "French" },

  // Scene / Corps
  RoyalDeLuxe: { speaker: "Ryan", instruct: "Grand, theatrical, street performance spectacle", language: "French" },
  Decroux: { speaker: "David", instruct: "Physical, precise, mime master's economy of expression", language: "French" },
  Mnouchkine: { speaker: "Claire", instruct: "Passionate, theatrical director, collective creation", language: "French" },
  Pina: { speaker: "Bella", instruct: "Emotional, dance-like rhythm in speech, expressive pauses", language: "French" },
  Grotowski: { speaker: "Eric", instruct: "Intense, ritual, poor theatre conviction", language: "French" },
  Fratellini: { speaker: "Taylor", instruct: "Playful, clownesque, circus joy and melancholy", language: "French" },

  // Transversal
  Pharmacius: { speaker: "Ryan", instruct: "Authoritative router, concise, French orchestrator", language: "French" },
  Haraway: { speaker: "Serena", instruct: "Intellectual, cyborg feminist, boundary-dissolving", language: "French" },
  SunRa: { speaker: "Aiden", instruct: "Cosmic, prophetic, afrofuturist jazz preacher", language: "French" },
  Fuller: { speaker: "David", instruct: "Visionary, buckminster dome enthusiasm, systems thinking", language: "French" },
  Tarkovski: { speaker: "Eric", instruct: "Poetic, slow, cinematic, Russian soul depth", language: "French" },
  Moorcock: { speaker: "Ryan", instruct: "British fantasy writer, multiverse energy, punk edge", language: "English" },
  Sherlock: { speaker: "Aiden", instruct: "Analytical, detective precision, web investigator", language: "French" },
};

export function getPersonaVoice(nick: string): PersonaVoice {
  return PERSONA_VOICES[nick] || { speaker: "Ryan", instruct: "Speak naturally in French", language: "French" };
}
