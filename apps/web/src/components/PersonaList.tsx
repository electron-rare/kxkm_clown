import { useEffect, useState } from "react";
import { api, type PersonaData } from "../api";

interface PersonaListProps {
  onSelect: (id: string) => void;
}

// Group personas by model for tree view
function groupByModel(personas: PersonaData[]): Map<string, PersonaData[]> {
  const groups = new Map<string, PersonaData[]>();
  for (const p of personas) {
    const model = p.model || "inconnu";
    if (!groups.has(model)) groups.set(model, []);
    groups.get(model)!.push(p);
  }
  // Sort groups by model name, sort personas by name within groups
  const sorted = new Map(
    [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v.sort((a, b) => a.name.localeCompare(b.name))])
  );
  return sorted;
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  function toggleCollapse(model: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }

  if (loading) return <div className="minitel-loading">Chargement des personas...</div>;

  const groups = groupByModel(personas);
  const enabledCount = personas.filter((p) => p.enabled !== false).length;

  return (
    <div className="minitel-tree-view">
      <div className="minitel-tree-header">
        {">>> PERSONAS <<<"}
        <span className="minitel-tree-stats">
          {enabledCount}/{personas.length} actives
        </span>
      </div>

      {error && <div className="minitel-error">ERREUR: {error}</div>}

      <div className="minitel-tree-actions">
        <button className="minitel-tree-btn" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Annuler" : "+ Nouvelle"}
        </button>
        <button className="minitel-tree-btn" onClick={loadPersonas}>Rafraichir</button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="minitel-create-form">
          <div className="minitel-field">
            <label>Nom _</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              placeholder="nom de la persona"
              className="minitel-input"
              autoFocus
            />
          </div>
          <div className="minitel-field">
            <label>Modele _</label>
            <select
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              className="minitel-input"
            >
              <option value="qwen3:8b">qwen3:8b</option>
              <option value="qwen3.5:9b">qwen3.5:9b</option>
              <option value="qwen3:4b">qwen3:4b</option>
              <option value="mistral:7b">mistral:7b</option>
              <option value="gemma3:4b">gemma3:4b</option>
            </select>
          </div>
          <div className="minitel-field">
            <label>Prompt _</label>
            <textarea
              value={newSummary}
              onChange={(e) => setNewSummary(e.target.value)}
              placeholder="system prompt"
              rows={2}
              className="minitel-input"
            />
          </div>
          <label className="minitel-checkbox">
            <input
              type="checkbox"
              checked={newEnabled}
              onChange={(e) => setNewEnabled(e.target.checked)}
            />
            Active
          </label>
          <button type="submit" className="minitel-login-btn" disabled={creating || !newName.trim()}>
            {creating ? "Creation..." : ">>> Creer <<<"}
          </button>
        </form>
      )}

      {/* Tree view grouped by model */}
      <div className="minitel-tree">
        {[...groups.entries()].map(([model, group]) => {
          const isCollapsed = collapsed.has(model);
          const activeInGroup = group.filter((p) => p.enabled !== false).length;
          return (
            <div key={model} className="minitel-tree-branch">
              <div
                className="minitel-tree-model"
                onClick={() => toggleCollapse(model)}
              >
                <span className="minitel-tree-toggle">{isCollapsed ? "+" : "-"}</span>
                <span className="minitel-tree-model-name">{model}</span>
                <span className="minitel-tree-model-count">
                  ({activeInGroup}/{group.length})
                </span>
              </div>
              {!isCollapsed && (
                <div className="minitel-tree-leaves">
                  {group.map((persona) => {
                    const isEnabled = persona.enabled !== false;
                    return (
                      <div
                        key={persona.id}
                        className={`minitel-tree-leaf${!isEnabled ? " minitel-tree-leaf-off" : ""}`}
                        onClick={() => onSelect(persona.id)}
                      >
                        <span className="minitel-tree-pipe">├─</span>
                        <span className={`minitel-tree-dot ${isEnabled ? "dot-on" : "dot-off"}`}>
                          {isEnabled ? "●" : "○"}
                        </span>
                        <span className="minitel-tree-name">{persona.name}</span>
                        <button
                          className="minitel-tree-toggle-btn"
                          onClick={(e) => handleToggle(e, persona)}
                          disabled={toggling === persona.id}
                          title={isEnabled ? "Desactiver" : "Activer"}
                        >
                          {toggling === persona.id ? "..." : isEnabled ? "ON" : "OFF"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {personas.length === 0 && (
        <div className="minitel-loading">Aucune persona configuree.</div>
      )}
    </div>
  );
}
