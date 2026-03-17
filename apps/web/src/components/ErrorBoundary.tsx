import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: "2rem",
          background: "#1a0a0a",
          color: "#ff6b6b",
          border: "1px solid #ff6b6b",
          fontFamily: "monospace",
          margin: "1rem",
        }}>
          <h2 style={{ margin: "0 0 1rem" }}>{">>> ERREUR SYSTEME <<<"}</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", color: "#ccc" }}>
            {this.state.error?.message || "Erreur inconnue"}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              background: "#333",
              color: "#0f0",
              border: "1px solid #0f0",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            F3=Retour
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
