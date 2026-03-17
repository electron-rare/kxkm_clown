import { useState } from "react";

interface LoginProps {
  onLogin: (username: string, email?: string, password?: string) => void;
  error?: string;
}

export default function Login({ onLogin, error }: LoginProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    try {
      onLogin(username.trim(), email.trim() || undefined, password || undefined);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="minitel-login">
      <div className="minitel-login-tabs">
        <button
          className={`minitel-tab${mode === "login" ? " minitel-tab-active" : ""}`}
          onClick={() => setMode("login")}
        >
          Connexion
        </button>
        <button
          className={`minitel-tab${mode === "register" ? " minitel-tab-active" : ""}`}
          onClick={() => setMode("register")}
        >
          Inscription
        </button>
      </div>

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

        {mode === "register" && (
          <div className="minitel-field">
            <label>Email _</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="votre@email.com"
              className="minitel-input"
            />
          </div>
        )}

        <div className="minitel-field">
          <label>Mot de passe _</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "choisir un mot de passe" : "mot de passe"}
            className="minitel-input"
          />
        </div>

        <button
          type="submit"
          className="minitel-login-btn"
          disabled={loading || !username.trim()}
        >
          {loading
            ? "Connexion..."
            : mode === "register"
              ? ">>> Inscription <<<"
              : ">>> Connexion <<<"}
        </button>
      </form>

      {error && <div className="minitel-login-error">ERREUR: {error}</div>}

      <div className="minitel-login-footer">
        Tarification: GRATUIT (c'est local, c'est libre)
      </div>
    </div>
  );
}
