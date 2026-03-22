import { useState } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

const SECTIONS = [
  {
    title: "CHAT",
    content: [
      "Tapez un message et appuyez Entree pour envoyer.",
      "@NomPersona pour interpeller une persona specifique.",
      "Tab pour auto-completer les commandes et @mentions.",
      "/help pour la liste complete des 112+ commandes.",
      "Les personas IA repondent automatiquement a vos messages.",
    ],
  },
  {
    title: "COMMANDES ESSENTIELLES",
    content: [
      "/nick <nom> — changer de pseudo",
      "/who — voir qui est en ligne",
      "/join <canal> — rejoindre un canal",
      "/imagine <prompt> — generer une image (ComfyUI)",
      "/compose <prompt> — generer de la musique",
      "/voice <persona> <texte> — synthese vocale",
      "/noise <type> <duree> — bruit (white/pink/brown)",
      "/web <query> — recherche web",
      "/tr <texte> — traduction FR/EN",
    ],
  },
  {
    title: "INSTRUMENTS AI",
    content: [
      "/drone [dur] [note] — drone/pad synthetique",
      "/grain [dur] [src] — synthese granulaire",
      "/circus [dur] [notes] — orgue de barbarie",
      "/honk [dur] [mode] — klaxon/sirene/corne",
      "/kokoro [voix] texte — TTS rapide Kokoro (12 voix)",
      "/glitch <piste#> — appliquer un glitch a une piste",
    ],
  },
  {
    title: "COMPOSITION",
    content: [
      "/comp new — nouvelle composition",
      "/layer <prompt> — ajouter une piste musicale",
      "/mix — mixer toutes les pistes",
      "/master — masteriser avec IA",
      "/stem <piste#> — separer en stems (Demucs)",
      "/fx <piste#> <effet> — appliquer un effet audio",
      "/bounce — exporter le mix final",
      "/mp3 — convertir en MP3",
    ],
  },
  {
    title: "VOICE CHAT",
    content: [
      "Cliquez le bouton microphone pour activer le voice chat.",
      "Maintenez le bouton pour parler (push-to-talk).",
      "Les personas repondent avec leur voix synthetisee.",
      "Le bouton dictee (micro) transcrit votre voix en texte (Whisper local).",
    ],
  },
  {
    title: "IMAGES",
    content: [
      "/imagine <prompt> — generer avec ComfyUI (32 checkpoints, 24 LoRAs)",
      "/imagine --seed 42 <prompt> — avec seed specifique",
      "/imagine --style anime <prompt> — avec style predefini",
      "/imagine --model <checkpoint> <prompt> — avec modele specifique",
      "Les images sont sauvees dans la galerie media (F6).",
    ],
  },
  {
    title: "openDIAW.be",
    content: [
      "Le DAW est accessible via le bouton OUVRIR openDIAW.be (F8).",
      "9 instruments integres: Drone, Grain, Glitch, Circus, Honk, Magenta, AceStep, KokoroTTS, Piper.",
      "Les samples generes dans le chat sont importables dans le DAW.",
      "L'AI Bridge connecte le chat aux 18 backends audio.",
    ],
  },
  {
    title: "RACCOURCIS",
    content: [
      "F1=Chat  F2=Voice  F3=Personas  F4=Compose",
      "F5=Images  F6=Media  F7=Admin  F8=DAW AI  F9=Instruments",
      "Ctrl+F — recherche dans le chat",
      "Tab — auto-completion commandes/@mentions",
      "Fleches haut/bas — naviguer dans les suggestions",
      "Escape — fermer les suggestions",
    ],
  },
];

export default function UserGuide() {
  const [openSection, setOpenSection] = useState<number | null>(null);

  return (
    <div className="user-guide">
      <VideotexPageHeader title="GUIDE UTILISATEUR" subtitle="3615 J'ai pete — KXKM" color="cyan" />
      <div className="user-guide-sections">
        {SECTIONS.map((section, idx) => (
          <div key={section.title} className="user-guide-section">
            <button
              className={`user-guide-toggle ${openSection === idx ? "open" : ""}`}
              onClick={() => setOpenSection(openSection === idx ? null : idx)}
            >
              {openSection === idx ? "[-]" : "[+]"} {section.title}
            </button>
            {openSection === idx && (
              <ul className="user-guide-list">
                {section.content.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
