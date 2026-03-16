import { useState, useEffect, useRef } from "react";

const MODEM_SEQUENCE = [
  { text: "", delay: 500 },
  { text: "FRANCE TELECOM", delay: 800 },
  { text: "TELETEL", delay: 600 },
  { text: "", delay: 300 },
  { text: "Appel 3615 KXKM...", delay: 1000 },
  { text: "biiiiiiip", delay: 800 },
  { text: "bzzzzzzzzz", delay: 600 },
  { text: "tchiiiiiik tchiiiiiik", delay: 700 },
  { text: "krrrrrrr...", delay: 500 },
  { text: "", delay: 300 },
  { text: "CONNEXION ETABLIE", delay: 800 },
  { text: "3615 KXKM — Bienvenue", delay: 600 },
];

interface MinitelConnectProps {
  onComplete: () => void;
  skip?: boolean;
}

export default function MinitelConnect({ onComplete, skip }: MinitelConnectProps) {
  const [lineIndex, setLineIndex] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (skip) { onCompleteRef.current(); return; }

    if (lineIndex >= MODEM_SEQUENCE.length) {
      const timer = setTimeout(() => onCompleteRef.current(), 500);
      return () => clearTimeout(timer);
    }

    const entry = MODEM_SEQUENCE[lineIndex];
    const timer = setTimeout(() => {
      if (entry.text) setLines(prev => [...prev, entry.text]);
      setLineIndex(prev => prev + 1);
    }, entry.delay);

    return () => clearTimeout(timer);
  }, [lineIndex, skip]);

  return (
    <div className="minitel-connect">
      <div className="minitel-connect-screen">
        {lines.map((line, i) => (
          <div key={i} className="minitel-connect-line">{line}</div>
        ))}
        <span className="minitel-cursor">█</span>
      </div>
    </div>
  );
}
