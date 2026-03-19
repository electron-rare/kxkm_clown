export function resolveWebSocketUrl(path = "/ws"): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;

  if (typeof window === "undefined") {
    return `ws://127.0.0.1:4180${path}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
