import { useState } from "react";
import type { UserRole } from "../api";

interface LoginProps {
  onLogin: (username: string, role: UserRole) => Promise<void>;
  error: string;
}

export default function Login({ onLogin, error }: LoginProps) {
  const [username, setUsername] = useState("operator");
  const [role, setRole] = useState<UserRole>("admin");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogin(username, role);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card panel">
        <p className="eyebrow">Authentification</p>
        <h2>Ouvrir une session</h2>
        <form onSubmit={handleSubmit} className="login-form">
          <label>
            <span>Nom d'utilisateur</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              required
            />
          </label>
          <label>
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="admin">admin</option>
              <option value="editor">editor</option>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={loading || !username.trim()}>
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>
        {error && <div className="banner">{error}</div>}
      </div>
    </div>
  );
}
