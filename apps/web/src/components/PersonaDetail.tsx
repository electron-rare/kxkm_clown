import { useEffect, useRef, useState } from "react";
import { api, type PersonaData, type PersonaFeedbackRecord } from "../api";

interface PersonaDetailProps {
  personaId: string;
  onBack: () => void;
}

const AVAILABLE_MODELS = [
  "qwen2.5:14b",
  "mistral:7b",
  "mythalion:latest",
];

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
  const [toggling, setToggling] = useState(false);
  const [hasVoiceSample, setHasVoiceSample] = useState(false);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const voiceFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPersona();
    loadVoiceStatus();
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

  async function loadVoiceStatus() {
    try {
      const status = await api.getVoiceSampleStatus(personaId);
      setHasVoiceSample(status.hasVoiceSample);
    } catch { /* ignore */ }
  }

  async function handleVoiceUpload() {
    const file = voiceFileRef.current?.files?.[0];
    if (!file) return;
    setVoiceUploading(true);
    setVoiceStatus("");
    try {
      await api.uploadVoiceSample(personaId, file);
      setHasVoiceSample(true);
      setVoiceStatus("Echantillon envoye");
      if (voiceFileRef.current) voiceFileRef.current.value = "";
    } catch (err) {
      setVoiceStatus(err instanceof Error ? err.message : "upload_failed");
    } finally {
      setVoiceUploading(false);
    }
  }

  async function handleVoiceDelete() {
    setVoiceUploading(true);
    try {
      await api.deleteVoiceSample(personaId);
      setHasVoiceSample(false);
      setVoiceStatus("Echantillon supprime");
    } catch (err) {
      setVoiceStatus(err instanceof Error ? err.message : "delete_failed");
    } finally {
      setVoiceUploading(false);
    }
  }

  async function handleToggle() {
    if (!persona) return;
    setToggling(true);
    try {
      const updated = await api.togglePersona(personaId, persona.enabled === false);
      setPersona(updated);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "toggle_failed");
    } finally {
      setToggling(false);
    }
  }

  if (loading) return <div className="muted">Chargement...</div>;
  if (error && !persona) return <div className="banner">{error}</div>;
  if (!persona) return <div className="banner">Persona introuvable.</div>;

  const isEnabled = persona.enabled !== false;

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary" onClick={onBack}>Retour</button>
        <h2>{persona.name}</h2>
        <span
          className={`status-dot ${isEnabled ? "status-dot-on" : "status-dot-off"}`}
          title={isEnabled ? "Active" : "Desactivee"}
        />
        <button
          className={`btn ${isEnabled ? "btn-secondary" : "btn-danger"}`}
          onClick={handleToggle}
          disabled={toggling}
        >
          {toggling ? "..." : isEnabled ? "Desactiver" : "Activer"}
        </button>
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
                <select value={editModel} onChange={(e) => setEditModel(e.target.value)}>
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  {!AVAILABLE_MODELS.includes(editModel) && (
                    <option value={editModel}>{editModel} (custom)</option>
                  )}
                </select>
              </label>
              <label>
                <span>System Prompt / Description</span>
                <textarea
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  rows={8}
                  placeholder="System prompt ou description de la persona..."
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
                <span className="detail-label">Statut</span>
                <span className={isEnabled ? "persona-status-on" : "persona-status-off"}>
                  {isEnabled ? "Active" : "Desactivee"}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Description</span>
                <pre className="persona-summary-pre">{persona.summary}</pre>
              </div>
              <button className="btn btn-primary" onClick={() => setEditing(true)}>
                Editer
              </button>
            </div>
          )}
        </section>

        <section className="panel">
          <p className="eyebrow">Echantillon vocal (XTTS-v2)</p>
          <div className="detail-row">
            <span className="detail-label">Statut</span>
            <span className={hasVoiceSample ? "persona-status-on" : "persona-status-off"}>
              {hasVoiceSample ? "Voix clonee (XTTS)" : "Voix generique (Piper)"}
            </span>
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <input
              ref={voiceFileRef}
              type="file"
              accept="audio/wav,audio/x-wav,audio/mp3,audio/mpeg"
              style={{ marginBottom: "0.5rem", display: "block" }}
            />
            <div className="form-actions">
              <button
                className="btn btn-primary"
                onClick={handleVoiceUpload}
                disabled={voiceUploading}
              >
                {voiceUploading ? "Envoi..." : "Envoyer echantillon"}
              </button>
              {hasVoiceSample && (
                <button
                  className="btn btn-danger"
                  onClick={handleVoiceDelete}
                  disabled={voiceUploading}
                >
                  Supprimer
                </button>
              )}
            </div>
            {voiceStatus && (
              <p className="muted" style={{ marginTop: "0.25rem" }}>{voiceStatus}</p>
            )}
            <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85em" }}>
              WAV ou MP3, ~6 secondes de parole claire. Utilise pour cloner la voix via XTTS-v2.
            </p>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Feedback ({feedback.length})</p>
          {feedback.length > 0 ? (
            <ul className="feedback-list">
              {feedback.map((fb) => (
                <li key={fb.id} className="feedback-item">
                  <span className="feedback-kind">{fb.kind}</span>
                  <span>{fb.message}</span>
                  <span className="feedback-date">{new Date(fb.createdAt).toLocaleDateString("fr-FR")}</span>
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
