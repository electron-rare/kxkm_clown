const listeners = new Set();

const state = {
  module: "dashboard",
  auth: {
    authenticated: false,
    mode: "none",
    sessionSupported: null,
    sessionEndpoint: null,
    source: "bootstrap",
  },
  status: {
    text: "Prêt.",
    tone: "info",
  },
  publicStatus: null,
};

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

export function setStatus(text, tone = "info") {
  updateState({
    status: {
      text,
      tone,
    },
  });
}
