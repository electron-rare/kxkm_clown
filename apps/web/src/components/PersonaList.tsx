import { useEffect, useState } from "react";
import { api, type PersonaData } from "../api";

interface PersonaListProps {
  onSelect: (id: string) => void;
}

export default function PersonaList({ onSelect }: PersonaListProps) {
  const [personas, setPersonas] = useState<PersonaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadPersonas();
  }, []);

  async function loadPersonas() {
    setLoading(true);
    try {
      const list = await api.listPersonas();
      setPersonas(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="muted">Chargement des personas...</div>;
  if (error) return <div className="banner">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Personas</h2>
        <button className="btn btn-secondary" onClick={loadPersonas}>Rafraichir</button>
      </div>
      <div className="card-grid">
        {personas.map((persona) => (
          <div
            key={persona.id}
            className="card persona-card"
            onClick={() => onSelect(persona.id)}
          >
            <div className="card-header">
              <span
                className="color-dot"
                style={{ background: persona.color || "var(--accent)" }}
              />
              <strong>{persona.name}</strong>
            </div>
            <span className="model-tag">{persona.model}</span>
            <p className="card-desc">{persona.summary}</p>
          </div>
        ))}
      </div>
      {personas.length === 0 && <p className="muted">Aucune persona configuree.</p>}
    </div>
  );
}
