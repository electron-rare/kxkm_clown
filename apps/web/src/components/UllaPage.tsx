import { useState, useEffect } from "react";

interface UllaPageProps {
  onBack: () => void;
}

const ULLA_LINES = [
  "",
  "  ╔════════════════════════════════════╗",
  "  ║                                    ║",
  "  ║      ★  3615 ULLA  ★              ║",
  "  ║                                    ║",
  "  ║  Bienvenue sur le service          ║",
  "  ║  le plus celebre du Minitel.       ║",
  "  ║                                    ║",
  "  ║  Mais ici, c'est 3615 J'ai pété.       ║",
  "  ║  On parle musique concrete,        ║",
  "  ║  cyberfeminisme, et IA locale.     ║",
  "  ║                                    ║",
  "  ║  Pas de messagerie rose.           ║",
  "  ║  Que du phosphore vert.            ║",
  "  ║                                    ║",
  "  ╠════════════════════════════════════╣",
  "  ║                                    ║",
  '  ║  "Un LLM local qui refuse le      ║',
  '  ║   cloud centralise est un          ║',
  '  ║   acte politique."                 ║',
  "  ║                                    ║",
  "  ║         -- electron rare           ║",
  "  ║                                    ║",
  "  ╠════════════════════════════════════╣",
  "  ║                                    ║",
  "  ║  Tarification: GRATUIT             ║",
  "  ║  (c'est local, c'est libre)        ║",
  "  ║                                    ║",
  "  ║  Appuyez sur Retour pour           ║",
  "  ║  revenir au chat.                  ║",
  "  ║                                    ║",
  "  ╚════════════════════════════════════╝",
];

export default function UllaPage({ onBack }: UllaPageProps) {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    if (visibleLines < ULLA_LINES.length) {
      const timer = setTimeout(() => setVisibleLines((v) => v + 1), 80);
      return () => clearTimeout(timer);
    }
  }, [visibleLines]);

  return (
    <div className="ulla-page" onClick={onBack}>
      <div className="ulla-screen">
        {ULLA_LINES.slice(0, visibleLines).map((line, i) => (
          <div key={i} className="ulla-line">{line || "\u00A0"}</div>
        ))}
        {visibleLines >= ULLA_LINES.length && (
          <span className="minitel-cursor">█</span>
        )}
      </div>
    </div>
  );
}
