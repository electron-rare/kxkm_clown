import { useState } from "react";
import { VideotexPageHeader } from "./VideotexMosaic";

interface LoginProps {
  onLogin: (username: string, email?: string, password?: string) => void | Promise<void>;
  error?: string;
}

export default function Login({ onLogin, error }: LoginProps) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    try {
      await Promise.resolve(onLogin(username.trim()));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="minitel-login">
      <VideotexPageHeader title="3615 KXKM" subtitle="Messagerie locale" color="green" />

      <form onSubmit={handleSubmit} className="minitel-login-form">
        <div className="minitel-field">
          <label>Pseudo _</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="votre pseudo"
            required
            className="minitel-input"
            autoFocus
            maxLength={24}
          />
        </div>

        <button
          type="submit"
          className="minitel-login-btn"
          disabled={loading || !username.trim()}
        >
          {loading ? "Connexion..." : ">>> Connexion <<<"}
        </button>
      </form>

      {error && <div className="minitel-login-error">ERREUR: {error}</div>}

      <div className="minitel-login-footer">
        Tarification: GRATUIT (c'est local, c'est libre)
      </div>
    </div>
  );
}
