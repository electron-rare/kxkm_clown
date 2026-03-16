import { useEffect, useState } from "react";
import { api, type PersonaData, type PersonaFeedbackRecord } from "../api";

interface PersonaDetailProps {
  personaId: string;
  onBack: () => void;
}

export default function PersonaDetail({ personaId, onBack }: PersonaDetailProps) {
  const [persona, setPersona] = useState<PersonaData | null>(null);
  const [feedback, setFeedback] = useState<PersonaFeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPersona();
  }, [personaId]);

  async function loadPersona() {
    setLoading(true);
    try {
      const [p, fb] = await Promise.all([
        api.getPersona(personaId),
        api.getPersonaFeedback(personaId).catch(() => [] as PersonaFeedbackRecord[]),
      ]);
      setPersona(p);
      setFeedback(fb);
      setEditName(p.name);
      setEditModel(p.model);
      setEditSummary(p.summary);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updatePersona(personaId, {
        name: editName,
        model: editModel,
        summary: editSummary,
      });
      setPersona(updated);
      setEditing(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="muted">Chargement...</div>;
  if (error && !persona) return <div className="banner">{error}</div>;
  if (!persona) return <div className="banner">Persona introuvable.</div>;

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary" onClick={onBack}>Retour</button>
        <h2>{persona.name}</h2>
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="detail-grid">
        <section className="panel">
          <p className="eyebrow">Details</p>
          {editing ? (
            <div className="edit-form">
              <label>
                <span>Nom</span>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </label>
              <label>
                <span>Modele</span>
                <input value={editModel} onChange={(e) => setEditModel(e.target.value)} />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  rows={4}
                />
              </label>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? "Sauvegarde..." : "Sauvegarder"}
                </button>
                <button className="btn btn-secondary" onClick={() => setEditing(false)}>
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="detail-row">
                <span className="detail-label">Nom</span>
                <span>{persona.name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Modele</span>
                <span className="model-tag">{persona.model}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Description</span>
                <p>{persona.summary}</p>
              </div>
              <button className="btn btn-primary" onClick={() => setEditing(true)}>
                Editer
              </button>
            </div>
          )}
        </section>

        <section className="panel">
          <p className="eyebrow">Feedback ({feedback.length})</p>
          {feedback.length > 0 ? (
            <ul className="feedback-list">
              {feedback.map((fb) => (
                <li key={fb.id} className="feedback-item">
                  <span className="feedback-kind">{fb.kind}</span>
                  <span>{fb.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Aucun feedback pour cette persona.</p>
          )}
        </section>
      </div>
    </div>
  );
}
