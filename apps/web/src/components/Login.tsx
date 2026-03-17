import { useState } from "react";

interface LoginProps {
  onLogin: (username: string) => void;
  error?: string;
}

export default function Login({ onLogin, error }: LoginProps) {
  const [username, setUsername] = useState("");
  const [ullaMode, setUllaMode] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nick = username.trim();
    if (!nick) return;
    if (nick.toLowerCase() === "ulla" || nick.toLowerCase() === "/ulla") {
      setUllaMode(true);
      setTimeout(() => setUllaMode(false), 4000);
      return;
    }
    onLogin(nick);
  }

  if (ullaMode) {
    return (
      <div className="minitel-login">
        <div className="minitel-login-header" style={{ color: "#ff69b4" }}>
          {">>> 3615 ULLA <<<"}
        </div>
        <div className="minitel-login-art" style={{ color: "#ff69b4" }}>
          {`
  ╔══════════════════════════╗
  ║                          ║
  ║    Bonjour, je suis      ║
  ║         ULLA             ║
  ║                          ║
  ║  Je suis disponible      ║
  ║  24h/24 pour discuter    ║
  ║  de sujets... varies.    ║
  ║                          ║
  ║  Mais ici c'est KXKM,   ║
  ║  pas le Minitel rose.    ║
  ║                          ║
  ║  Tapez un vrai pseudo    ║
  ║  pour continuer ;)       ║
  ║                          ║
  ╚══════════════════════════╝`}
        </div>
      </div>
    );
  }

  return (
    <div className="minitel-login">
      <div className="minitel-login-art">
        {`
  ╔══════════════════════════╗
  ║    3615  K X K M         ║
  ║                          ║
  ║  Systeme de chat IA      ║
  ║  multimodal local        ║
  ║                          ║
  ║  "Le medium est le       ║
  ║   message."              ║
  ╚══════════════════════════╝`}
      </div>
      <form onSubmit={handleSubmit} className="minitel-login-form">
        <div className="minitel-field">
          <label>Votre pseudo _</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="entrez votre pseudo"
            required
            className="minitel-input"
            autoFocus
            maxLength={24}
          />
        </div>
        <button
          type="submit"
          className="minitel-login-btn"
          disabled={!username.trim()}
        >
          {">>> Entrer <<<"}
        </button>
      </form>
      {error && <div className="minitel-login-error">ERREUR: {error}</div>}
      <div className="minitel-login-footer">
        Tarification: GRATUIT (c'est local)
      </div>
    </div>
  );
}
