import { useEffect, useState } from "react";
import { api, type PersonaData } from "../api";

interface PersonaListProps {
  onSelect: (id: string) => void;
}

export default function PersonaList({ onSelect }: PersonaListProps) {
  const [personas, setPersonas] = useState<PersonaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newModel, setNewModel] = useState("qwen3:8b");
  const [newSummary, setNewSummary] = useState("");
  const [newEnabled, setNewEnabled] = useState(true);

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

  async function handleToggle(e: React.MouseEvent, persona: PersonaData) {
    e.stopPropagation();
    setToggling(persona.id);
    try {
      const updated = await api.togglePersona(persona.id, persona.enabled === false);
      setPersonas((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "toggle_failed");
    } finally {
      setToggling(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.createPersona({
        name: newName.trim(),
        model: newModel,
        summary: newSummary.trim(),
        enabled: newEnabled,
      });
      setPersonas((prev) => [...prev, created]);
      setNewName("");
      setNewModel("qwen3:8b");
      setNewSummary("");
      setNewEnabled(true);
      setShowCreate(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "create_failed");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="muted">Chargement des personas...</div>;
  if (error) return <div className="banner">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Personas</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Annuler" : "+ Nouvelle Persona"}
          </button>
          <button className="btn btn-secondary" onClick={loadPersonas}>Rafraichir</button>
        </div>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="card"
          style={{
            marginBottom: "1rem",
            padding: "1rem",
            background: "#111",
            border: "1px solid #0f0",
          }}
        >
          <div style={{ marginBottom: "0.5rem" }}>
            <label style={{ display: "block", color: "#0f0", marginBottom: "0.25rem" }}>
              Nom <span style={{ color: "#f44" }}>*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              placeholder="Nom de la persona"
              style={{ width: "100%", background: "#000", color: "#0f0", border: "1px solid #0f0", padding: "0.4rem" }}
            />
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <label style={{ display: "block", color: "#0f0", marginBottom: "0.25rem" }}>Modele</label>
            <select
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              style={{ width: "100%", background: "#000", color: "#0f0", border: "1px solid #0f0", padding: "0.4rem" }}
            >
              <option value="qwen3:8b">qwen3:8b</option>
              <option value="qwen3:4b">qwen3:4b</option>
              <option value="mistral:7b">mistral:7b</option>
            </select>
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <label style={{ display: "block", color: "#0f0", marginBottom: "0.25rem" }}>System Prompt</label>
            <textarea
              value={newSummary}
              onChange={(e) => setNewSummary(e.target.value)}
              placeholder="Description / system prompt de la persona"
              rows={3}
              style={{ width: "100%", background: "#000", color: "#0f0", border: "1px solid #0f0", padding: "0.4rem", resize: "vertical" }}
            />
          </div>
          <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              id="new-persona-enabled"
              checked={newEnabled}
              onChange={(e) => setNewEnabled(e.target.checked)}
            />
            <label htmlFor="new-persona-enabled" style={{ color: "#0f0" }}>Active</label>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating || !newName.trim()}
          >
            {creating ? "Creation..." : "Creer la Persona"}
          </button>
        </form>
      )}
      <div className="card-grid">
        {personas.map((persona) => {
          const isEnabled = persona.enabled !== false;
          return (
            <div
              key={persona.id}
              className={`card persona-card${!isEnabled ? " persona-card-disabled" : ""}`}
              onClick={() => onSelect(persona.id)}
            >
              <div className="card-header">
                <span
                  className={`status-dot ${isEnabled ? "status-dot-on" : "status-dot-off"}`}
                  title={isEnabled ? "Active" : "Desactivee"}
                />
                <strong>{persona.name}</strong>
                <button
                  className={`btn persona-toggle-btn ${isEnabled ? "btn-secondary" : "btn-danger"}`}
                  onClick={(e) => handleToggle(e, persona)}
                  disabled={toggling === persona.id}
                  title={isEnabled ? "Desactiver" : "Activer"}
                >
                  {toggling === persona.id
                    ? "..."
                    : isEnabled
                      ? "ON"
                      : "OFF"}
                </button>
              </div>
              <span className="model-tag">{persona.model}</span>
              <p className="card-desc">{persona.summary}</p>
            </div>
          );
        })}
      </div>
      {personas.length === 0 && <p className="muted">Aucune persona configuree.</p>}
    </div>
  );
}
