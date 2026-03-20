import { useState, useEffect, useRef } from "react";

// Phase 1: modem sounds + connection text
// Phase 2: 3615 ULLA easter egg (pink)
// Phase 3: transition to 3615 J'ai pété
const MODEM_SEQUENCE = [
  { text: "", delay: 500, phase: "modem" },
  { text: "FRANCE TELECOM", delay: 800, phase: "modem" },
  { text: "TELETEL", delay: 600, phase: "modem" },
  { text: "", delay: 300, phase: "modem" },
  { text: "Appel 3615...", delay: 1000, phase: "modem" },
  { text: "biiiiiiip", delay: 800, phase: "modem" },
  { text: "bzzzzzzzzz", delay: 600, phase: "modem" },
  { text: "tchiiiiiik tchiiiiiik", delay: 700, phase: "modem" },
  { text: "krrrrrrr...", delay: 500, phase: "modem" },
  { text: "", delay: 300, phase: "modem" },
  { text: "CONNEXION ETABLIE", delay: 800, phase: "modem" },
  // Phase 2: ULLA easter egg
  { text: "", delay: 400, phase: "ulla" },
  { text: "★  3615 ULLA  ★", delay: 1200, phase: "ulla" },
  { text: "Bienvenue sur le Minitel rose...", delay: 1000, phase: "ulla" },
  { text: "Mais ici c'est pas ULLA.", delay: 800, phase: "ulla" },
  // Phase 3: KXKM
  { text: "", delay: 400, phase: "kxkm" },
  { text: "Redirection vers 3615 J'ai pété...", delay: 800, phase: "kxkm" },
  { text: "", delay: 300, phase: "kxkm" },
  { text: "╔══════════════════════════════╗", delay: 100, phase: "kxkm" },
  { text: "║      3615  K X K M          ║", delay: 100, phase: "kxkm" },
  { text: "║                              ║", delay: 100, phase: "kxkm" },
  { text: "║  Systeme de chat IA local    ║", delay: 100, phase: "kxkm" },
  { text: '║  "Le medium est le message." ║', delay: 100, phase: "kxkm" },
  { text: "╚══════════════════════════════╝", delay: 100, phase: "kxkm" },
  { text: "", delay: 600, phase: "kxkm" },
  { text: "CONNEXION 3615 J'ai pété — OK", delay: 500, phase: "kxkm" },
];

interface MinitelConnectProps {
  onComplete: () => void;
  skip?: boolean;
}

export default function MinitelConnect({ onComplete, skip }: MinitelConnectProps) {
  const [lineIndex, setLineIndex] = useState(0);
  const [lines, setLines] = useState<Array<{ text: string; phase: string }>>([]);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (skip) { onCompleteRef.current(); return; }

    if (lineIndex >= MODEM_SEQUENCE.length) {
      const timer = setTimeout(() => onCompleteRef.current(), 800);
      return () => clearTimeout(timer);
    }

    const entry = MODEM_SEQUENCE[lineIndex];
    const timer = setTimeout(() => {
      if (entry.text) {
        setLines(prev => [...prev, { text: entry.text, phase: entry.phase }]);
      }
      setLineIndex(prev => prev + 1);
    }, entry.delay);

    return () => clearTimeout(timer);
  }, [lineIndex, skip]);

  // Click to skip
  function handleClick() {
    onCompleteRef.current();
  }

  return (
    <div className="minitel-connect" onClick={handleClick} title="Cliquez pour passer">
      <div className="minitel-connect-screen">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`minitel-connect-line minitel-connect-${line.phase}`}
          >
            {line.text}
          </div>
        ))}
        <span className="minitel-cursor">█</span>
      </div>
    </div>
  );
}
