import { useEffect, useState } from "react";
import { api, type ChatChannel } from "../api";

export default function ChannelList() {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadChannels();
  }, []);

  async function loadChannels() {
    setLoading(true);
    try {
      const list = await api.getChannels();
      setChannels(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="muted">Chargement des canaux...</div>;
  if (error) return <div className="banner">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Canaux de chat</h2>
        <button className="btn btn-secondary" onClick={loadChannels}>Rafraichir</button>
      </div>
      <div className="card-grid">
        {channels.map((channel) => (
          <div key={channel.id} className="card">
            <div className="card-header">
              <strong>{channel.label}</strong>
            </div>
            <span className="muted">{channel.kind}{channel.model ? ` (${channel.model})` : ""}</span>
          </div>
        ))}
      </div>
      {channels.length === 0 && <p className="muted">Aucun canal disponible.</p>}
    </div>
  );
}
